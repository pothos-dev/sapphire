// Frontmatter parsing + verbatim-preserving serialization for the Properties
// panel. Implements ADR 0002 (flat key/value model): scalars and flat lists are
// editable; everything else is preserved VERBATIM and round-tripped untouched.
//
// The crux is the round-trip guarantee: editing a simple scalar must not
// reformat or corrupt any other part of the frontmatter (nested maps,
// multi-line blocks, comments, anchors, key ordering, quoting style) nor the
// markdown body. We achieve this by NEVER re-serializing the whole YAML
// document. Instead we parse with `yaml`'s CST/AST (which carries byte ranges),
// and on edit we splice a freshly-serialized value into the exact source span
// of the key being changed, leaving all other bytes identical.
//
// Kept dependency-free of the IPC seam: operates purely on raw markdown strings.
// The index slice can reuse `parseConcept` / `splitFrontmatter`.

import { parseDocument, isScalar, isSeq, isMap, isNode, Scalar, type Document } from 'yaml';

/** Classification of a top-level frontmatter value (ADR 0002). */
export type PropertyKind = 'scalar' | 'list' | 'complex';

/** One top-level frontmatter entry, in document order. */
export interface Property {
  key: string;
  kind: PropertyKind;
  /** Scalar string form (empty string for null/empty). Only for `scalar`. */
  scalar?: string;
  /** Whether the scalar parsed as a boolean (affects re-serialization). */
  boolean?: boolean;
  /** Flat list items as strings. Only for `list`. */
  list?: string[];
  /** Verbatim source text of the value (used for `complex`, kept untouched). */
  raw?: string;
}

/** Result of splitting a Concept into its frontmatter block and body. */
export interface SplitConcept {
  /** True when a leading `---\n ... \n---` block is present. */
  hasFrontmatter: boolean;
  /** The YAML text BETWEEN the delimiters (no `---` lines). '' when none. */
  yaml: string;
  /**
   * The body, including the line break that follows the closing `---`.
   * Preserved byte-for-byte. For a Concept with no frontmatter, this is the
   * whole content.
   */
  body: string;
  /** Exact opening delimiter line incl. trailing newline, e.g. `---\n`. */
  open: string;
  /** Exact closing delimiter incl. its trailing newline, e.g. `---\n`. */
  close: string;
}

/**
 * Split raw markdown into a leading YAML frontmatter block and the body.
 *
 * A frontmatter block is a `---` line at the very start of the file, the YAML
 * up to the next line that is exactly `---` (or `...`), then the body. The
 * delimiters and body are captured verbatim so an unchanged document recombines
 * byte-for-byte.
 */
export function splitFrontmatter(content: string): SplitConcept {
  // The opening fence must be the first line and exactly `---` (optionally with
  // trailing spaces, tolerated). Allow a leading BOM-free start only.
  const fenceRe = /^---[ \t]*\r?\n/;
  const openMatch = fenceRe.exec(content);
  if (!openMatch) {
    return { hasFrontmatter: false, yaml: '', body: content, open: '', close: '' };
  }
  const open = openMatch[0];
  const afterOpen = open.length;

  // Find the closing fence: a line that is exactly `---` or `...`.
  const closeRe = /\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/g;
  closeRe.lastIndex = afterOpen - 1; // start search from the newline of `open`
  // We need the closing fence to begin on its own line. Scan line by line.
  const lines = content.slice(afterOpen).split(/(?<=\n)/);
  let consumed = afterOpen;
  let yaml = '';
  let close = '';
  let closed = false;
  for (const line of lines) {
    const trimmed = line.replace(/\r?\n$/, '').trimEnd();
    if (trimmed === '---' || trimmed === '...') {
      close = line;
      consumed += line.length;
      closed = true;
      break;
    }
    yaml += line;
    consumed += line.length;
  }

  if (!closed) {
    // No closing fence — treat the whole thing as body (not valid frontmatter).
    return { hasFrontmatter: false, yaml: '', body: content, open: '', close: '' };
  }

  const body = content.slice(consumed);
  return { hasFrontmatter: true, yaml, body, open, close };
}

/**
 * Parse the top-level frontmatter entries of a Concept into an ordered list of
 * Properties, classifying each per ADR 0002. Returns an empty list when there
 * is no frontmatter (the panel still renders, flagging missing `type`).
 */
export function parseProperties(content: string): Property[] {
  const { hasFrontmatter, yaml } = splitFrontmatter(content);
  if (!hasFrontmatter || yaml.trim() === '') return [];

  let doc: Document.Parsed;
  try {
    doc = parseDocument(yaml, { keepSourceTokens: true });
  } catch {
    return [];
  }
  if (!isMap(doc.contents)) return [];

  const props: Property[] = [];
  for (const item of doc.contents.items) {
    const key = scalarKeyString(item.key);
    if (key === null) continue;
    const value = item.value;
    props.push(classify(key, value, yaml));
  }
  return props;
}

/**
 * Whether the required `type` field is missing or empty (the one OKF
 * conformance rule we flag). Reserved files (`index.md`/`log.md`) are exempt —
 * that exemption is applied by the caller in a later slice; here we report the
 * raw condition. A Concept with no frontmatter at all reports `true`.
 */
export function isTypeMissing(props: Property[]): boolean {
  const t = props.find((p) => p.key === 'type');
  if (!t) return true;
  if (t.kind === 'scalar') return (t.scalar ?? '').trim() === '';
  // A non-scalar `type` is malformed for our purposes — flag it.
  return t.kind !== 'list' || (t.list?.length ?? 0) === 0;
}

/** Classify a single value node into a Property. */
function classify(key: string, value: unknown, yamlSrc: string): Property {
  // Scalars: string / number / bool / null / date.
  if (value === null || value === undefined) {
    return { key, kind: 'scalar', scalar: '' };
  }
  if (isScalar(value)) {
    // Multi-line block scalars (literal `|` / folded `>`) are NOT simple
    // single-line scalars — per ADR 0002 they are preserved verbatim as a
    // read-only raw field rather than edited as a text input.
    const type = (value as Scalar).type;
    if (type === Scalar.BLOCK_LITERAL || type === Scalar.BLOCK_FOLDED) {
      return { key, kind: 'complex', raw: rangeText(value, yamlSrc) };
    }
    const v = (value as Scalar).value;
    if (typeof v === 'boolean') {
      return { key, kind: 'scalar', scalar: String(v), boolean: true };
    }
    if (v === null) return { key, kind: 'scalar', scalar: '' };
    // A string scalar that itself spans multiple lines is also not a simple
    // single-line field — preserve verbatim.
    if (typeof v === 'string' && v.includes('\n')) {
      return { key, kind: 'complex', raw: rangeText(value, yamlSrc) };
    }
    return { key, kind: 'scalar', scalar: String(v) };
  }

  // Sequences: only a FLAT list (all items scalar) is editable as chips.
  if (isSeq(value)) {
    const seq = value;
    const allScalar = seq.items.every((it) => isScalar(it) || it === null);
    if (allScalar) {
      const list = seq.items.map((it) =>
        it === null ? '' : isScalar(it) ? String((it as Scalar).value) : '',
      );
      return { key, kind: 'list', list };
    }
  }

  // Everything else (nested map, non-flat seq, etc.) -> complex, preserved
  // verbatim. Capture the exact source span of the value.
  const raw = rangeText(value, yamlSrc);
  return { key, kind: 'complex', raw };
}

/**
 * The string form of a mapping key, or `null` for non-scalar keys (which a flat
 * frontmatter model never has at top level). Narrows via the `yaml` type guard
 * so we only read `.value` from an actual Scalar.
 */
function scalarKeyString(keyNode: unknown): string | null {
  return isScalar(keyNode) ? String(keyNode.value) : null;
}

/** Extract the verbatim source text covered by a node's range. */
function rangeText(node: unknown, yamlSrc: string): string {
  const range = (node as { range?: [number, number, number] }).range;
  if (range) return yamlSrc.slice(range[0], range[1]);
  return '';
}

/**
 * Update one top-level scalar property's value in the raw markdown, preserving
 * everything else byte-for-byte. The body and all other frontmatter values
 * (including complex/unknown ones) are untouched.
 */
export function setScalar(content: string, key: string, newValue: string): string {
  return spliceValue(content, key, (prop) => serializeScalar(newValue, prop.boolean ?? false));
}

/**
 * Update one top-level flat-list property (e.g. `tags`) to the given items,
 * preserving everything else byte-for-byte.
 */
export function setList(content: string, key: string, items: string[]): string {
  return spliceValue(content, key, () => serializeList(items));
}

/**
 * Core splice: locate `key`'s entry in the frontmatter and replace just that
 * one `key: value` entry with a freshly serialized single-line form, leaving
 * every other byte — other entries (incl. complex/unknown), the delimiters, and
 * the body — untouched. This is the round-trip guarantee from ADR 0002.
 *
 * We replace the whole entry span (key start .. value node end) rather than
 * only the value, so that an original block construct (block sequence or block
 * scalar) collapses cleanly to `key: <value>` without leaving stray
 * indentation. The key text and any inline comment after the value are
 * re-emitted from the key string + serialized value; trailing structure is
 * dropped only for the edited key, never for others.
 */
function spliceValue(
  content: string,
  key: string,
  makeValue: (prop: Property) => string,
): string {
  const split = splitFrontmatter(content);
  if (!split.hasFrontmatter) return content;

  let doc: Document.Parsed;
  try {
    doc = parseDocument(split.yaml, { keepSourceTokens: true });
  } catch {
    return content;
  }
  if (!isMap(doc.contents)) return content;

  for (const item of doc.contents.items) {
    const keyNode = item.key;
    const k = scalarKeyString(keyNode);
    if (k === null || k !== key) continue;

    const prop = classify(key, item.value, split.yaml);
    const replacement = makeValue(prop);

    const keyRange = isNode(keyNode) ? keyNode.range : undefined;
    if (!keyRange) return content;
    const entryStart = keyRange[0];

    // End of the entry: prefer the value node's end-of-content (range[1]),
    // which excludes the trailing newline so we keep the original line break.
    // Fall back to the end of the key's line for null/empty values.
    const valueRange = (item.value as { range?: [number, number, number] } | null)?.range;
    let entryEnd: number;
    if (valueRange) {
      entryEnd = valueRange[1];
    } else {
      const nl = split.yaml.indexOf('\n', keyRange[1]);
      entryEnd = nl === -1 ? split.yaml.length : nl;
    }

    const keyText = serializeKey(k);
    let entryText = `${keyText}: ${replacement}`;
    // Block constructs (sequences/scalars) include their trailing newline in the
    // value range, so the replaced span eats the line break. Re-add one so the
    // following entry stays on its own line.
    if (entryEnd > 0 && split.yaml[entryEnd - 1] === '\n' && entryEnd < split.yaml.length) {
      entryText += '\n';
    }
    const newYaml = split.yaml.slice(0, entryStart) + entryText + split.yaml.slice(entryEnd);

    return split.open + newYaml + split.close + split.body;
  }

  return content;
}

/** Serialize a mapping key (quote only when needed). */
function serializeKey(key: string): string {
  return needsQuoting(key) ? JSON.stringify(key) : key;
}

/**
 * Serialize a scalar value the way YAML would, but minimally — we want clean
 * output without disturbing surrounding text. Quote only when necessary.
 */
function serializeScalar(value: string, asBoolean: boolean): string {
  if (asBoolean) {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === 'false') return v;
    // No longer a boolean -> fall through to string handling.
  }
  if (value === '') return "''";
  if (needsQuoting(value)) {
    // Use double quotes with minimal escaping.
    return JSON.stringify(value);
  }
  return value;
}

/** Whether a plain scalar string needs quoting to stay an unambiguous string. */
function needsQuoting(value: string): boolean {
  if (value !== value.trim()) return true; // leading/trailing space
  // YAML special starts and indicators.
  if (/^[!&*?|>%@`"'#,\[\]{}]/.test(value)) return true;
  if (/[:#]\s|\s#|: |^- /.test(value)) return true;
  if (/[\n\r\t]/.test(value)) return true;
  // Tokens that YAML would interpret as non-string.
  const lower = value.toLowerCase();
  if (
    ['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~', ''].includes(lower)
  ) {
    return true;
  }
  // Looks like a number.
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(value)) return true;
  return false;
}

/** Serialize a flat list as a YAML flow sequence: `[a, b, c]` (or `[]`). */
function serializeList(items: string[]): string {
  if (items.length === 0) return '[]';
  return '[' + items.map((it) => serializeScalar(it, false)).join(', ') + ']';
}

/**
 * Humanize a `.md` filename into a `title` (slice: new-concept-scaffolding).
 * Strips the extension, replaces `-`/`_` separators with spaces, collapses
 * whitespace, and sentence-cases the result (e.g. `my-note.md` → "My note").
 */
export function titleFromFilename(filename: string): string {
  const slash = filename.lastIndexOf('/');
  const base = slash === -1 ? filename : filename.slice(slash + 1);
  const stem = base.replace(/\.md$/i, '');
  const words = stem.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (words === '') return '';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Compose a spec-valid frontmatter STUB for a brand-new Concept: an empty
 * required `type` field (where the user lands first) and a `title` derived from
 * the filename. The file is immediately OKF-valid once `type` is filled.
 */
export function scaffoldConcept(filename: string): string {
  const title = titleFromFilename(filename);
  return `---\ntype:\ntitle: ${serializeScalar(title, false)}\n---\n\n`;
}

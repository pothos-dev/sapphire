import {
  EditorView,
  Decoration,
  ViewPlugin,
  gutter,
  GutterMarker,
  hoverTooltip,
  type DecorationSet,
  type ViewUpdate,
  type Tooltip,
} from '@codemirror/view';
import { RangeSet, type Extension } from '@codemirror/state';
import {
  parseCriticMarks,
  pairAnnotations,
  type Annotation,
} from './criticMarkup';

// ---------------------------------------------------------------------------
// CriticMarkup annotation rendering (feat/criticmarkup-annotations)
//
// Embedded CriticMarkup highlight+comment annotations rendered OUT of the text
// flow, mirroring the broken-links.ts / wiki-links.ts extension shape:
//   - Highlight (`{==text==}`): the content gets a highlighter background; the
//     `{==` / `==}` delimiters are hidden.
//   - Comment (`{>>note<<}`, bound to a preceding highlight): hidden from the
//     text flow entirely, surfaced instead as a LEFT-gutter icon on the line
//     and a hover tooltip over the highlighted text.
//   - Reveal-on-cursor: when the selection/caret is inside an annotation's span,
//     the raw markup is shown (delimiters/comment NOT hidden) so it can be
//     edited or deleted — exactly like wiki-links.ts reveals raw source. The
//     highlight background stays on the content even when revealed.
//
// The pure parsing / pairing / editing logic lives in `criticMarkup.ts`; this
// module is the thin CodeMirror wiring over it. Parsing the whole doc per
// recompute is fine for v1 (annotations are sparse and docs modest).
// ---------------------------------------------------------------------------

const highlightMark = Decoration.mark({ class: 'cm-critic-highlight' });
const hideMark = Decoration.replace({});

/**
 * Is the selection touching this annotation's overall span (inclusive)? When
 * true we reveal the raw markup so the user can edit/delete it — the same
 * cursor-inside reveal wiki-links.ts uses for links.
 */
function isRevealed(view: EditorView, ann: Annotation): boolean {
  return view.state.selection.ranges.some((r) => r.from <= ann.to && r.to >= ann.from);
}

/**
 * Build the annotation decoration set: highlight backgrounds always, delimiter/
 * comment replacements only while the annotation is NOT revealed. Uses
 * `Decoration.set(array, true)` (sorted for us) because replace + mark land at
 * adjacent offsets and a hand-ordered builder would be fragile. Zero-length
 * ranges are skipped — `Decoration.replace` over an empty range is invalid.
 */
function computeDecorations(view: EditorView): DecorationSet {
  const anns = pairAnnotations(parseCriticMarks(view.state.doc.toString()));
  const decos: { from: number; to: number; value: Decoration }[] = [];
  for (const ann of anns) {
    const revealed = isRevealed(view, ann);
    const { highlight, comment } = ann;
    if (highlight) {
      if (highlight.contentFrom < highlight.contentTo) {
        decos.push({ from: highlight.contentFrom, to: highlight.contentTo, value: highlightMark });
      }
      if (!revealed) {
        if (highlight.from < highlight.contentFrom) {
          decos.push({ from: highlight.from, to: highlight.contentFrom, value: hideMark });
        }
        if (highlight.contentTo < highlight.to) {
          decos.push({ from: highlight.contentTo, to: highlight.to, value: hideMark });
        }
      }
    }
    if (comment && !revealed && comment.from < comment.to) {
      decos.push({ from: comment.from, to: comment.to, value: hideMark });
    }
  }
  return Decoration.set(
    decos.map((d) => d.value.range(d.from, d.to)),
    true,
  );
}

/**
 * The decoration ViewPlugin: recomputes on doc / viewport / selection changes
 * (selection matters because the cursor-inside reveal toggles the delimiters).
 */
const criticDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = computeDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = computeDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------------------------------------------------------------------------
// Left gutter: a small speech-bubble icon on lines carrying a commented
// annotation (bound or point comment). Clicking it parks the caret in the note.
// ---------------------------------------------------------------------------

const COMMENT_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M2.5 2.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6.6L3.7 14a.5.5 0 0 1-.85-.35V11.5H2.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"/>' +
  '</svg>';

class CriticCommentMarker extends GutterMarker {
  constructor(readonly title: string) {
    super();
  }
  eq(other: CriticCommentMarker): boolean {
    return other.title === this.title;
  }
  toDOM(): Node {
    const span = document.createElement('span');
    span.className = 'cm-critic-gutter-icon';
    span.innerHTML = COMMENT_ICON_SVG;
    // Native hover fallback + accessibility label for the note text.
    span.title = this.title;
    return span;
  }
}

/** All commented annotations (bound or point comment) in the current doc. */
function commentedAnnotations(view: EditorView): Annotation[] {
  return pairAnnotations(parseCriticMarks(view.state.doc.toString())).filter(
    (a) => a.comment !== null,
  );
}

/**
 * One gutter marker per line that holds a commented annotation. Multiple
 * annotations on a line are deduped by keeping the first (its title on the
 * icon). Built as a sorted `RangeSet` keyed by line start.
 */
function gutterMarkers(view: EditorView): RangeSet<GutterMarker> {
  const seenLines = new Set<number>();
  const ranges: { from: number; value: GutterMarker }[] = [];
  for (const ann of commentedAnnotations(view)) {
    const line = view.state.doc.lineAt(ann.from);
    if (seenLines.has(line.from)) continue;
    seenLines.add(line.from);
    ranges.push({ from: line.from, value: new CriticCommentMarker(ann.comment?.text ?? '') });
  }
  return RangeSet.of(
    ranges.map((r) => r.value.range(r.from)),
    true,
  );
}

/** The commented annotation on the doc line containing `pos`, or null. */
function annotationOnLine(view: EditorView, pos: number): Annotation | null {
  const lineFrom = view.state.doc.lineAt(pos).from;
  for (const ann of commentedAnnotations(view)) {
    if (view.state.doc.lineAt(ann.from).from === lineFrom) return ann;
  }
  return null;
}

const criticGutter = gutter({
  class: 'cm-critic-gutter',
  markers: (view) => gutterMarkers(view),
  domEventHandlers: {
    // Click the marker → move the caret into the note (comment content if
    // present, else the highlighted text) and scroll it into view. A
    // discoverable "click to edit the note".
    mousedown(view, line) {
      const ann = annotationOnLine(view, line.from);
      if (!ann) return false;
      const target = ann.comment?.contentFrom ?? ann.highlight?.contentFrom;
      if (target == null) return false;
      view.dispatch({ selection: { anchor: target }, scrollIntoView: true });
      view.focus();
      return true;
    },
  },
});

// ---------------------------------------------------------------------------
// Hover tooltip: show the bound note over the highlighted text.
// ---------------------------------------------------------------------------

const criticTooltip = hoverTooltip((view, pos): Tooltip | null => {
  const anns = pairAnnotations(parseCriticMarks(view.state.doc.toString()));
  for (const ann of anns) {
    const { highlight, comment } = ann;
    if (!highlight || !comment) continue;
    if (highlight.contentFrom <= pos && pos <= highlight.contentTo) {
      return {
        pos: highlight.contentFrom,
        end: highlight.contentTo,
        above: true,
        create() {
          const dom = document.createElement('div');
          dom.className = 'cm-critic-tooltip';
          dom.textContent = comment.text ?? '';
          return { dom };
        },
      };
    }
  }
  return null;
});

/**
 * Bundle the CriticMarkup annotation extensions: the decoration ViewPlugin, the
 * comment gutter and the hover tooltip. Wire this into the non-`edit` modes so
 * source mode keeps raw `{==...==}` visible (see `modeExtensions` in cm.ts).
 */
export function criticMarkupAnnotations(): Extension {
  return [criticDecorations, criticGutter, criticTooltip];
}

/**
 * Styling for the CriticMarkup annotations, referencing Sapphire's design
 * tokens (app.css) so it tracks light/dark for free. The highlighter background
 * is a warm translucent amber (not a token — annotation-specific), scoped per
 * theme so it stays legible on both papers; everything else maps to existing
 * surface/border/text tokens. A static theme, harmless in every mode.
 */
export const criticMarkupTheme: Extension = EditorView.theme({
  '.cm-critic-highlight': {
    backgroundColor: 'rgba(255, 208, 0, 0.35)',
    borderRadius: '2px',
    padding: '0 1px',
  },
  '&[data-theme="dark"] .cm-critic-highlight': {
    backgroundColor: 'rgba(255, 196, 64, 0.22)',
  },
  '.cm-critic-gutter': {
    minWidth: '16px',
  },
  '.cm-critic-gutter-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    color: 'var(--text-faint)',
    cursor: 'pointer',
    transition: 'color 0.12s ease',
  },
  '.cm-critic-gutter-icon:hover': {
    color: 'var(--accent)',
  },
  '.cm-critic-tooltip': {
    maxWidth: '320px',
    padding: '6px 8px',
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    boxShadow: 'var(--shadow-md)',
    fontFamily: 'var(--font-ui)',
    fontSize: '0.82rem',
    lineHeight: '1.4',
    whiteSpace: 'pre-wrap',
  },
});

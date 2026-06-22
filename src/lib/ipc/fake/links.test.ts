// Unit tests for the fake backend's wikilink-aware outbound-link extraction and
// rename-rewrite. Run with `bun test src/lib`. These mirror the Rust backend's
// §1–§4 behaviour (see docs/adr/0004 + the wikilink spec) so backlinks and
// auto-rewrite work identically under Chromium/Playwright.
//
// `outboundLinks` resolves wikilinks against the LIVE fixture (`conceptPaths()`),
// so the bare names below (`codemirror`, `bundle`, …) match the seeded fixture.
// The rewrite tests mutate `FILES` and restore it afterwards.
import { afterEach, describe, expect, test } from 'bun:test';
import { outboundLinks, planRewrites } from './links';
import { FILES } from './store';

const concept = (body: string) => `---\ntype: concept\ntitle: T\n---\n\n${body}\n`;

describe('outboundLinks — wikilinks', () => {
  test('a wikilink resolves by name and feeds backlinks', () => {
    const out = outboundLinks('concepts/links-demo.md', concept('See [[codemirror]].'));
    expect(out).toContain('concepts/codemirror.md');
  });

  test('alias + anchor are stripped before resolution', () => {
    const out = outboundLinks('index.md', concept('[[codemirror#usage|the editor]]'));
    expect(out).toContain('concepts/codemirror.md');
  });

  test('partial-path wikilink resolves by suffix', () => {
    const out = outboundLinks('index.md', concept('[[editor/live-preview]]'));
    expect(out).toContain('concepts/editor/live-preview.md');
  });

  test('unresolved wikilink contributes no edge', () => {
    const out = outboundLinks('index.md', concept('[[no-such-concept]]'));
    expect(out).not.toContain(undefined as unknown as string);
    expect(out.length).toBe(0);
  });

  test('self-target ([[#heading]]) does not create a self-edge', () => {
    const out = outboundLinks('concepts/codemirror.md', concept('Jump to [[#usage]].'));
    expect(out).not.toContain('concepts/codemirror.md');
  });

  test('wikilinks inside code fences / inline code are skipped', () => {
    const body = ['`[[codemirror]]`', '', '```', '[[bundle]]', '```'].join('\n');
    const out = outboundLinks('index.md', concept(body));
    expect(out).not.toContain('concepts/codemirror.md');
    expect(out).not.toContain('concepts/bundle.md');
  });

  test('embeds ![[ … ]] are not links (deferred)', () => {
    const out = outboundLinks('index.md', concept('![[codemirror]]'));
    expect(out).not.toContain('concepts/codemirror.md');
  });
});

describe('planRewrites — wikilinks', () => {
  // Snapshot/restore the live FILES so each test is isolated.
  let snapshot: Record<string, string>;
  const setFiles = (files: Record<string, string>) => {
    snapshot = { ...FILES };
    for (const k of Object.keys(FILES)) delete FILES[k];
    Object.assign(FILES, files);
  };
  afterEach(() => {
    if (snapshot) {
      for (const k of Object.keys(FILES)) delete FILES[k];
      Object.assign(FILES, snapshot);
      snapshot = undefined as unknown as Record<string, string>;
    }
  });

  test('bare wikilink is rewritten on a basename change', () => {
    setFiles({
      'old.md': concept('# Old'),
      'linker.md': concept('See [[old]] and [[old|the label]].'),
    });
    const { summary, writes } = planRewrites('old.md', 'new.md');
    expect(summary.filesChanged).toBe(1);
    expect(summary.linksChanged).toBe(2);
    const rewritten = writes.get('linker.md')!;
    expect(rewritten).toContain('[[new]]');
    expect(rewritten).toContain('[[new|the label]]'); // alias preserved
  });

  test('a pure folder move leaves bare wikilinks untouched', () => {
    setFiles({
      'a/target.md': concept('# Target'),
      'linker.md': concept('See [[target]].'),
    });
    // Move the folder a/ -> b/: basename stays "target", so [[target]] is fine.
    const { summary, writes } = planRewrites('a', 'b');
    // The moved file itself has no outbound wikilinks; the linker is untouched.
    expect(writes.has('linker.md')).toBe(false);
    expect(summary.linksChanged).toBe(0);
  });

  test('partial-path wikilink is rewritten to a resolving suffix on move', () => {
    setFiles({
      'src/target.md': concept('# Target'),
      // A duplicate basename that sorts BEFORE the moved file's new folder, so a
      // bare `target` would resolve to it — forcing the rewrite to keep a path.
      'aaa/target.md': concept('# Other'),
      'linker.md': concept('See [[src/target#sec|label]].'),
    });
    const { writes } = planRewrites('src/target.md', 'zzz/target.md');
    const rewritten = writes.get('linker.md')!;
    // After the move, bare `target` resolves to aaa/target.md (alphabetical), so
    // the rewrite must keep the disambiguating folder + preserve anchor + alias.
    expect(rewritten).toContain('[[zzz/target#sec|label]]');
  });
});

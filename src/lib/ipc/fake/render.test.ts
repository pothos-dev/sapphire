import { describe, expect, test } from 'bun:test';
import { renderConcept } from './render';

// The fake renderer is a minimal stand-in for the Rust core, but it must emit
// the SAME citation markup so the web viewer / Playwright path matches export.
describe('renderConcept citations', () => {
  test('inline references become superscript links', () => {
    const { html } = renderConcept('deepen umami and body.[6][7][8]\n');
    // The `[n]` brackets are kept around the clickable number.
    expect(html).toContain('<sup class="citation-ref"><a href="#cite-6">[6]</a></sup>');
    expect(html).toContain('href="#cite-7">[7]<');
    expect(html).toContain('href="#cite-8">[8]<');
    // The bracketed number only appears inside the superscript anchor, never as
    // a stray bare token alongside it.
    expect(html).not.toContain('</a></sup>[7]');
  });

  test('a citation-table row is a literal, anchored (non-superscript) target', () => {
    const { html } = renderConcept('body.[6]\n\n[6] Kokumi source.\n');
    expect(html).toContain('<a id="cite-6" class="citation-def">[6]</a>');
    expect(html).not.toContain('<sup class="citation-ref"><a href="#cite-6">[6]</a></sup> Kokumi');
  });

  test('a space-preceded bracketed number is left alone', () => {
    const { html } = renderConcept('a paragraph [6] mid-sentence\n');
    expect(html).toContain('[6]');
    expect(html).not.toContain('citation-ref');
    expect(html).not.toContain('citation-def');
  });
});

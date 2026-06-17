// Unit tests for frontmatter parse / serialize / round-trip (ADR 0003).
// Run with `bun test src/lib`. Pins the structured Property model behavior,
// including verbatim round-tripping of complex entries and key renaming.
import { describe, expect, test } from 'bun:test';
import {
  isTypeMissing,
  joinConcept,
  parseProperties,
  renameProperty,
  scaffoldConcept,
  serializeFrontmatter,
  splitFrontmatter,
  titleFromFilename,
  type Property,
} from './frontmatter';

describe('splitFrontmatter', () => {
  test('no frontmatter: whole content is body', () => {
    const r = splitFrontmatter('just a body\n');
    expect(r.hasFrontmatter).toBe(false);
    expect(r.body).toBe('just a body\n');
  });

  test('unterminated block is not treated as frontmatter', () => {
    const r = splitFrontmatter('---\ntype: x\nno close here\n');
    expect(r.hasFrontmatter).toBe(false);
  });

  test('captures delimiters and body verbatim', () => {
    const r = splitFrontmatter('---\ntype: note\n---\nBody\n');
    expect(r.hasFrontmatter).toBe(true);
    expect(r.yaml).toBe('type: note\n');
    expect(r.open).toBe('---\n');
    expect(r.close).toBe('---\n');
    expect(r.body).toBe('Body\n');
  });
});

describe('parseProperties', () => {
  test('classifies scalars, lists, and missing type', () => {
    const props = parseProperties('---\ntype: note\ntitle: Hi\ntags: [a, b]\n---\nx\n');
    expect(props).toEqual([
      { key: 'type', kind: 'scalar', scalar: 'note' },
      { key: 'title', kind: 'scalar', scalar: 'Hi' },
      { key: 'tags', kind: 'list', list: ['a', 'b'] },
    ]);
  });

  test('no frontmatter yields no properties', () => {
    expect(parseProperties('plain body')).toEqual([]);
  });

  test('nested map is captured as a complex entry', () => {
    const props = parseProperties('---\nnested:\n  x: 1\n---\nbody\n');
    expect(props).toHaveLength(1);
    expect(props[0].key).toBe('nested');
    expect(props[0].kind).toBe('complex');
    expect(props[0].entry).toBeDefined();
  });
});

describe('serializeFrontmatter / joinConcept round-trip', () => {
  test('simple frontmatter round-trips byte-for-byte', () => {
    const content = '---\ntype: note\ntitle: Hi\ntags: [a, b]\n---\nBody text\n';
    const { body } = splitFrontmatter(content);
    const props = parseProperties(content);
    expect(joinConcept(props, body)).toBe(content);
  });

  test('a complex entry re-emits verbatim', () => {
    const content = '---\nnested:\n  x: 1\n  y: 2\n---\nbody\n';
    const { body } = splitFrontmatter(content);
    const props = parseProperties(content);
    expect(joinConcept(props, body)).toBe(content);
  });

  test('empty property list emits no block', () => {
    expect(serializeFrontmatter([])).toBe('');
  });

  test('unnamed (uncommitted) rows are omitted', () => {
    const props: Property[] = [
      { key: '', kind: 'scalar', scalar: 'x' },
      { key: 'type', kind: 'scalar', scalar: 'note' },
    ];
    expect(serializeFrontmatter(props)).toBe('---\ntype: note\n---\n');
  });

  test('empty scalar serializes as a bare key', () => {
    expect(serializeFrontmatter([{ key: 'type', kind: 'scalar', scalar: '' }])).toBe(
      '---\ntype:\n---\n',
    );
  });
});

describe('isTypeMissing', () => {
  test('true when absent or empty, false when present', () => {
    expect(isTypeMissing([])).toBe(true);
    expect(isTypeMissing([{ key: 'type', kind: 'scalar', scalar: '' }])).toBe(true);
    expect(isTypeMissing([{ key: 'type', kind: 'scalar', scalar: 'note' }])).toBe(false);
  });
});

describe('renameProperty', () => {
  test('scalar/list rename just changes the key', () => {
    expect(renameProperty({ key: 'a', kind: 'scalar', scalar: '1' }, 'b')).toEqual({
      key: 'b',
      kind: 'scalar',
      scalar: '1',
    });
  });

  test('complex rename rewrites the key in the verbatim entry, preserving the value', () => {
    const [prop] = parseProperties('---\nnested:\n  x: 1\n---\nbody\n');
    const renamed = renameProperty(prop, 'renamed');
    expect(renamed.key).toBe('renamed');
    expect(renamed.entry!.startsWith('renamed:')).toBe(true);
    expect(renamed.entry).toContain('  x: 1');
  });
});

describe('titleFromFilename / scaffoldConcept', () => {
  test('humanizes a filename into a title', () => {
    expect(titleFromFilename('my-note.md')).toBe('My note');
    expect(titleFromFilename('dir/foo_bar.md')).toBe('Foo bar');
    expect(titleFromFilename('.md')).toBe('');
  });

  test('scaffold emits an empty type and a derived title', () => {
    expect(scaffoldConcept('my-note.md')).toBe('---\ntype:\ntitle: My note\n---\n\n');
  });
});

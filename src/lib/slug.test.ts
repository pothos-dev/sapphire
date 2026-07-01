import { describe, expect, test } from 'bun:test';
import { slugify, slugifyHeadings } from './slug';

describe('slugify', () => {
  test('lowercases and hyphenates spaces', () => {
    expect(slugify('Deep Section')).toBe('deep-section');
    expect(slugify('Hello World')).toBe('hello-world');
  });

  test('drops punctuation and symbols', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('What is C++?')).toBe('what-is-c');
    expect(slugify('foo.bar')).toBe('foobar');
    expect(slugify('50% off')).toBe('50-off');
  });

  test('keeps hyphens and underscores', () => {
    expect(slugify('already-slugged')).toBe('already-slugged');
    expect(slugify('snake_case_name')).toBe('snake_case_name');
  });

  test('runs of whitespace become runs of hyphens (GitHub behaviour)', () => {
    expect(slugify('a  b')).toBe('a--b');
  });

  test('trims leading/trailing whitespace', () => {
    expect(slugify('  Setup  ')).toBe('setup');
    // A hand-typed anchor with stray space slugs the same as the heading.
    expect(slugify(' deep section ')).toBe('deep-section');
  });

  test('keeps digits and unicode letters', () => {
    expect(slugify('Section 2')).toBe('section-2');
    expect(slugify('Café Menu')).toBe('café-menu');
  });

  test('backward-compatible: literal heading text and its slug collide', () => {
    // An old `[[p#Deep Section]]` literal anchor and a new `#deep-section`
    // anchor both slug to the same value, so both resolve to `## Deep Section`.
    expect(slugify('Deep Section')).toBe(slugify('deep-section'));
  });
});

describe('slugifyHeadings', () => {
  test('de-duplicates repeated slugs in document order', () => {
    expect(slugifyHeadings(['Notes', 'Notes', 'Notes'])).toEqual([
      'notes',
      'notes-1',
      'notes-2',
    ]);
  });

  test('distinct headings keep bare slugs', () => {
    expect(slugifyHeadings(['Intro', 'Setup', 'Usage'])).toEqual([
      'intro',
      'setup',
      'usage',
    ]);
  });

  test('collisions after slugging still de-duplicate', () => {
    // "Foo!" and "Foo" both slug to "foo".
    expect(slugifyHeadings(['Foo!', 'Foo'])).toEqual(['foo', 'foo-1']);
  });
});

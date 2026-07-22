import { test, expect, afterEach } from 'bun:test';
import { parseFileChange, httpWriteError, httpBackend, CLIENT_ID } from './http';

// Pure parsing of an SSE `data:` payload into a `FileChange` (the `EventSource`
// bridge in `onFileChanged` only forwards a non-null result to the callback).

test('parses a well-formed change payload for each kind', () => {
  for (const kind of ['created', 'modified', 'removed'] as const) {
    expect(parseFileChange(JSON.stringify({ kind, paths: ['a/b.md'] }))).toEqual({
      kind,
      paths: ['a/b.md'],
    });
  }
});

test('parses multiple paths', () => {
  expect(parseFileChange('{"kind":"modified","paths":["x.md","y/z.md"]}')).toEqual({
    kind: 'modified',
    paths: ['x.md', 'y/z.md'],
  });
});

test('rejects malformed JSON', () => {
  expect(parseFileChange('not json')).toBeNull();
  expect(parseFileChange('')).toBeNull();
});

test('rejects an unknown kind or wrong-typed fields', () => {
  expect(parseFileChange('{"kind":"renamed","paths":["a.md"]}')).toBeNull();
  expect(parseFileChange('{"kind":"created"}')).toBeNull();
  expect(parseFileChange('{"kind":"created","paths":"a.md"}')).toBeNull();
  expect(parseFileChange('{"kind":"created","paths":[1,2]}')).toBeNull();
});

// --- origin stamping (ticket 08) -------------------------------------------

test('carries a well-formed web-write origin through', () => {
  const change = parseFileChange(
    '{"kind":"modified","paths":["a.md"],"origin":{"clientId":"tab-1","author":{"name":"Ada"}}}',
  );
  expect(change).toEqual({
    kind: 'modified',
    paths: ['a.md'],
    origin: { clientId: 'tab-1', author: { name: 'Ada' } },
  });
});

test('drops a malformed origin but keeps the change', () => {
  // Missing author.name — the change is still valid, just un-attributed.
  const change = parseFileChange('{"kind":"modified","paths":["a.md"],"origin":{"clientId":"t"}}');
  expect(change).toEqual({ kind: 'modified', paths: ['a.md'] });
  expect(change?.origin).toBeUndefined();
});

// --- write error mapping (ticket 07 §8) ------------------------------------

test('httpWriteError maps each status to a message', () => {
  expect(httpWriteError(400, 'path escapes the bundle: ../x')).toBe(
    'Invalid path: path escapes the bundle: ../x',
  );
  expect(httpWriteError(401, '')).toContain('signed in');
  expect(httpWriteError(404, 'target folder does not exist')).toBe(
    'Not found: target folder does not exist',
  );
  expect(httpWriteError(409, 'already exists: a.md')).toBe('Conflict: already exists: a.md');
  expect(httpWriteError(500, '')).toBe('Save failed (500)');
});

// --- write request shaping (fetch mock) ------------------------------------

type Captured = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub `fetch` to capture the request and return `response`. */
function stubFetch(response: Response): () => Captured {
  let captured: Captured | undefined;
  globalThis.fetch = ((url: string, init: RequestInit) => {
    captured = { url, init };
    return Promise.resolve(response);
  }) as typeof fetch;
  return () => captured!;
}

test('writeConcept PUTs JSON with the client-id header and resolves on 204', async () => {
  const get = stubFetch(new Response(null, { status: 204 }));
  await expect(httpBackend.writeConcept('a.md', 'hello')).resolves.toBeUndefined();
  const { url, init } = get();
  expect(url).toBe('/api/concept');
  expect(init.method).toBe('PUT');
  expect(JSON.parse(init.body as string)).toEqual({ path: 'a.md', content: 'hello' });
  expect((init.headers as Record<string, string>)['x-sunstone-client']).toBe(CLIENT_ID);
});

test('createConcept and createFolder POST to their nouns', async () => {
  let get = stubFetch(new Response(null, { status: 204 }));
  await httpBackend.createConcept('n.md');
  expect(get().url).toBe('/api/concept');
  expect(get().init.method).toBe('POST');
  expect(JSON.parse(get().init.body as string)).toEqual({ path: 'n.md' });

  get = stubFetch(new Response(null, { status: 204 }));
  await httpBackend.createFolder('sub');
  expect(get().url).toBe('/api/folder');
  expect(JSON.parse(get().init.body as string)).toEqual({ path: 'sub' });
});

test('deletePath DELETEs with a query param, no body', async () => {
  const get = stubFetch(new Response(null, { status: 204 }));
  await httpBackend.deletePath('a/b.md');
  expect(get().url).toBe('/api/concept?path=a%2Fb.md');
  expect(get().init.method).toBe('DELETE');
  expect(get().init.body).toBeUndefined();
});

test('renamePath / movePath POST and parse the RewriteSummary', async () => {
  let get = stubFetch(
    new Response(JSON.stringify({ linksChanged: 3, filesChanged: 2 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await expect(httpBackend.renamePath('a.md', 'b.md')).resolves.toEqual({
    linksChanged: 3,
    filesChanged: 2,
  });
  expect(get().url).toBe('/api/rename');
  expect(JSON.parse(get().init.body as string)).toEqual({ from: 'a.md', to: 'b.md' });

  get = stubFetch(
    new Response(JSON.stringify({ linksChanged: 0, filesChanged: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await httpBackend.movePath('a.md', 'sub');
  expect(get().url).toBe('/api/move');
  expect(JSON.parse(get().init.body as string)).toEqual({ from: 'a.md', toDir: 'sub' });
});

test('rewriteAnchors POSTs target + renames', async () => {
  const get = stubFetch(
    new Response(JSON.stringify({ linksChanged: 1, filesChanged: 1 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  await httpBackend.rewriteAnchors('t.md', [{ from: 'intro', to: 'setup' }]);
  expect(get().url).toBe('/api/rewrite-anchors');
  expect(JSON.parse(get().init.body as string)).toEqual({
    target: 't.md',
    renames: [{ from: 'intro', to: 'setup' }],
  });
});

test('a non-2xx write rejects with the mapped message', async () => {
  stubFetch(new Response('already exists: a.md', { status: 409 }));
  await expect(httpBackend.createConcept('a.md')).rejects.toThrow('Conflict: already exists: a.md');
});

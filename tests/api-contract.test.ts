// The OpenAPI spec (what the SDKs and the developer portal are generated from) describes routes that
// exist, with the methods they answer, and every operation has a unique id.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const spec = readFileSync(new URL('public/openapi.yaml', root), 'utf8');

/** Paths and their methods, read from the spec's `paths:` block (two-space path keys, four-space methods). */
function operations(): { path: string; method: string; operationId?: string }[] {
  const block = spec.slice(spec.indexOf('\npaths:'), spec.indexOf('\ncomponents:'));
  const found: { path: string; method: string; operationId?: string }[] = [];
  let path = '';
  for (const line of block.split('\n')) {
    const p = /^  (\/\S+):\s*$/.exec(line);
    if (p) path = p[1];
    const m = /^    (get|post|put|patch|delete):\s*$/.exec(line);
    if (m) found.push({ path, method: m[1].toUpperCase() });
    const id = /^      operationId: (\S+)/.exec(line);
    if (id) found[found.length - 1].operationId = id[1];
  }
  return found;
}

test('every operation in the spec is a route that answers that method', () => {
  const ops = operations();
  assert.ok(ops.length >= 7);
  for (const { path, method } of ops) {
    const file = new URL(`src/app${path.replace(/\{(\w+)\}/g, '[$1]')}/route.ts`, root);
    assert.ok(existsSync(file), `${path} has no route file`);
    assert.match(readFileSync(file, 'utf8'), new RegExp(`export async function ${method}\\(`), `${method} ${path} is not handled`);
  }
});

test('operation ids are unique, so generated SDK methods are too', () => {
  const ids = operations().map((o) => o.operationId);
  assert.ok(ids.every(Boolean));
  assert.equal(new Set(ids).size, ids.length);
});

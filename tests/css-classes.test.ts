// Every class the stylesheet styles is used somewhere in the app, so dead rules don't pile up. A class
// counts as used when the source names it, or builds it from a prefix (`status-${tone}` covers
// status-ok, status-hold...). The grid library's own classes (ag-*) are styled, not named, here.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const ROOT = new URL('../src/', import.meta.url);

function sources(dir: URL): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sources(new URL(`${entry.name}/`, dir));
    return /\.(tsx?|mjs|js)$/.test(entry.name) ? [readFileSync(new URL(entry.name, dir), 'utf8')] : [];
  });
}

/** Class names in the stylesheet's selectors (not inside url(...) or numbers like .5rem). */
function cssClasses(css: string): Set<string> {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, '{}');
  return new Set([...selectors.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]));
}

/** Classes the stylesheet styles that no source file names or builds. */
function unusedClasses(css: string, code: string): string[] {
  const named = new Set(code.match(/[A-Za-z_][\w-]*/g));
  // Prefixes of classes built at runtime: `status-${...}` -> "status-".
  const prefixes = [...code.matchAll(/([A-Za-z][\w-]*-)\$\{/g)].map((m) => m[1]);
  return [...cssClasses(css)].filter((c) => !c.startsWith('ag-') && !named.has(c) && !prefixes.some((p) => c.startsWith(p))).sort();
}

test('the stylesheet has no unused classes', () => {
  const css = readFileSync(new URL('app/globals.css', ROOT), 'utf8');
  const code = sources(ROOT).join('\n');
  assert.deepEqual(unusedClasses(css, code), []);
});

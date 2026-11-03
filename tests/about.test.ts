import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ABOUT } from '../src/core/about.ts';

test('the server, the CLI and package.json report the same version', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  const cli = await readFile(new URL('../cli/sayso.ts', import.meta.url), 'utf8');
  assert.equal(ABOUT.version, pkg.version);
  assert.equal(/const VERSION = '([^']+)'/.exec(cli)?.[1], pkg.version);
});

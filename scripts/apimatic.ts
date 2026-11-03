// APIMatic builds for the shops API, from the one spec the app serves (public/openapi.yaml) and the
// portal settings in apimatic/src. Needs the APIMatic CLI, signed in once:
// `npm i -g @apimatic/cli` then `apimatic auth login`.
//
//   npm run apimatic -- sdk                 # TypeScript and Python SDKs into sdk/<language>
//   npm run apimatic -- sdk typescript      # one language
//   npm run apimatic -- portal              # the docs portal into public/developers (served at /developers)
//
// The portal's links are absolute, so it is built for one address: PUBLIC_BASE_URL + /developers.
// Rebuild it when the app moves.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const staging = join(root, '.apimatic'); // APIMatic reads <input>/src; kept out of git
const [mode, ...languages] = process.argv.slice(2);

// On Windows apimatic is a .cmd shim, so it runs through the shell: quote paths that may hold spaces.
const windows = process.platform === 'win32';
const quoted = (value: string) => (windows ? `"${value}"` : value);

function apimatic(...args: string[]): void {
  const run = spawnSync('apimatic', args, { stdio: 'inherit', shell: windows });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

rmSync(staging, { recursive: true, force: true });
cpSync(join(root, 'apimatic'), staging, { recursive: true });
mkdirSync(join(staging, 'src', 'spec'), { recursive: true });
cpSync(join(root, 'public', 'openapi.yaml'), join(staging, 'src', 'spec', 'openapi.yaml'));

if (mode === 'sdk') {
  for (const language of languages.length ? languages : ['typescript', 'python']) {
    console.log(`\nGenerating the ${language} SDK into sdk/${language}`);
    // APIMatic adds the language folder itself.
    apimatic('sdk', 'generate', '--language', language, '--input', quoted(staging), '--destination', quoted(join(root, 'sdk')), '--force');
  }
} else if (mode === 'portal') {
  const url = `${(process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/developers`;
  const settingsFile = join(staging, 'src', 'apimatic.json');
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
  settings.portal.site.url = url;
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  console.log(`\nGenerating the docs portal for ${url} into public/developers`);
  apimatic('portal', 'generate', '--input', quoted(staging), '--destination', quoted(join(root, 'public', 'developers')), '--force');
} else {
  console.error('Usage: npm run apimatic -- sdk [language...] | portal');
  process.exit(2);
}
rmSync(staging, { recursive: true, force: true });

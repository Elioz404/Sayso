// APIMatic builds for the shops API, from the one spec the app serves (public/openapi.yaml) and the
// portal settings in apimatic/src. Runs the APIMatic CLI at a pinned version through npx, only when
// needed (it is large, so it is not a dependency). Signed in once with
// `npx @apimatic/cli@2.0.0 auth login`, or with an API key in APIMATIC_AUTH_KEY (how deploys run it).
//
//   npm run apimatic -- sdk                 # TypeScript and Python SDKs into sdk/<language>
//   npm run apimatic -- sdk typescript      # one language
//   npm run apimatic -- portal              # the docs portal into public/developers (served at /developers)
//   npm run apimatic -- portal --optional   # for deploys: skip without a key, warn instead of failing
//
// The portal's links are absolute, so it is built for one address: PUBLIC_BASE_URL + /developers.
// Rebuild it when the app moves.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const staging = join(root, '.apimatic'); // APIMatic reads <input>/src; kept out of git
const args = process.argv.slice(2);
const optional = args.includes('--optional');
const [mode, ...languages] = args.filter((a) => a !== '--optional');
const authKey = process.env.APIMATIC_AUTH_KEY || undefined;
const CLI = '@apimatic/cli@2.0.0';

// On Windows npx is a .cmd shim, so it runs through the shell: quote paths that may hold spaces.
const windows = process.platform === 'win32';
const quoted = (value: string) => (windows ? `"${value}"` : value);

/** Runs the CLI; true when it succeeded. */
function apimatic(...cliArgs: string[]): boolean {
  const auth = authKey ? ['--auth-key', authKey] : [];
  return spawnSync('npx', ['--yes', CLI, ...cliArgs, ...auth], { stdio: 'inherit', shell: windows }).status === 0;
}

if (optional && !authKey) {
  console.log('No APIMATIC_AUTH_KEY: skipping the APIMatic build (the app hides its link to the portal).');
  process.exit(0);
}

rmSync(staging, { recursive: true, force: true });
cpSync(join(root, 'apimatic'), staging, { recursive: true });
mkdirSync(join(staging, 'src', 'spec'), { recursive: true });
cpSync(join(root, 'public', 'openapi.yaml'), join(staging, 'src', 'spec', 'openapi.yaml'));

let ok = true;
if (mode === 'sdk') {
  for (const language of languages.length ? languages : ['typescript', 'python']) {
    console.log(`\nGenerating the ${language} SDK into sdk/${language}`);
    // APIMatic adds the language folder itself.
    ok &&= apimatic('sdk', 'generate', '--language', language, '--input', quoted(staging), '--destination', quoted(join(root, 'sdk')), '--force');
  }
} else if (mode === 'portal') {
  const url = `${(process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/developers`;
  const settingsFile = join(staging, 'src', 'apimatic.json');
  const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
  settings.portal.site.url = url;
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  console.log(`\nGenerating the docs portal for ${url} into public/developers`);
  ok = apimatic('portal', 'generate', '--input', quoted(staging), '--destination', quoted(join(root, 'public', 'developers')), '--force');
} else {
  console.error('Usage: npm run apimatic -- sdk [language...] | portal [--optional]');
  process.exit(2);
}
rmSync(staging, { recursive: true, force: true });

if (!ok) {
  if (!optional) process.exit(1);
  // A deploy goes on without the portal; the app notices it is missing and hides the link.
  console.warn('APIMatic build failed; continuing without the developer portal.');
}

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';
const root = new URL('./', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const patch = JSON.parse(await readFile(new URL('cordis.patch.yml', root), 'utf8'));
if (pkg.name !== '@dsh-local/view-e1727a2d-8dfb-4483-8fd4-2a5078b2229e' || pkg.version !== '1.0.0') throw Error('Invalid reserved package identity');
if (pkg.dsh.bundle.patch !== './cordis.patch.yml') throw Error('Invalid patch export');
if (!Array.isArray(patch)) throw Error('Patch must be an array');
for (const op of patch) {
  if (Object.keys(op).join() !== 'insert' || !Array.isArray(op.insert)) throw Error('Only insert operations allowed');
  for (const row of op.insert) {
    if (!row.id.startsWith(pkg.name + ':') || !(row.name === pkg.name || row.name.startsWith(pkg.name + '/'))) throw Error('Out-of-package row');
  }
}
const store = (await readFile(new URL('src/notes-store.js', root), 'utf8')).replaceAll('export function ', 'function ').replaceAll('export async function ', 'async function ');
const client = (await readFile(new URL('src/client.js', root), 'utf8')).replace("import { createNotesStore, noteEditorState, migrateLegacyNotes } from './notes-store.js';", '');
const output = '// Built, standalone DSH client artifact.\n(() => {\n' + store + '\n' + client + '\n})();\n';
new Script(output, { filename: 'dist/client.js' });
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/client.js', root), output);
await writeFile(new URL('dist/index.js', root), await readFile(new URL('src/host.js', root), 'utf8'));
await writeFile(new URL('dist/disk-store.js', root), await readFile(new URL('src/disk-store.js', root), 'utf8'));
for (const locale of ['zh','en']) {
  const json = JSON.parse(await readFile(new URL('locale/' + locale + '.json', root), 'utf8'));
  if (!json.meta?.title || !json.meta?.description) throw Error('Missing localized metadata');
}
console.log('Built standalone host and client exports; manifest, patch, locales and client syntax valid.');

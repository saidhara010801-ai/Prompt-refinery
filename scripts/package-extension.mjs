import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import AdmZip from 'adm-zip';

const projectRoot = resolve(import.meta.dirname, '..');
const extensionDirectory = join(projectRoot, 'extension');
const outputPath = join(projectRoot, 'public', 'downloads', 'clarift-browser-extension.zip');
const syncUnpacked = process.argv.includes('--sync-unpacked');
const previousZip = syncUnpacked ? await readFile(outputPath).then((buffer) => new AdmZip(buffer)).catch(() => null) : null;
const requiredFiles = ['manifest.json', 'background.js', 'content.js', 'content.css', 'options.html', 'options.js', 'options.css', 'popup.html', 'popup.js', 'popup.css', 'context-core.js', 'context-capture.js', 'context-history.js', 'page-access.js', 'context.html', 'context.js', 'context.css'];

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat().sort();
}

const files = await filesUnder(extensionDirectory);
const archiveNames = files.map((path) => relative(extensionDirectory, path).replaceAll('\\', '/'));
for (const requiredFile of requiredFiles) {
  if (!archiveNames.includes(requiredFile)) throw new Error(`Extension package is missing ${requiredFile}.`);
}

const zip = new AdmZip();
for (let index = 0; index < files.length; index += 1) {
  zip.addFile(archiveNames[index], await readFile(files[index]));
  const entry = zip.getEntry(archiveNames[index]);
  if (entry) entry.header.time = new Date('2026-01-01T00:00:00.000Z');
}

await mkdir(dirname(outputPath), { recursive: true });
zip.writeZip(outputPath);
console.log(`Packaged ${files.length} extension files at ${relative(projectRoot, outputPath)}.`);

// Opt-in refresh of an existing extracted test copy. Preserve files the user edited
// and anything that was not in the previous package; never remove extra files.
if (syncUnpacked) {
  const unpacked = join(dirname(outputPath), 'clarift-browser-extension');
  const resolved = await realpath(unpacked).catch(() => null);
  if (!resolved || !resolved.startsWith(`${await realpath(projectRoot)}${sep}`)) {
    console.log('No existing unpacked test copy inside the workspace to refresh.');
  } else {
    let updated = 0;
    for (let index = 0; index < files.length; index += 1) {
      const target = resolve(resolved, archiveNames[index]);
      if (!target.startsWith(`${resolved}${sep}`)) throw new Error('Unpacked path escaped its target directory.');
      const actual = await realpath(target).catch(() => target);
      if (actual !== target) throw new Error('Refusing to replace a linked file in the unpacked test copy.');
      const existing = await readFile(target).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      const previous = previousZip?.getEntry(archiveNames[index])?.getData();
      if (existing && (!previous || !existing.equals(previous))) {
        console.log(`Preserved changed unpacked file: ${archiveNames[index]}`);
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(files[index]));
      updated += 1;
    }
    console.log(`Refreshed ${updated} files in the existing unpacked test copy.`);
  }
}

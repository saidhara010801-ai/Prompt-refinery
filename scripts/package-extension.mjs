import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import AdmZip from 'adm-zip';

const projectRoot = resolve(import.meta.dirname, '..');
const extensionDirectory = join(projectRoot, 'extension');
const outputPath = join(projectRoot, 'public', 'downloads', 'clarift-browser-extension.zip');
const requiredFiles = ['manifest.json', 'background.js', 'content.js', 'content.css', 'options.html', 'options.js', 'options.css', 'popup.html', 'popup.js', 'popup.css'];

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

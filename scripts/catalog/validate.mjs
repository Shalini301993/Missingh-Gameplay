// Checks data/catalog/ for shape, vocabulary and duplicates.
//   node scripts/catalog/validate.mjs [--min 1000]
// Schema problems fail the run; being under --min only warns.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CATEGORY_IDS, itemProblems } from '../../src/core/vocab.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function validateCatalog(dir = path.join(ROOT, 'data/catalog')) {
  const errors = [];
  const manifest = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
  const ids = new Set();
  let total = 0;
  for (const entry of manifest.categories) {
    if (!CATEGORY_IDS.includes(entry.id)) errors.push(`manifest: unknown category ${entry.id}`);
    const items = JSON.parse(await readFile(path.join(dir, entry.file), 'utf8'));
    if (items.length !== entry.count) errors.push(`${entry.file}: manifest says ${entry.count}, file has ${items.length}`);
    for (const item of items) {
      total += 1;
      for (const problem of itemProblems(item)) errors.push(`${entry.file}: ${item?.id ?? '?'}: ${problem}`);
      if (item.category !== entry.id) errors.push(`${entry.file}: ${item.id} is in the wrong file`);
      if (ids.has(item.id)) errors.push(`duplicate id ${item.id}`);
      ids.add(item.id);
    }
  }
  if (manifest.total !== total) errors.push(`manifest total ${manifest.total} but counted ${total}`);
  return { errors, total, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const minIndex = process.argv.indexOf('--min');
  const min = minIndex > -1 ? Number(process.argv[minIndex + 1]) : 0;
  const { errors, total, manifest } = await validateCatalog();
  for (const error of errors.slice(0, 50)) console.error(`✗ ${error}`);
  if (errors.length > 50) console.error(`… and ${errors.length - 50} more`);
  console.log(`${total} items, ${manifest.categories.length} categories, ${errors.length} problems`);
  if (min && total < min) console.log(`::warning::Catalog has ${total} items, below the target of ${min}`);
  process.exit(errors.length ? 1 : 0);
}

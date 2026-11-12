// End-to-end smoke test in a real browser: node tests/smoke.mjs [screenshot-dir]
// Needs Playwright with Chromium available. Wikipedia is mocked, so no network is required.
// Most of the run uses a small made-up catalog so it does not depend on what the real one holds;
// the last step plays one pull against the real catalog.

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startServer } from '../scripts/serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const shots = process.argv[2];
const PORT = 8793;
const HOME = `http://127.0.0.1:${PORT}/`;
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const LOOKED_UP = 'https://upload.wikimedia.org/fake/looked-up.png';

// A made-up catalog: 30 items in three categories.
//   pictures: 'some' gives every other item a picture; 'none' gives no item one.
//   source:   what the manifest says built it ('seeds' means pictures are looked up while playing).
function madeUpCatalog({ pictures, source }) {
  const categories = ['perfumes', 'books', 'toys'];
  const rarities = ['common', 'common', 'common', 'rare', 'legendary'];
  const files = {};
  for (const category of categories) {
    files[`${category}.json`] = Array.from({ length: 10 }, (_, i) => ({
      id: `${category}/item-${i}`, title: `Test ${category} ${i}`, kind: i % 2 ? 'iconic' : 'generic', category,
      blurb: `Made-up object number ${i} in ${category}.`, wiki: `Test_${category}_${i}`,
      image: pictures === 'some' && i % 2 ? `https://upload.wikimedia.org/fake/${category}-${i}.png` : null,
      vibes: ['luxe'], moods: ['calm'], colours: ['gold'], budget: 'splurge', rarity: rarities[i % 5], source: 'seed',
    }));
  }
  files['index.json'] = {
    built: '2026-01-01', source, total: 30, categories: categories.map((id) => ({ id, file: `${id}.json`, count: 10 })),
  };
  return files;
}

async function openGame(browser, { viewport, reducedMotion, catalog }) {
  const context = await browser.newContext({ viewport, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const seen = { errors: [], lookups: 0 };
  page.on('pageerror', (error) => seen.errors.push(error.message));
  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', (route) => {
    seen.lookups += 1;
    return route.fulfill({ json: { thumbnail: { source: LOOKED_UP } }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//, (route) => route.fulfill({ body: PIXEL, contentType: 'image/png' }));
  if (catalog) {
    await page.route('**/data/catalog/*.json', (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      return catalog[name] ? route.fulfill({ json: catalog[name] }) : route.fulfill({ status: 404, body: 'Not found' });
    });
  }
  return { context, page, seen };
}

async function run(browser, name, { viewport, reducedMotion, pictures, source }) {
  const { context, page, seen } = await openGame(browser, { viewport, reducedMotion, catalog: madeUpCatalog({ pictures, source }) });
  const shot = async (label) => { if (shots) await page.screenshot({ path: `${shots}/${name}-${label}.png` }); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('curio-capsule:v1')));
  const tokens = async () => Number(await page.locator('#tokens strong').textContent());
  const noOverflow = async (label) => assert.ok(
    await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth), `${name}: horizontal overflow at ${label}`);

  // First visit: the likes sheet opens by itself.
  await page.goto(`${HOME}?seed=5`);
  await page.waitForSelector('#profile-dialog[open]');
  await shot('1-welcome');
  for (const label of ['Perfumes', 'Books', 'Luxe', 'Romantic', 'Gold', 'Splurge']) {
    await page.locator('#profile-dialog').getByRole('button', { name: label, exact: true }).first().click();
  }
  await page.click('#save-profile');
  await page.waitForSelector('#profile-dialog:not([open])', { state: 'attached' });
  let state = await stored();
  assert.deepEqual(state.profile.categories, ['perfumes', 'books']);
  assert.equal(state.profile.budget, 'splurge');
  assert.equal(state.profile.done, true);
  assert.match(await page.locator('#likes-summary').textContent(), /Perfumes, Books · Luxe/);
  await page.waitForFunction(() => !document.getElementById('pull').disabled);
  await page.waitForSelector('#stage canvas');
  assert.equal(await tokens(), 10);
  assert.match(await page.locator('#catalog-note').textContent(), /^30 objects in the cabinet across 3 categories/);
  await noOverflow('machine');
  await page.waitForTimeout(700);
  await shot('2-machine');

  // Pull: a card appears, a token is spent, the item is collected.
  await page.click('#pull');
  await page.waitForSelector('#card-dialog[open]', { timeout: 15000 });
  const title = await page.locator('#card-title').textContent();
  assert.equal(await tokens(), 9);
  state = await stored();
  assert.equal(Object.keys(state.collection).length, 1);
  const pulled = Object.values(state.collection)[0].item;
  assert.equal(pulled.title, title);
  const links = await page.locator('#card-dialog .links a').evaluateAll((list) => list.map((a) => a.href));
  assert.equal(links.length, 3);
  assert.equal(links[0], `https://en.wikipedia.org/wiki/${pulled.wiki}`);
  assert.match(links[1], /^https:\/\/duckduckgo\.com\/\?q=/);
  assert.match(links[2], /^https:\/\/www\.google\.com\/search\?tbm=shop&q=/);
  assert.ok(decodeURIComponent(links[1]).includes(title));

  if (source === 'seeds') {
    // A picture is shown and credited: the catalog's own, or one looked up from Wikipedia.
    await page.waitForSelector('#card-dialog .plate img');
    await page.waitForFunction(() => !document.querySelector('#card-dialog .plate figcaption').hidden);
    assert.equal(await page.locator('#card-dialog .plate img').getAttribute('src'), pulled.image ?? LOOKED_UP);
    assert.equal(seen.lookups, pulled.image ? 0 : 1);
  } else {
    // A Wikipedia-built catalog is not looked up again: no picture means a lettered plate, no credit.
    await page.waitForSelector('#card-dialog .plate-blank');
    assert.equal(await page.locator('#card-dialog .plate img').count(), 0);
    assert.equal(await page.locator('#card-dialog .plate figcaption').isHidden(), true);
    assert.equal(seen.lookups, 0);
  }
  await noOverflow('card');
  await shot('3-card');

  await page.click('#favourite');
  state = await stored();
  assert.deepEqual(state.favourites, [pulled.id]);
  await page.click('#close-card');
  assert.equal(await page.locator('#collection-count').textContent(), '1');
  assert.equal(await page.locator('#recent .recent-title').first().textContent(), title);

  // The dial on the canvas pulls too.
  const box = await page.locator('#stage canvas').boundingBox();
  const dial = [box.x + box.width * (392 / 600), box.y + box.height * (522 / 640)];
  await page.mouse.click(...dial);
  await page.waitForSelector('#card-dialog[open]', { timeout: 15000 });
  await page.click('#close-card');
  assert.equal(await tokens(), 8);

  // Collection book.
  await page.click('#open-collection');
  await page.waitForSelector('#collection-dialog[open]');
  assert.equal(await page.locator('#collection-dialog .tile').count(), Object.keys((await stored()).collection).length);
  await noOverflow('collection');
  await shot('4-collection');
  await page.locator('#collection-dialog').getByRole('button', { name: /Favourites/ }).click();
  assert.equal(await page.locator('#collection-dialog .tile').count(), 1);
  await page.locator('#collection-dialog .tile').first().click();
  await page.waitForSelector('#card-dialog[open]');
  assert.equal(await page.locator('#card-title').textContent(), title);
  await page.click('#close-card');
  await page.click('#close-collection');

  // Mood chips save straight away.
  await page.locator('#mood-chips').getByRole('button', { name: 'Calm' }).click();
  assert.equal((await stored()).profile.mood, 'calm');

  // Reload keeps everything and does not show the welcome sheet again.
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('pull').disabled);
  assert.equal(await tokens(), 8);
  assert.equal(await page.locator('#profile-dialog[open]').count(), 0);
  assert.equal(await page.locator('#mood-chips [aria-pressed="true"]').textContent(), 'Calm');

  // Spend everything: pulling stops at zero.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('pull').disabled);
  for (let i = 0; i < 40 && !(await page.locator('#pull').isDisabled()); i += 1) {
    await page.click('#pull');
    await page.waitForSelector('#card-dialog[open]');
    await page.click('#close-card');
  }
  assert.equal(await tokens(), 0);
  assert.ok(await page.locator('#pull').isDisabled());
  assert.equal(await page.locator('#pull').textContent(), 'Out of tokens');
  const count = async () => Object.values((await stored()).collection).reduce((sum, entry) => sum + entry.count, 0);
  const before = await count();
  await page.mouse.click(...dial);
  await page.waitForTimeout(400);
  assert.equal(await count(), before, 'no pull without tokens');
  await shot('5-empty');

  // A new day refills the tokens and clears the mood.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('curio-capsule:v1'));
    saved.economy.lastRefill = '2000-01-01';
    saved.profile.moodDate = '2000-01-01';
    localStorage.setItem('curio-capsule:v1', JSON.stringify(saved));
  });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('pull').disabled);
  assert.equal(await tokens(), 10);
  assert.equal((await stored()).profile.mood, null, 'mood resets on a new day');

  assert.deepEqual(seen.errors, [], `${name}: page errors`);
  await context.close();
  console.log(`✓ ${name}`);
}

// One pull against the catalog that is actually in the repository.
async function realCatalog(browser) {
  const manifest = JSON.parse(await readFile(new URL('../data/catalog/index.json', import.meta.url), 'utf8'));
  const { context, page, seen } = await openGame(browser, { viewport: { width: 1280, height: 800 }, reducedMotion: true });
  await page.goto(`${HOME}?seed=11`);
  await page.waitForSelector('#profile-dialog[open]');
  await page.click('#save-profile');
  await page.waitForFunction(() => !document.getElementById('pull').disabled);
  const note = await page.locator('#catalog-note').textContent();
  assert.ok(note.startsWith(`${manifest.total.toLocaleString('en')} objects in the cabinet across ${manifest.categories.length} categories`), note);
  for (let i = 0; i < 5; i += 1) {
    await page.click('#pull');
    await page.waitForSelector('#card-dialog[open]');
    assert.ok((await page.locator('#card-title').textContent()).trim().length > 0);
    assert.ok((await page.locator('#card-dialog .blurb').textContent()).trim().length > 10);
    if (shots && i === 0) { await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/real-card.png` }); }
    await page.click('#close-card');
  }
  assert.equal(await page.locator('#collection-count').textContent(), String(Object.keys(
    await page.evaluate(() => JSON.parse(localStorage.getItem('curio-capsule:v1')).collection)).length));
  assert.deepEqual(seen.errors, [], 'real catalog: page errors');
  await context.close();
  console.log(`✓ real catalog (${manifest.total} items)`);
}

const server = await startServer(PORT);
const browser = await chromium.launch();
try {
  await run(browser, 'desktop', { viewport: { width: 1280, height: 800 }, reducedMotion: false, pictures: 'some', source: 'seeds' });
  await run(browser, 'phone', { viewport: { width: 390, height: 844 }, reducedMotion: true, pictures: 'none', source: 'seeds+wikipedia' });
  await realCatalog(browser);
  console.log('Smoke test passed.');
} finally {
  await browser.close();
  server.close();
}

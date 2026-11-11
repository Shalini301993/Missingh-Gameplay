// End-to-end smoke test in a real browser: node tests/smoke.mjs [screenshot-dir]
// Needs Playwright with Chromium available. Wikipedia is mocked, so no network is required.

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { startServer } from '../scripts/serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const shots = process.argv[2];
const PORT = 8793;
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

async function run(browser, name, viewport, reducedMotion) {
  const context = await browser.newContext({ viewport, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', (route) => route.fulfill({
    json: { thumbnail: { source: 'https://upload.wikimedia.org/fake/thumb.png' } },
    headers: { 'access-control-allow-origin': '*' },
  }));
  await page.route('https://upload.wikimedia.org/**', (route) => route.fulfill({ body: PIXEL, contentType: 'image/png' }));
  const shot = async (label) => { if (shots) await page.screenshot({ path: `${shots}/${name}-${label}.png` }); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('curio-capsule:v1')));
  const tokens = async () => Number(await page.locator('#tokens strong').textContent());
  const noOverflow = async (label) => assert.ok(
    await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth), `${name}: horizontal overflow at ${label}`);

  // First visit: the likes sheet opens by itself.
  await page.goto(`http://127.0.0.1:${PORT}/?seed=5`);
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
  await noOverflow('machine');
  await page.waitForTimeout(700);
  await shot('2-machine');

  // Pull: a card appears, a token is spent, the item is collected.
  await page.click('#pull');
  await page.waitForSelector('#card-dialog[open]', { timeout: 15000 });
  const title = await page.locator('#card-title').textContent();
  assert.ok(title.trim().length > 0);
  assert.equal(await tokens(), 9);
  const links = await page.locator('#card-dialog .links a').evaluateAll((list) => list.map((a) => a.href));
  assert.equal(links.length, 3);
  assert.match(links[0], /^https:\/\/en\.wikipedia\.org\/wiki\//);
  assert.match(links[1], /^https:\/\/duckduckgo\.com\/\?q=/);
  assert.match(links[2], /^https:\/\/www\.google\.com\/search\?tbm=shop&q=/);
  assert.ok(decodeURIComponent(links[1]).includes(title));
  // The mocked Wikipedia image is shown and credited.
  await page.waitForSelector('#card-dialog .plate img');
  await page.waitForFunction(() => !document.querySelector('#card-dialog figcaption').hidden);
  await noOverflow('card');
  await shot('3-card');
  await page.click('#favourite');
  state = await stored();
  assert.equal(Object.keys(state.collection).length, 1);
  assert.equal(state.favourites.length, 1);
  assert.equal(state.collection[state.favourites[0]].item.title, title);
  await page.click('#close-card');
  assert.equal(await page.locator('#collection-count').textContent(), '1');
  assert.equal(await page.locator('#recent .recent-title').first().textContent(), title);

  // The dial on the canvas pulls too.
  const box = await page.locator('#stage canvas').boundingBox();
  await page.mouse.click(box.x + box.width * (392 / 600), box.y + box.height * (522 / 640));
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
  const before = Object.values((await stored()).collection).reduce((sum, entry) => sum + entry.count, 0);
  await page.mouse.click(box.x + box.width * (392 / 600), box.y + box.height * (522 / 640));
  await page.waitForTimeout(400);
  const after = Object.values((await stored()).collection).reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(after, before, 'no pull without tokens');
  await shot('5-empty');

  // A new day refills the tokens.
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

  assert.deepEqual(errors, [], `${name}: page errors`);
  await context.close();
  console.log(`✓ ${name}`);
}

const server = await startServer(PORT);
const browser = await chromium.launch();
try {
  await run(browser, 'desktop', { width: 1280, height: 800 }, false);
  await run(browser, 'phone', { width: 390, height: 844 }, true);
  console.log('Smoke test passed.');
} finally {
  await browser.close();
  server.close();
}

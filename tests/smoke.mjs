// End-to-end smoke test in a real browser: node tests/smoke.mjs [screenshot-dir]
// Needs Playwright with Chromium available. Wikipedia is mocked, so no network is required.
// Most of the run uses a small made-up catalog so it does not depend on what the real one holds;
// then it plays against the real catalog and renders all the music offline.

import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startServer } from '../scripts/serve.mjs';
import { levelFor } from '../src/core/play.js';

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
      about: `Made-up ${category} number ${i}`, blurb: `Made-up object number ${i} in ${category}.`, wiki: `Test_${category}_${i}`,
      image: pictures === 'some' && i % 2 ? `https://upload.wikimedia.org/fake/${category}-${i}.png` : null,
      vibes: ['luxe'], moods: ['calm'], colours: ['gold'], budget: 'splurge', rarity: rarities[i % 5], source: 'seed',
    }));
  }
  files['index.json'] = {
    built: '2026-01-01', source, total: 30, categories: categories.map((id) => ({ id, file: `${id}.json`, count: 10 })),
  };
  return files;
}

async function openGame(browser, { viewport, reducedMotion, catalog, locale = 'en-US' }) {
  const context = await browser.newContext({ viewport, locale, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const seen = { errors: [], lookups: 0 };
  page.on('pageerror', (error) => seen.errors.push(error.message));
  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', (route) => {
    seen.lookups += 1;
    return route.fulfill({ json: { thumbnail: { source: LOOKED_UP } }, headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//, (route) => route.fulfill({ body: PIXEL, contentType: 'image/png' }));
  // Shop links open in new tabs; answer them locally so the test never leaves the machine.
  await context.route(/^https:\/\/(www\.)?(amazon|ebay|etsy|nordstrom|sephora|target|flipkart|ikea|thomann|abebooks|bookshop|openlibrary|uk\.bookshop)/, (route) => route.fulfill({ body: 'shop', contentType: 'text/plain' }));
  if (catalog) {
    await page.route('**/data/catalog/*.json', (route) => {
      const name = new URL(route.request().url()).pathname.split('/').pop();
      return catalog[name] ? route.fulfill({ json: catalog[name] }) : route.fulfill({ status: 404, body: 'Not found' });
    });
  }
  return { context, page, seen };
}

const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('curio-capsule:v1')));
const tokens = async (page) => Number(await page.locator('#tokens strong').textContent());

// One pull: press to start the needle, press again to stop it, wait for the card.
async function pullOnce(page, { dial = null } = {}) {
  if (dial) await page.mouse.click(...dial); else await page.click('#pull');
  await page.waitForFunction(() => document.getElementById('pull').textContent === 'Stop!');
  if (dial) await page.mouse.click(...dial); else await page.click('#pull');
  await page.waitForSelector('#card-dialog[open]', { timeout: 20000 });
}

async function run(browser, name, { viewport, reducedMotion, pictures, source }) {
  const { context, page, seen } = await openGame(browser, { viewport, reducedMotion, catalog: madeUpCatalog({ pictures, source }) });
  const shot = async (label) => { if (shots) await page.screenshot({ path: `${shots}/${name}-${label}.png` }); };
  const noOverflow = async (label) => assert.ok(
    await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth), `${name}: horizontal overflow at ${label}`);

  // First visit: the likes sheet opens by itself, with the shop region guessed from the browser.
  await page.goto(`${HOME}?seed=5&stop=perfect`);
  await page.waitForSelector('#profile-dialog[open]');
  assert.equal(await page.locator('#region').inputValue(), 'US');
  await shot('1-welcome');
  for (const label of ['Perfumes', 'Books', 'Luxe', 'Romantic', 'Gold', 'Splurge']) {
    await page.locator('#profile-dialog').getByRole('button', { name: label, exact: true }).first().click();
  }
  await page.click('#save-profile');
  await page.waitForSelector('#profile-dialog:not([open])', { state: 'attached' });
  let state = await stored(page);
  assert.deepEqual(state.profile.categories, ['perfumes', 'books']);
  assert.equal(state.profile.budget, 'splurge');
  assert.equal(state.profile.region, 'US');
  assert.equal(state.profile.done, true);
  assert.match(await page.locator('#likes-summary').textContent(), /Perfumes, Books · Luxe/);
  await page.waitForFunction(() => !document.getElementById('pull').disabled);
  await page.waitForSelector('#stage canvas');
  assert.equal(await tokens(page), 10);
  assert.equal(await page.locator('#missions li').count(), 3);
  assert.equal(await page.locator('#level-number').textContent(), '1');
  assert.match(await page.locator('#catalog-note').textContent(), /^30 objects in the cabinet across 3 categories/);
  await noOverflow('machine');
  await page.waitForTimeout(700);
  await shot('2-machine');

  // A pull: the needle starts, stops in the gold, a card opens, the find is saved.
  await page.click('#pull');
  await page.waitForFunction(() => document.getElementById('pull').textContent === 'Stop!');
  assert.ok(await page.locator('#gauge.live').count());
  await page.click('#pull');
  assert.equal(await page.locator('#gauge-verdict').textContent(), 'Perfect!');
  await page.waitForSelector('#card-dialog[open]', { timeout: 20000 });
  const title = await page.locator('#card-title').textContent();
  state = await stored(page);
  assert.equal(Object.keys(state.collection).length, 1);
  const pulled = Object.values(state.collection)[0].item;
  assert.equal(pulled.title, title);
  assert.equal(await tokens(page), state.economy.tokens);
  assert.ok(state.play.xp > 0 && state.play.combo === 1);
  assert.match(await page.locator('#card-dialog .reward').textContent(), /Perfect stop · \+\d+ XP/);
  assert.ok((await page.locator('#card-dialog .quote blockquote').textContent()).trim().length > 10);

  // Where to buy: Amazon first, then the category's shops; plus Wikipedia and a web search.
  const amazon = await page.locator('#buy').getAttribute('href');
  assert.ok(amazon.startsWith('https://www.amazon.com/s?k='), amazon);
  assert.ok(decodeURIComponent(amazon.replace(/\+/g, ' ')).includes(title));
  const shops = await page.locator('#card-dialog .shops a').evaluateAll((list) => list.map((a) => a.href));
  assert.ok(shops.length >= 2 && shops.every((href) => href.startsWith('https://')));
  const research = await page.locator('#card-dialog .research a').evaluateAll((list) => list.map((a) => a.href));
  assert.equal(research[0], `https://en.wikipedia.org/wiki/${pulled.wiki}`);
  assert.match(research[1], /^https:\/\/duckduckgo\.com\/\?q=/);

  if (source === 'seeds') {
    // A picture is shown and credited: the catalog's own, or one looked up from Wikipedia.
    await page.waitForSelector('#card-dialog .plate img');
    await page.waitForFunction(() => !document.querySelector('#card-dialog .plate figcaption').hidden);
    assert.equal(await page.locator('#card-dialog .plate img').getAttribute('src'), pulled.image ?? LOOKED_UP);
    assert.equal(seen.lookups, pulled.image ? 0 : 1);
    // Goes well with: objects from the other categories; a preview returns to the card.
    const pairs = page.locator('#card-dialog .pair');
    assert.ok(await pairs.count() >= 1);
    const pairTitle = await pairs.first().locator('.pair-title').textContent();
    await pairs.first().click();
    assert.equal(await page.locator('#card-title').textContent(), pairTitle);
    assert.match(await page.locator('#card-dialog .note').textContent(), /Not in your collection yet/);
    assert.equal(await page.locator('#card-dialog #favourite').count(), 0);
    await page.click('#close-card');
    assert.equal(await page.locator('#card-title').textContent(), title);
  } else {
    // A Wikipedia-built catalog is not looked up again: no picture means a lettered plate, no credit.
    await page.waitForSelector('#card-dialog .plate-blank');
    assert.equal(await page.locator('#card-dialog .plate img').count(), 0);
    assert.equal(await page.locator('#card-dialog .plate figcaption').isHidden(), true);
    assert.equal(seen.lookups, 0);
  }
  await noOverflow('card');
  await shot('3-card');

  // Opening a shop counts as interest; favouriting teaches the game.
  const popup = context.waitForEvent('page');
  await page.click('#buy');
  await (await popup).close();
  await page.click('#favourite');
  state = await stored(page);
  assert.deepEqual(state.favourites, [pulled.id]);
  assert.ok((state.taste.category[pulled.category] ?? 0) > 1);
  await page.click('#close-card');
  assert.equal(await page.locator('#collection-count').textContent(), '1');
  assert.equal(await page.locator('#recent .recent-title').first().textContent(), title);

  // The dial on the canvas works the gauge too.
  const box = await page.locator('#stage canvas').boundingBox();
  const dial = [box.x + box.width * (392 / 600), box.y + box.height * (522 / 640)];
  await pullOnce(page, { dial });
  await page.click('#close-card');

  // "Not for me" hides an object from future pulls.
  await pullOnce(page);
  const shownTitle = await page.locator('#card-title').textContent();
  const disliked = Object.values((await stored(page)).collection).find((entry) => entry.item.title === shownTitle);
  await page.click('#not-for-me');
  assert.ok((await stored(page)).taste.hidden.includes(disliked.item.id));
  assert.equal(await page.locator('#not-for-me').isDisabled(), true);
  await page.click('#close-card');

  // Perfect stops build a combo and fill the fever meter; fever pulls are rare or better.
  for (let i = 0; i < 6 && (await stored(page)).play.fever.pulls === 0; i += 1) {
    await pullOnce(page);
    await page.click('#close-card');
  }
  state = await stored(page);
  assert.ok(state.play.fever.pulls > 0, 'fever started');
  await page.waitForSelector('#fever.on');
  await shot('4-fever');
  await pullOnce(page);
  assert.match(await page.locator('#card-dialog .reward').textContent(), /fever pull/);
  assert.match(await page.locator('#card-dialog .eyebrow').textContent(), /Rare|Legendary/);
  await page.click('#close-card');
  state = await stored(page);
  assert.ok(state.play.combo >= 4 && state.play.xp >= 100, `combo ${state.play.combo}, xp ${state.play.xp}`);
  assert.ok(Number(await page.locator('#level-number').textContent()) >= 2);
  assert.ok(state.play.missions.list.some((entry) => entry.progress > 0));

  // Collection book.
  await page.click('#open-collection');
  await page.waitForSelector('#collection-dialog[open]');
  assert.equal(await page.locator('#collection-dialog .tile').count(), Object.keys((await stored(page)).collection).length);
  await noOverflow('collection');
  await page.locator('#collection-dialog').getByRole('button', { name: /Favourites/ }).click();
  assert.equal(await page.locator('#collection-dialog .tile').count(), 1);
  await page.locator('#collection-dialog .tile').first().click();
  await page.waitForSelector('#card-dialog[open]');
  assert.equal(await page.locator('#card-title').textContent(), title);
  await page.click('#close-card');
  await page.click('#close-collection');

  // Mood chips save straight away and pick the music; the music switch is remembered.
  await page.locator('#mood-chips').getByRole('button', { name: 'Adventurous' }).click();
  assert.equal((await stored(page)).profile.mood, 'adventurous');
  assert.match(await page.locator('#now-playing').textContent(), /Qawwali Nights/);
  await page.click('#toggle-music');
  assert.equal(await page.locator('#toggle-music').getAttribute('aria-pressed'), 'false');
  assert.equal((await stored(page)).settings.music, false);
  assert.match(await page.locator('#now-playing').textContent(), /Music is off/);
  await page.click('#toggle-music');

  // Changing the shop region changes the links.
  await page.click('#open-profile');
  await page.locator('#region').selectOption('IN');
  await page.click('#save-profile');
  await page.locator('#recent button').first().click();
  assert.ok((await page.locator('#buy').getAttribute('href')).startsWith('https://www.amazon.in/s?k='));
  await page.click('#close-card');

  // Reload keeps everything and does not show the welcome sheet again.
  const before = await stored(page);
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('pull').disabled);
  assert.equal(await tokens(page), before.economy.tokens);
  assert.equal(await page.locator('#profile-dialog[open]').count(), 0);
  assert.equal(await page.locator('#mood-chips [aria-pressed="true"]').textContent(), 'Adventurous');
  assert.equal(Number(await page.locator('#level-number').textContent()), levelFor(before.play.xp).level);

  // Spend everything: pulling stops at zero.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('pull').disabled);
  for (let i = 0; i < 80 && !(await page.locator('#pull').isDisabled()); i += 1) {
    await pullOnce(page);
    await page.click('#close-card');
  }
  assert.equal(await tokens(page), 0);
  assert.ok(await page.locator('#pull').isDisabled());
  assert.equal(await page.locator('#pull').textContent(), 'Out of tokens');
  const count = async () => Object.values((await stored(page)).collection).reduce((sum, entry) => sum + entry.count, 0);
  const pulls = await count();
  await page.mouse.click(...dial);
  await page.waitForTimeout(400);
  assert.equal(await count(), pulls, 'no pull without tokens');
  await shot('5-empty');

  // A new day refills the tokens, clears the mood and brings new missions.
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('curio-capsule:v1'));
    saved.economy.lastRefill = '2000-01-01';
    saved.profile.moodDate = '2000-01-01';
    saved.play.missions.date = '2000-01-01';
    localStorage.setItem('curio-capsule:v1', JSON.stringify(saved));
  });
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('pull').disabled);
  assert.ok(await tokens(page) >= 10);
  state = await stored(page);
  assert.equal(state.profile.mood, null, 'mood resets on a new day');
  assert.notEqual(state.play.missions.date, '2000-01-01');
  assert.ok(state.play.missions.list.every((entry) => entry.progress === 0));

  assert.deepEqual(seen.errors, [], `${name}: page errors`);
  await context.close();
  console.log(`✓ ${name}`);
}

// A few pulls against the catalog that is actually in the repository, from India.
async function realCatalog(browser) {
  const manifest = JSON.parse(await readFile(new URL('../data/catalog/index.json', import.meta.url), 'utf8'));
  const { context, page, seen } = await openGame(browser, { viewport: { width: 1280, height: 800 }, reducedMotion: true, locale: 'en-IN' });
  await page.goto(`${HOME}?seed=11`);
  await page.waitForSelector('#profile-dialog[open]');
  assert.equal(await page.locator('#region').inputValue(), 'IN');
  await page.click('#save-profile');
  await page.waitForFunction(() => !document.getElementById('pull').disabled);
  const note = await page.locator('#catalog-note').textContent();
  assert.ok(note.startsWith(`${manifest.total.toLocaleString('en')} objects in the cabinet across ${manifest.categories.length} categories`), note);
  for (let i = 0; i < 5; i += 1) {
    await pullOnce(page);
    assert.ok((await page.locator('#card-title').textContent()).trim().length > 0);
    assert.ok((await page.locator('#card-dialog .blurb').textContent()).trim().length > 10);
    assert.ok((await page.locator('#card-dialog .quote blockquote').textContent()).trim().length > 5);
    assert.equal(await page.locator('#card-dialog .pair').count(), 3);
    // Small makers link to their own shop; everything else to Amazon India for this player.
    const href = await page.locator('#buy').getAttribute('href');
    const maker = /Small maker/.test(await page.locator('#card-dialog .eyebrow').textContent());
    assert.ok(maker ? href.startsWith('https://') && !href.includes('amazon.') : href.startsWith('https://www.amazon.in/s?k='), href);
    if (shots && i === 0) { await page.waitForTimeout(300); await page.screenshot({ path: `${shots}/real-card.png` }); }
    await page.click('#close-card');
  }
  assert.equal(await page.locator('#collection-count').textContent(), String(Object.keys((await stored(page)).collection).length));
  assert.deepEqual(seen.errors, [], 'real catalog: page errors');
  await context.close();
  console.log(`✓ real catalog (${manifest.total} items)`);
}

// Every mood's music and every sound effect renders without errors, at a sensible level.
async function music(browser) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${HOME}?seed=1`);
  const report = await page.evaluate(async () => {
    const { renderTrack, renderEffect, EFFECTS } = await import('/src/audio/audio.js');
    const { TRACKS } = await import('/src/audio/tracks.js');
    const level = (buffer) => {
      let peak = 0;
      let sum = 0;
      let count = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        for (const sample of buffer.getChannelData(channel)) {
          if (!Number.isFinite(sample)) return { broken: true };
          peak = Math.max(peak, Math.abs(sample));
          sum += sample * sample;
          count += 1;
        }
      }
      return { peak: 20 * Math.log10(peak), rms: 10 * Math.log10(sum / count) };
    };
    const tracks = {};
    for (const key of Object.keys(TRACKS)) {
      tracks[key] = { ...level(await renderTrack(OfflineAudioContext, key, 6)), title: TRACKS[key].title };
      tracks[`${key} in fever`] = level(await renderTrack(OfflineAudioContext, key, 4, { fever: true }));
    }
    const effects = {};
    for (const name of EFFECTS) effects[name] = level(await renderEffect(OfflineAudioContext, name, name === 'reveal' ? 'legendary' : 'perfect'));
    return { tracks, effects };
  });
  for (const [name, result] of Object.entries({ ...report.tracks, ...report.effects })) {
    assert.ok(!result.broken, `${name} produced invalid samples`);
    assert.ok(result.peak < -0.5, `${name} clips (${result.peak.toFixed(1)} dB)`);
  }
  for (const [name, result] of Object.entries(report.tracks)) assert.ok(result.rms > -30 && result.rms < -10, `${name} level ${result.rms.toFixed(1)} dB`);
  for (const [name, result] of Object.entries(report.effects)) assert.ok(result.peak > -20, `${name} too quiet (${result.peak.toFixed(1)} dB)`);
  assert.deepEqual(errors, [], 'music: page errors');
  await page.close();
  console.log(`✓ music: ${Object.values(report.tracks).filter((t) => t.title).map((t) => t.title).join(', ')}`);
}

const server = await startServer(PORT);
const browser = await chromium.launch();
try {
  await run(browser, 'desktop', { viewport: { width: 1280, height: 800 }, reducedMotion: false, pictures: 'some', source: 'seeds' });
  await run(browser, 'phone', { viewport: { width: 390, height: 844 }, reducedMotion: true, pictures: 'none', source: 'seeds+wikipedia' });
  await realCatalog(browser);
  await music(browser);
  console.log('Smoke test passed.');
} finally {
  await browser.close();
  server.close();
}

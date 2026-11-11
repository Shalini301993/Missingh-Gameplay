import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApi, rejectReason, tagItem, tidyBlurb, assignRarity, displayTitle, loadSeeds, build,
} from '../scripts/catalog/build.mjs';
import { validateCatalog } from '../scripts/catalog/validate.mjs';
import { itemProblems, slugify, CATEGORY_IDS } from '../src/core/vocab.js';

const page = (extra = {}) => ({
  pageid: 1, title: 'Thing', description: 'a kind of object', thumbnail: { source: 'https://x/y.jpg' }, ...extra,
});

test('pages that are not objects are rejected', () => {
  assert.equal(rejectReason(page()), null);
  assert.equal(rejectReason(page({ thumbnail: undefined })), 'no-image');
  assert.equal(rejectReason(page({ title: 'List of perfumes' })), 'list-page');
  assert.equal(rejectReason(page({ pageprops: { disambiguation: '' } })), 'disambiguation');
  assert.equal(rejectReason(page({ description: 'French fashion designer' })), 'person');
  assert.equal(rejectReason(page({ description: '1813 novel by English writer Jane Austen' })), null);
  assert.equal(rejectReason(page({ description: 'American clothing company' })), 'organisation');
  assert.equal(rejectReason(page({ description: 'American clothing company' }), { allowOrganisations: true }), null);
  assert.equal(rejectReason(page({ description: '1999 film' })), 'not-a-thing');
  assert.equal(rejectReason(page({ description: 'type of assault rifle' })), 'unsuitable');
  assert.equal(rejectReason(page(), { require: 'novel' }), 'source-require');
  assert.equal(rejectReason(page(), { drop: 'object' }), 'source-drop');
});

test('tagging uses keywords, falls back to defaults and stays in vocabulary', () => {
  const tags = tagItem('Vintage red racing car, a luxury classic', { vibes: ['sporty'], moods: ['adventurous'], budget: 'splurge' });
  assert.ok(tags.vibes.includes('luxe') && tags.vibes.includes('retro'));
  assert.ok(tags.colours.includes('red'));
  assert.equal(tags.budget, 'dream');
  assert.ok(tags.vibes.length <= 3 && tags.moods.length <= 2);
  assert.deepEqual(tagItem('ordinary thing', { vibes: ['cosy'], moods: ['calm'], budget: 'treat' }),
    { vibes: ['cosy'], moods: ['calm'], colours: [], budget: 'treat' });
});

test('blurbs are tidied and titles lose their disambiguator', () => {
  assert.equal(displayTitle('Opium (perfume)'), 'Opium');
  assert.equal(tidyBlurb('', 'perfume by Chanel'), 'Perfume by Chanel');
  const long = `${'Word '.repeat(40)}end. ${'More '.repeat(60)}`;
  assert.ok(tidyBlurb(long).length <= 301);
});

test('rarity is assigned by popularity', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ views: i }));
  assignRarity(items);
  assert.equal(items.filter((i) => i.rarity === 'legendary').length, 5);
  assert.equal(items.filter((i) => i.rarity === 'rare').length, 20);
  assert.equal(items[99].rarity, 'legendary');
  assert.equal(items[0].rarity, 'common');
});

test('seeds are all valid, unique and cover every category', async () => {
  const seeds = await loadSeeds();
  assert.ok(seeds.length >= 140, `only ${seeds.length} seeds`);
  const ids = new Set();
  for (const seed of seeds) {
    assert.deepEqual(itemProblems(seed), [], seed.id);
    assert.ok(!ids.has(seed.id), `duplicate ${seed.id}`);
    ids.add(seed.id);
    assert.ok(seed.vibes.length && seed.moods.length && seed.colours.length, `${seed.id} needs tags`);
  }
  for (const id of CATEGORY_IDS) assert.ok(seeds.some((s) => s.category === id), `no seeds for ${id}`);
  assert.equal(slugify("Citroën 2CV"), 'citroen-2cv');
});

test('the API client merges continued responses', async () => {
  const responses = [
    { continue: { picontinue: 2, gcmcontinue: 'a', continue: 'gcmcontinue||' },
      query: { pages: [{ pageid: 1, title: 'A', pageviews: { d1: 5 } }, { pageid: 2, title: 'B' }] } },
    { continue: { gcmcontinue: 'b', continue: 'gcmcontinue||' },
      query: { pages: [{ pageid: 1, title: 'A', pageviews: { d2: 7 } }, { pageid: 2, title: 'B', thumbnail: { source: 'https://t' } }] } },
    { query: { pages: [{ pageid: 3, title: 'C' }] } },
  ];
  const seen = [];
  const fetchImpl = async (url) => { seen.push(url); return { ok: true, json: async () => responses[seen.length - 1] }; };
  const api = createApi({ fetchImpl, delayMs: 0 });
  const { pages } = await api.pages({ generator: 'categorymembers' }, { generatorKeys: ['gcmcontinue'] });
  assert.equal(pages.length, 3);
  assert.deepEqual(pages[0].pageviews, { d1: 5, d2: 7 });
  assert.equal(pages[1].thumbnail.source, 'https://t');
  assert.equal(seen[1].searchParams.get('picontinue'), '2');
  // With a limit, it stops once the pages it has are complete.
  seen.length = 0;
  const limited = await createApi({ fetchImpl, delayMs: 0 }).pages({}, { limit: 2, generatorKeys: ['gcmcontinue'] });
  assert.equal(limited.pages.length, 2);
  assert.equal(seen.length, 2);
});

test('a full build against a fake Wikipedia yields a valid catalog', async () => {
  const fake = {
    requests: 0,
    async call(params) {
      if (params.prop === 'extracts') {
        return { query: { pages: String(params.pageids).split('|').map((id) => ({ pageid: Number(id), extract: `Extract for page ${id}, which is long enough to be used as a blurb.` })) } };
      }
      return { query: { pages: String(params.titles).split('|').map((title, i) => ({ pageid: 9000 + i, title, thumbnail: { source: 'https://img/seed.jpg' } })) } };
    },
    async pages(params) {
      const tag = params.gcmtitle || params.gsrsearch;
      const base = [...tag].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) * 100;
      return { pages: [
        { pageid: base + 1, title: `${tag} novel one`, description: 'novel shoe bag device object', thumbnail: { source: 'https://img/1.jpg' }, pageviews: { d: 50 } },
        { pageid: base + 2, title: `${tag} person`, description: 'French fashion designer', thumbnail: { source: 'https://img/2.jpg' } },
        { pageid: base + 3, title: 'Chanel No. 5', description: 'perfume novel shoe bag device', thumbnail: { source: 'https://img/3.jpg' } },
      ] };
    },
    async subcategories(category) { return [category]; },
  };
  const { catalog, report } = await build({ api: fake, log: () => {} });
  const items = [...catalog.values()].flat();
  const seeds = await loadSeeds();
  assert.ok(items.length > seeds.length);
  for (const entry of items) assert.deepEqual(itemProblems(entry), [], entry.id);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.equal(items.filter((i) => i.title === 'Chanel No. 5').length, 1, 'seed wins over a duplicate page');
  assert.equal(items.find((i) => i.id === 'perfumes/chanel-no-5').image, 'https://img/seed.jpg');
  assert.ok(report.some((row) => row.rejected.person));
  assert.ok(items.some((i) => i.source === 'wikipedia' && i.blurb.startsWith('Extract for page')));
});

test('the committed catalog is valid', async () => {
  const { errors, total } = await validateCatalog();
  assert.deepEqual(errors, []);
  assert.ok(total >= 140);
});

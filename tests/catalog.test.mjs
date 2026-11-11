import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApi, OutOfTime, sourceQuery, rejectReason, guessKind, tagItem, tidyBlurb, pickBalanced, assignRarity,
  displayTitle, loadSeeds, build, reportMarkdown,
} from '../scripts/catalog/build.mjs';
import { validateCatalog } from '../scripts/catalog/validate.mjs';
import { itemProblems, slugify, CATEGORY_IDS } from '../src/core/vocab.js';

const page = (extra = {}) => ({
  pageid: 1, title: 'Thing', description: 'a kind of object', thumbnail: { source: 'https://x/y.jpg' }, ...extra,
});

// A fake clock and network for the API client: no real waiting, no real requests.
function fakeWorld(responses, startMs = 1_700_000_010_000) {
  const world = { clock: startMs, urls: [], sleeps: [], logs: [] };
  world.options = {
    minIntervalMs: 0,
    now: () => world.clock,
    sleep: async (ms) => { world.sleeps.push(ms); world.clock += ms; },
    log: (line) => world.logs.push(line),
    fetchImpl: async (url) => {
      world.urls.push(url);
      const next = responses[world.urls.length - 1];
      if (!next) throw new Error('unexpected request');
      if (next === 429) return { status: 429, ok: false, headers: { get: () => null }, text: async () => 'Too many requests' };
      return { status: 200, ok: true, json: async () => next };
    },
  };
  return world;
}

test('sources become Wikipedia searches', () => {
  assert.equal(sourceQuery({ template: 'Infobox toy' }), 'hastemplate:"Infobox toy"');
  assert.equal(sourceQuery({ cats: ['Hats', 'Caps (headgear)'] }), 'incategory:"Hats|Caps (headgear)"');
  assert.equal(sourceQuery({ deepcat: 'Chairs' }), 'deepcat:"Chairs"');
  assert.equal(sourceQuery({ template: 'Infobox book', search: 'fantasy novel' }), 'hastemplate:"Infobox book" fantasy novel');
  assert.equal(sourceQuery({ cats: ['Say "cheese"'] }), 'incategory:"Say cheese"');
});

test('pages that are not objects are rejected', () => {
  assert.equal(rejectReason(page()), null);
  assert.equal(rejectReason(page({ thumbnail: undefined })), 'no-image');
  assert.equal(rejectReason(page({ thumbnail: undefined }), { allowNoImage: true }), null);
  assert.equal(rejectReason(page({ title: 'List of perfumes' })), 'list-page');
  assert.equal(rejectReason(page({ pageprops: { disambiguation: '' } })), 'disambiguation');
  assert.equal(rejectReason(page({ description: '' })), 'no-description');
  assert.equal(rejectReason(page({ description: 'French fashion designer' })), 'person');
  assert.equal(rejectReason(page({ description: 'English clockmaker (1693–1776)' })), 'person');
  assert.equal(rejectReason(page({ description: '1813 novel by English writer Jane Austen' })), null);
  assert.equal(rejectReason(page({ description: 'American clothing company' })), 'organisation');
  assert.equal(rejectReason(page({ description: 'Swiss luxury watchmaker' })), 'organisation');
  assert.equal(rejectReason(page({ description: 'American clothing company' }), { allowOrganisations: true }), null);
  assert.equal(rejectReason(page({ description: '1999 film' })), 'not-a-thing');
  assert.equal(rejectReason(page({ description: 'type of assault rifle' })), 'unsuitable');
  assert.equal(rejectReason(page({ description: 'unisex garment' })), null);
  assert.equal(rejectReason(page(), { require: 'novel' }), 'source-require');
  assert.equal(rejectReason(page(), { drop: 'object' }), 'source-drop');
});

test('named products are told apart from kinds of thing', () => {
  assert.equal(guessKind('1921 perfume by Chanel'), 'iconic');
  assert.equal(guessKind('line of construction toys'), 'iconic');
  assert.equal(guessKind('chair designed by Arne Jacobsen'), 'iconic');
  assert.equal(guessKind('type of hat'), 'generic');
  assert.equal(guessKind('garment worn by sailors'), 'generic');
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
  assert.equal(tidyBlurb('The Tamagotchi (Japanese: たまごっち) is a handheld digital pet , created in Japan.'),
    'The Tamagotchi is a handheld digital pet, created in Japan.');
  const long = `${'Word '.repeat(40)}end. ${'More '.repeat(60)}`;
  assert.ok(tidyBlurb(long).endsWith('end.'));
  // Does not stop at an abbreviation such as "No." when a real sentence end is available.
  const chanel = `Chanel No. 5 was the first perfume launched by the French couturier Gabrielle Chanel in the year 1921, and it remains famous. ${'It has a long history. '.repeat(6)}The scent formula was compounded by a chemist and perfumer called Ernest Beaux, sold as No. 5 ever since ${'x'.repeat(80)}`;
  const blurb = tidyBlurb(chanel);
  assert.ok(blurb.length <= 301 && blurb.endsWith('history.'), blurb);
});

test('picking takes turns across sources and respects weights', () => {
  assert.deepEqual(pickBalanced([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']], 5), ['a1', 'b1', 'c1', 'a2', 'c2']);
  assert.deepEqual(pickBalanced([['a1', 'a2', 'a3', 'a4'], ['b1', 'b2']], 5, [2, 1]), ['a1', 'a2', 'b1', 'a3', 'a4']);
  assert.deepEqual(pickBalanced([['a1'], []], 5), ['a1']);
  assert.deepEqual(pickBalanced([], 5), []);
});

test('rarity is assigned by score', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ score: i }));
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
  assert.equal(slugify('Citroën 2CV'), 'citroen-2cv');
});

test('a search pages through results in order and stops at its limit', async () => {
  const world = fakeWorld([
    { continue: { gsroffset: 50, continue: 'gsroffset||' }, query: { pages: [{ pageid: 2, index: 2, title: 'B' }, { pageid: 1, index: 1, title: 'A' }] } },
    { continue: { gsroffset: 100, continue: 'gsroffset||' }, query: { pages: [{ pageid: 3, index: 3, title: 'C' }] } },
  ]);
  const api = createApi(world.options);
  const { pages, error } = await api.search('deepcat:"Hats"', { limit: 3 });
  assert.equal(error, null);
  assert.deepEqual(pages.map((p) => p.title), ['A', 'B', 'C']);
  assert.equal(world.urls.length, 2);
  assert.equal(world.urls[0].searchParams.get('gsrsearch'), 'deepcat:"Hats"');
  assert.equal(world.urls[0].searchParams.get('gsrqiprofile'), 'popular_inclinks_pv');
  assert.equal(world.urls[0].searchParams.get('gsrlimit'), '3');
  assert.match(world.urls[0].searchParams.get('prop'), /cirrusdoc/);
  assert.equal(world.urls[1].searchParams.get('gsroffset'), '50');
  assert.equal(api.stats.requests, 2);
});

test('when told to slow down, the client waits for the next minute and tries again', async () => {
  const world = fakeWorld([429, { query: { pages: [{ pageid: 1, index: 1, title: 'A' }] } }]);
  const api = createApi(world.options);
  const { pages } = await api.search('x', { limit: 5 });
  assert.equal(pages.length, 1);
  assert.deepEqual(world.sleeps, [31500]); // 30 s to the minute boundary, plus a small margin
  assert.equal(api.stats.limited, 1);
  assert.ok(world.logs.some((line) => line.includes('Too many requests')));
});

test('the client gives up cleanly when the time budget cannot cover the wait', async () => {
  const world = fakeWorld([429]);
  const api = createApi({ ...world.options, deadline: world.clock + 10000 });
  await assert.rejects(api.search('x'), OutOfTime);
});

test('a search keeps what it has when a later request fails', async () => {
  const world = fakeWorld([
    { continue: { gsroffset: 50, continue: 'gsroffset||' }, query: { pages: [{ pageid: 1, index: 1, title: 'A' }] } },
    { error: { code: 'internal', info: 'boom' } },
  ]);
  const { pages, error } = await createApi(world.options).search('x', { limit: 100 });
  assert.equal(pages.length, 1);
  assert.match(error.message, /boom/);
});

test('an unsupported ranking falls back to the default order', async () => {
  const world = fakeWorld([
    { error: { code: 'badvalue', info: 'Unrecognized value for parameter "gsrqiprofile": popular_inclinks_pv.' } },
    { query: { pages: [{ pageid: 1, index: 1, title: 'A' }] } },
    { query: { pages: [{ pageid: 2, index: 1, title: 'B' }] } },
  ]);
  const api = createApi(world.options);
  assert.equal((await api.search('x', { limit: 5 })).pages[0].title, 'A');
  assert.equal(world.urls[1].searchParams.get('gsrqiprofile'), null);
  await api.search('y', { limit: 5 });
  assert.equal(world.urls[2].searchParams.get('gsrqiprofile'), null);
});

function fakeWikipedia() {
  let serial = 0;
  const thumbnail = { source: 'https://img/pic.jpg' };
  return {
    stats: { requests: 0, limited: 0, waitedMs: 0 },
    async call(params) {
      if (params.prop === 'extracts') {
        return { query: { pages: String(params.pageids).split('|').map((id) => ({ pageid: Number(id), extract: `Fetched intro for page ${id}, which is long enough to be used as a blurb.` })) } };
      }
      return { query: { pages: String(params.titles).split('|').map((title, i) => ({ pageid: 9000 + i, title, thumbnail: { source: 'https://img/seed.jpg' } })) } };
    },
    async search() {
      const words = 'novel shoe bag luggage device clock lamp object';
      const base = serial * 10;
      serial += 1;
      return { error: null, pages: [
        { pageid: base + 1, index: 1, title: `Famous thing ${serial}`, description: words, thumbnail,
          cirrusdoc: [{ source: { opening_text: 'Opening text from the search index, comfortably long enough to be a blurb.', popularity_score: 0.001 * serial } }] },
        { pageid: base + 2, index: 2, title: `Some person ${serial}`, description: 'French fashion designer', thumbnail },
        { pageid: base + 3, index: 3, title: 'Chanel No. 5', description: words, thumbnail },
        { pageid: base + 4, index: 4, title: `Plain thing ${serial}`, description: words, thumbnail },
      ] };
    },
  };
}

test('a full build against a fake Wikipedia yields a valid catalog', async () => {
  const { catalog, report, outOfTime } = await build({ api: fakeWikipedia(), log: () => {} });
  const items = [...catalog.values()].flat();
  const seeds = await loadSeeds();
  assert.equal(outOfTime, false);
  assert.ok(items.length > seeds.length + 50, `${items.length} items`);
  for (const entry of items) assert.deepEqual(itemProblems(entry), [], entry.id);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.equal(items.filter((i) => i.title === 'Chanel No. 5').length, 1, 'seed wins over a duplicate page');
  assert.equal(items.find((i) => i.id === 'perfumes/chanel-no-5').image, 'https://img/seed.jpg');
  assert.ok(report.every((row) => row.rejected.person === 1 && row.rejected.duplicate === 1 && row.kept === 2 && row.picked === 2));
  const generated = items.filter((i) => i.source === 'wikipedia');
  assert.ok(generated.some((i) => i.blurb.startsWith('Opening text from the search index')));
  assert.ok(generated.some((i) => i.blurb.startsWith('Fetched intro for page')), 'intro text is fetched when the search has none');
  assert.ok(generated.some((i) => i.rarity === 'legendary') && generated.some((i) => i.rarity === 'common'));
  assert.ok(!items.some((i) => 'score' in i || 'popularity' in i));
  const markdown = reportMarkdown([{ id: 'toys', count: 3 }], report, { requests: 9, limited: 1, waitedMs: 120000 });
  assert.match(markdown, /# Catalog build: 3 items/);
  assert.match(markdown, /told to slow down 1 times, waited 2 min/);
});

test('a build that runs out of time still finishes with what it has', async () => {
  const wikipedia = fakeWikipedia();
  let searches = 0;
  const search = wikipedia.search;
  wikipedia.search = async (...args) => {
    searches += 1;
    if (searches > 12) throw new OutOfTime();
    return search(...args);
  };
  const { catalog, report, outOfTime } = await build({ api: wikipedia, log: () => {} });
  assert.equal(outOfTime, true);
  assert.equal(searches, 13, 'stops asking once out of time');
  assert.ok(report.some((row) => row.note === 'skipped: out of time'));
  // The first source of every category was reached before time ran out.
  for (const id of CATEGORY_IDS) assert.ok(catalog.get(id).some((item) => item.source === 'wikipedia'), id);
});

test('the committed catalog is valid', async () => {
  const { errors, total } = await validateCatalog();
  assert.deepEqual(errors, []);
  assert.ok(total >= 140);
});

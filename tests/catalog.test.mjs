import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApi, OutOfTime, sourceQuery, rejectReason, guessKind, tagItem, tidyBlurb, pickBalanced, assignRarity,
  displayTitle, properTitle, familyOf, loadSeeds, build, reportMarkdown, loadConfig, prepareConfig, refilter,
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
  assert.equal(rejectReason(page({ title: 'List of perfumes' })), 'topic-page');
  for (const title of ['Shoe size', 'Sneaker collecting', 'Moving sofa problem', 'Plastic bag ban', 'Winter time', 'Clock position']) {
    assert.equal(rejectReason(page({ title })), 'topic-page', title);
  }
  assert.equal(rejectReason(page({ title: 'Ray-Ban' })), null);
  assert.equal(rejectReason(page({ title: 'List of diamonds' }), { named: true }), 'topic-page');
  // The title of a named work or product is not judged: only what it is described as.
  const crime = page({ title: 'Crime and Punishment', description: '1866 novel by Fyodor Dostoevsky' });
  assert.equal(rejectReason(crime), 'unsuitable');
  assert.equal(rejectReason(crime, { named: true }), null);
  assert.equal(rejectReason(page({ title: 'The Three-Body Problem', description: '2008 science fiction novel' }), { named: true }), null);
  assert.equal(rejectReason(page({ title: 'Epiphone Casino', description: 'Hollow-body electric guitar' }), { named: true }), null);
  assert.equal(rejectReason(page({ title: 'Hash oil', description: 'Cannabis concentrate' }), { named: true }), 'unsuitable');
  assert.equal(rejectReason(page({ title: 'Golliwog' }), { exclude: new Set(['golliwog']) }), 'excluded');
  assert.equal(rejectReason(page({ pageprops: { disambiguation: '' } })), 'disambiguation');
  assert.equal(rejectReason(page({ description: '' })), 'no-description');
  assert.equal(rejectReason(page({ description: 'French fashion designer' })), 'person');
  assert.equal(rejectReason(page({ description: 'English clockmaker (1693–1776)' })), 'person');
  assert.equal(rejectReason(page({ description: '1813 novel by English writer Jane Austen' })), null);
  assert.equal(rejectReason(page({ description: 'American clothing company' })), 'organisation');
  assert.equal(rejectReason(page({ description: 'Swiss luxury watchmaker' })), 'organisation');
  assert.equal(rejectReason(page({ description: 'American clothing company' }), { allowOrganisations: true }), null);
  assert.equal(rejectReason(page({ description: '1999 film' })), 'not-a-thing');
  assert.equal(rejectReason(page({ description: 'Ancient Greek deity' })), 'not-a-thing');
  assert.equal(rejectReason(page({ description: 'Label sizes used for garments sold off-the-shelf' })), 'not-a-thing');
  assert.equal(rejectReason(page({ description: 'Toy line based on the television series' })), null);
  assert.equal(rejectReason(page({ description: 'Home video game console developed by Nintendo' })), null);
  assert.equal(rejectReason(page({ description: '2001 video game' })), 'not-a-thing');
  assert.equal(rejectReason(page({ description: 'Sport utility vehicle' })), null);
  assert.equal(rejectReason(page({ description: 'Sports car manufactured by German automobile manufacturer Porsche' })), null);
  assert.equal(rejectReason(page({ description: '1963 fragrance by Estée Lauder Companies' })), null);
  assert.equal(rejectReason(page({ description: 'German automobile manufacturer' })), 'organisation');
  assert.equal(rejectReason(page({ description: 'Garment used for restraining people' })), 'unsuitable');
  assert.equal(rejectReason(page({ description: 'type of assault rifle' })), 'unsuitable');
  assert.equal(rejectReason(page({ description: 'unisex garment' })), null);
  // People, including ones whose description gives no dates.
  assert.equal(rejectReason(page({ description: 'President of the United States from 1933 to 1945' })), 'person');
  assert.equal(rejectReason(page({ description: 'Governor of Texas since 2015' })), 'person');
  assert.equal(rejectReason(page({ cirrusdoc: [{ source: { category: ['Chairs', '1882 births'] } }] })), 'person');
  assert.equal(rejectReason(page({ cirrusdoc: [{ source: { category: ['Living people'] } }] })), 'person');
  assert.equal(rejectReason(page({ description: 'Car model' })), null);
  assert.equal(rejectReason(page({ description: 'Electric guitar model' })), null);
  assert.equal(rejectReason(page({ description: 'King-size mattress' })), null);
  // Adult or grim content, even when only the intro gives it away.
  for (const description of ['Ring worn around the penis', 'Type of undergarment', 'Exposure of a thong above trousers',
    'Nickname of electric chairs', 'Bag designed to contain a human body', 'Form of corporal punishment', 'Racist caricature doll',
    'SS ring awarded by Heinrich Himmler', 'Coveted prize in poker', 'Bag used in bookmaking']) {
    assert.equal(rejectReason(page({ description })), 'unsuitable', description);
  }
  assert.equal(rejectReason(page({ description: 'Brand of electric massager',
    cirrusdoc: [{ source: { opening_text: 'It is best known for its use as a sex toy.' } }] })), 'unsuitable');
  assert.equal(rejectReason(page({ title: 'Shirt', description: 'Garment for the upper body',
    cirrusdoc: [{ source: { opening_text: 'Originally an undergarment worn exclusively by men, it has become an outer garment.' } }] })), null);
  assert.equal(rejectReason(page({ description: 'Belted waterproof coat',
    cirrusdoc: [{ source: { opening_text: 'The trench coat was developed for British Army officers.' } }] })), null);
  // Shops, places, foods, styles, characters and other non-objects.
  for (const description of ['American footwear retailer', 'Town in Bedfordshire, England', 'Japanese dish', 'Coffee made from part-digested beans',
    'Style of visual arts', 'Fictional character from Toy Story', 'Japanese media franchise', 'Mobile operating system', 'Winter sport',
    'Species of flowering plant', 'Symbolic clock', 'Facetious communication protocol', 'Chemical compound', '2010 single', 'Fashion label',
    'Chapel in Paris', 'Telephone service', 'Occupation', 'Person who cleans shoes', 'Linux-based mobile operating system',
    'Religious order whose members go barefoot']) {
    assert.notEqual(rejectReason(page({ description }), { allowOrganisations: true }), null, description);
  }
  // …without throwing out real objects that happen to use the same words.
  for (const description of ['35 mm film camera', 'Mid-size car', 'Full-size pickup truck', 'Concept car', 'Single-seat sports car',
    'Mountain bike', 'Electric city car', 'Custom motorcycle', 'Brand of activity trackers', 'Building blocks', 'Stuffed toy animal',
    'Food processor', 'Coffee maker', 'Smart television', 'Type of hat', 'Style of hat', 'Photo album cover', 'Line of smartphones']) {
    assert.equal(rejectReason(page({ description })), null, description);
  }
  assert.equal(rejectReason(page(), { require: 'novel' }), 'source-require');
  assert.equal(rejectReason(page(), { drop: 'object' }), 'source-drop');
});

test('titles are tidied and grouped into families', () => {
  assert.equal(properTitle('IPhone 13'), 'iPhone 13');
  assert.equal(properTitle('IPad Mini'), 'iPad Mini');
  assert.equal(properTitle('Dune (novel)', '<i>Dune</i> (novel)'), 'Dune (novel)');
  assert.equal(properTitle('EBay', 'eBay'), 'eBay');
  assert.equal(properTitle('Kimono', 'Something else'), 'Kimono');
  assert.equal(familyOf('IPhone 13'), 'iphone');
  assert.equal(familyOf('HP-12C'), 'hp');
  assert.equal(familyOf('TI-83 series'), 'ti');
  assert.equal(familyOf('The Lord of the Rings'), 'lord');
  assert.equal(familyOf('Toyota Corolla'), 'toyota');
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
  assert.equal(tidyBlurb('This article contains special characters. Without proper rendering support, you may see question marks, boxes, or other symbols. The kimono (着物; lit. \'thing to wear\') is a traditional Japanese garment.'),
    'The kimono is a traditional Japanese garment.');
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
  assert.ok(seeds.length >= 70, `only ${seeds.length} seeds`);
  const ids = new Set();
  for (const seed of seeds) {
    assert.deepEqual(itemProblems(seed), [], seed.id);
    assert.ok(!ids.has(seed.id), `duplicate ${seed.id}`);
    ids.add(seed.id);
    assert.ok(seed.vibes.length && seed.moods.length && seed.colours.length, `${seed.id} needs tags`);
  }
  for (const id of CATEGORY_IDS) assert.ok(seeds.some((s) => s.category === id), `no seeds for ${id}`);
  const makers = seeds.filter((s) => s.kind === 'maker');
  assert.ok(makers.length >= 50, `${makers.length} makers`);
  assert.ok(makers.every((m) => ['US', 'IN'].includes(m.origin) && m.site.startsWith('https://') && m.about), 'makers are from the USA or India, with a site and description');
  assert.equal(new Set(makers.map((m) => m.site)).size, makers.length, 'each maker once');
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
      // One description that names something every category asks for.
      const words = 'garment sari shoe perfume attar novel bag basket luggage scarf hat jewel necklace glasses diamond watch clock toy doll bicycle car Tata American boat phone device chair lamp pot pottery rug guitar instrument';
      const base = serial * 10;
      serial += 1;
      // Each title starts with its own word, so none of them count as one family.
      const tag = String.fromCharCode(97 + (serial % 26)) + String.fromCharCode(97 + Math.floor(serial / 26));
      return { error: null, pages: [
        { pageid: base + 1, index: 1, title: `Fam${tag} famous thing`, description: words, thumbnail,
          cirrusdoc: [{ source: { opening_text: 'Opening text from the search index, comfortably long enough to be a blurb.', popularity_score: 0.001 * serial } }] },
        { pageid: base + 2, index: 2, title: `Per${tag} person`, description: 'French fashion designer', thumbnail },
        { pageid: base + 3, index: 3, title: 'Chanel No. 5', description: words, thumbnail },
        { pageid: base + 4, index: 4, title: `Pla${tag} plain thing`, description: words, thumbnail },
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
  assert.ok(report.every((row) => row.rejected.person === 1 && row.rejected.duplicate === 1));
  // Two pages survive each search; generic ones may then be dropped as everyday objects.
  assert.ok(report.every((row) => row.kept + (row.rejected.everyday ?? 0) === 2 && row.picked === row.kept));
  assert.ok(report.some((row) => row.rejected.everyday), 'the most-read generic pages are dropped');
  const generated = items.filter((i) => i.source === 'wikipedia');
  assert.ok(generated.some((i) => i.blurb.startsWith('Opening text from the search index')));
  assert.ok(generated.some((i) => i.blurb.startsWith('Fetched intro for page')), 'intro text is fetched when the search has none');
  assert.ok(generated.some((i) => i.rarity === 'legendary') && generated.some((i) => i.rarity === 'common'));
  assert.ok(!items.some((i) => 'popularity' in i), 'readership is not stored');
  assert.ok(!items.some((i) => 'score' in i || 'popularity' in i));
  assert.ok(generated.every((i) => i.about.startsWith('Garment sari shoe')), 'the short description is kept as "about"');
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

test('corrections in sources.json are checked when they are read', async () => {
  const config = await loadConfig();
  assert.ok(config.corrections.size > 0 && config.excluded.size > 0);
  for (const fix of config.corrections.values()) assert.ok(Object.keys(fix).length > 0);
  const bad = (fix) => () => prepareConfig({ corrections: { Thing: fix } });
  assert.throws(bad({ category: 'hats' }), /correction for "Thing"/);
  assert.throws(bad({ kind: 'maker' }), /kind/);
  assert.throws(bad({ origin: 'India' }), /origin/);
  assert.throws(bad({ colour: 'red' }), /colour/);
  assert.throws(bad({}), /changes nothing/);
  assert.equal(prepareConfig({ corrections: { Thing: { origin: null } } }).corrections.get('thing').origin, null);
});

test('a correction moves a page to another category and fixes its kind and origin', async () => {
  const config = await loadConfig();
  // The first search of the fake Wikipedia is clothing's, and its first page is "Famba famous thing".
  config.corrections.set('famba famous thing', { category: 'toys', kind: 'artifact', origin: 'US' });
  config.corrections.set('plaba plain thing', { origin: null });
  const { catalog, report } = await build({ api: fakeWikipedia(), log: () => {}, config });
  const items = [...catalog.values()].flat();
  const moved = items.find((item) => item.wiki === 'Famba_famous_thing');
  assert.equal(moved.category, 'toys');
  assert.equal(moved.id, 'toys/famba-famous-thing');
  assert.equal(moved.kind, 'artifact');
  assert.equal(moved.origin, 'US');
  const plain = items.find((item) => item.wiki === 'Plaba_plain_thing');
  assert.equal(plain.category, 'clothing');
  assert.ok(!('origin' in plain), 'origin removed');
  assert.match(report[0].note, /1 moved/);
});

test('re-filtering applies the current sources, exclusions, corrections and seeds', async () => {
  const base = { blurb: 'A thing.', image: 'https://img/x.jpg', vibes: [], moods: [], colours: [], budget: 'treat', rarity: 'common', source: 'wikipedia' };
  const item = (category, title, extra = {}) => ({
    ...base, id: `${category}/${slugify(title)}`, title, category, wiki: title.replace(/ /g, '_'), kind: 'iconic', about: 'Motor car', ...extra,
  });
  const config = prepareConfig({
    exclude: ['Bad thing'],
    corrections: { 'Moved thing': { category: 'home', kind: 'generic' } },
    categories: {
      vehicles: { sources: [
        { cats: ['Cars of India'], kind: 'iconic', origin: 'IN', require: 'Tata' },
        { template: 'Infobox automobile', kind: 'iconic' },
      ] },
      toys: { sources: [{ cats: ['Toys'], kind: 'generic' }] },
    },
  });
  const seed = { ...base, id: 'toys/seeded', title: 'Seeded', category: 'toys', wiki: 'Seeded_page', kind: 'generic', rarity: 'legendary', source: 'seed', popularity: 3 };
  const current = new Map([
    ['vehicles', [
      item('vehicles', 'Audi A4', { origin: 'IN', about: 'Compact executive car' }),
      item('vehicles', 'Tata Nano', { origin: 'IN', about: 'City car made by Tata Motors' }),
      item('vehicles', 'Toyota Hilux', { about: 'Pickup truck' }),
    ]],
    ['toys', [
      item('toys', 'Moved thing', { kind: 'generic', about: 'Wooden toy', rarity: 'rare' }),
      item('toys', 'Bad thing', { kind: 'generic', about: 'Wooden toy' }),
      item('toys', 'Copy of the seed', { kind: 'generic', about: 'Wooden toy', wiki: 'Seeded_page' }),
      { ...seed, rarity: 'rare' },
    ]],
  ]);
  const logs = [];
  const catalog = await refilter({ config, seeds: [seed], current, log: (line) => logs.push(line) });
  const titles = (id) => catalog.get(id).map((entry) => entry.title);
  assert.deepEqual(titles('vehicles'), ['Tata Nano', 'Toyota Hilux'], 'a source that no longer takes it removes it');
  assert.deepEqual(titles('toys'), ['Seeded'], 'excluded, moved and seed-covered pages leave');
  assert.equal(catalog.get('toys')[0].rarity, 'rare', 'a seed keeps the rarity of the last full build');
  assert.ok(!('popularity' in catalog.get('toys')[0]));
  const moved = catalog.get('home')[0];
  assert.deepEqual([moved.id, moved.category, moved.kind, moved.rarity], ['home/moved-thing', 'home', 'generic', 'rare']);
  assert.ok(logs.some((line) => /removing Audi A4 \(vehicles\): source-require/.test(line)));
  assert.ok(logs.some((line) => /removing Bad thing \(toys\): excluded/.test(line)));
  assert.ok(logs.some((line) => /moving Moved thing from toys to home/.test(line)));
});

test('small makers need a shop website, and origins are country codes', () => {
  const base = { id: 'bags/x', title: 'X', kind: 'maker', category: 'bags', blurb: 'b', vibes: [], moods: [], colours: [], budget: 'treat', rarity: 'rare' };
  assert.deepEqual(itemProblems({ ...base, site: 'https://x.example/' }), []);
  assert.ok(itemProblems(base).includes('a maker needs a shop website'));
  assert.ok(itemProblems({ ...base, site: 'http://x.example/' }).includes('a maker needs a shop website'));
  assert.ok(itemProblems({ ...base, site: 'https://x.example/', origin: 'India' }).includes('bad origin'));
  assert.deepEqual(itemProblems({ ...base, kind: 'artifact', origin: 'IN' }), []);
});

test('the committed catalog is valid', async () => {
  const { errors, total } = await validateCatalog();
  assert.deepEqual(errors, []);
  assert.ok(total >= 140);
});

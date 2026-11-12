import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shopLinks, searchQuery, makerOf, detectRegion, REGIONS, regionById, AMAZON_TAG } from '../src/core/shops.js';
import { emptyTaste, learn, tasteFactor, pairings } from '../src/core/taste.js';
import { draw } from '../src/core/matcher.js';
import { seeded } from '../src/core/play.js';
import { CATEGORY_IDS } from '../src/core/vocab.js';

const item = (extra) => ({ id: 'x/y', title: 'Thing', category: 'home', about: '', vibes: [], moods: [], colours: [], budget: 'treat', rarity: 'common', image: 'https://i', ...extra });

test('the region comes from the browser languages', () => {
  assert.equal(detectRegion(['en-IN', 'en']), 'IN');
  assert.equal(detectRegion(['en-GB']), 'GB');
  assert.equal(detectRegion(['de']), 'DE');
  assert.equal(detectRegion(['hi']), 'IN');
  assert.equal(detectRegion(['en']), 'US');
  assert.equal(detectRegion([]), 'US');
  assert.equal(regionById('nowhere').id, 'US');
});

test('searches name the object, its maker where useful, and what kind of thing it is', () => {
  assert.equal(makerOf('1965 science fiction novel by Frank Herbert'), 'Frank Herbert');
  assert.equal(makerOf('Perfume by Coco Chanel'), 'Coco Chanel');
  assert.equal(makerOf('Belted waterproof coat'), '');
  assert.equal(searchQuery(item({ title: 'Dune', category: 'books', about: '1965 science fiction novel by Frank Herbert' })), 'Dune Frank Herbert');
  assert.equal(searchQuery(item({ title: 'Chanel No. 5', category: 'perfumes', about: 'Perfume by Coco Chanel' })), 'Chanel No. 5 perfume');
  assert.equal(searchQuery(item({ title: 'Y', category: 'perfumes', about: "Men's fragrance line by Yves Saint Laurent" })), 'Y Yves Saint Laurent perfume');
  assert.equal(searchQuery(item({ title: 'Opanak', category: 'shoes' })), 'Opanak shoes');
  assert.equal(searchQuery(item({ title: 'Cowboy boot', category: 'shoes' })), 'Cowboy boot');
  assert.equal(searchQuery(item({ title: 'Rolex Submariner', category: 'watches' })), 'Rolex Submariner watch');
  assert.equal(searchQuery(item({ title: 'Mercury (Planet)', category: 'toys' })), 'Mercury');
});

test('every card gets an Amazon link for its region, then shops that suit the category', () => {
  const coat = item({ title: 'Trench coat', category: 'clothing' });
  const us = shopLinks(coat, 'US');
  assert.equal(us[0].id, 'amazon');
  assert.equal(us[0].url, `https://www.amazon.com/s?k=Trench+coat${AMAZON_TAG ? `&tag=${AMAZON_TAG}` : ''}`);
  assert.deepEqual(us.map((link) => link.id), ['amazon', 'nordstrom', 'etsy', 'ebay']);
  const india = shopLinks(coat, 'IN');
  assert.equal(india[0].url.startsWith('https://www.amazon.in/s?k='), true);
  assert.ok(india.some((link) => link.id === 'flipkart') && !india.some((link) => link.id === 'nordstrom'));
  assert.ok(india.find((link) => link.id === 'ebay').url.startsWith('https://www.ebay.com/'), 'eBay.com where there is no local eBay');
  const uk = shopLinks(item({ title: 'Dune', category: 'books', about: 'novel by Frank Herbert' }), 'GB');
  assert.deepEqual(uk.map((link) => link.id), ['amazon', 'bookshop', 'abebooks', 'openlibrary']);
  assert.ok(uk[1].url.startsWith('https://uk.bookshop.org/search?keywords=Dune+Frank+Herbert'));
  assert.ok(uk[2].url.startsWith('https://www.abebooks.co.uk/servlet/SearchResults?kn='));
  const chair = shopLinks(item({ title: 'Rocking chair', category: 'home' }), 'DE');
  assert.equal(chair.find((link) => link.id === 'ikea').url, 'https://www.ikea.com/de/de/search/?q=Rocking+chair');
  const guitar = shopLinks(item({ title: 'Fender Stratocaster', category: 'instruments' }), 'BR');
  assert.deepEqual(guitar.map((link) => link.id), ['amazon', 'thomann', 'ebay']);
});

test("a small maker's card goes straight to the maker's own shop", () => {
  const maker = item({ title: 'Frost River', kind: 'maker', maker: 'Frost River', site: 'https://frostriver.com/', category: 'bags' });
  assert.deepEqual(shopLinks(maker, 'IN'), [{ id: 'maker', label: 'Frost River', note: "the maker's own shop", url: 'https://frostriver.com/' }]);
});

test('every category and region gives at least two valid links', () => {
  for (const category of CATEGORY_IDS) {
    for (const region of REGIONS) {
      const links = shopLinks(item({ title: 'A "test" & thing', category }), region.id);
      assert.ok(links.length >= 2 && links.length <= 5, `${category} ${region.id}`);
      for (const link of links) {
        assert.doesNotThrow(() => new URL(link.url));
        assert.match(link.url, /^https:\/\//);
        assert.ok(!link.url.includes(' ') && !link.url.includes('"'), link.url);
      }
    }
  }
});

test('taste learns from favourites and "not for me"', () => {
  const coat = item({ id: 'clothing/coat', category: 'clothing', vibes: ['retro'], moods: ['calm'], colours: ['black'] });
  let taste = learn(emptyTaste(), coat, 1);
  assert.ok(tasteFactor(coat, taste) > 1.3);
  assert.deepEqual(taste.hidden, []);
  taste = learn(taste, coat, -1);
  assert.equal(tasteFactor(coat, taste), 1, 'un-favouriting cancels the favourite');
  taste = learn(taste, coat, -1, { hide: true });
  assert.ok(tasteFactor(coat, taste) < 1);
  assert.deepEqual(taste.hidden, ['clothing/coat']);
  for (let i = 0; i < 20; i += 1) taste = learn(taste, coat, 1);
  assert.ok(tasteFactor(coat, taste) <= 3, 'stays within bounds');
  assert.equal(tasteFactor(coat, null), 1);
});

test('hidden objects never come back, and favourites tilt the draw', () => {
  const a = item({ id: 'clothing/a', category: 'clothing' });
  const b = item({ id: 'books/b', category: 'books' });
  const rng = seeded(4);
  const taste = learn(emptyTaste(), a, -1, { hide: true });
  for (let i = 0; i < 500; i += 1) assert.equal(draw({ items: [a, b], rarity: 'common', profile: {}, rng, taste }).item.id, 'books/b');
  let liked = emptyTaste();
  for (let i = 0; i < 3; i += 1) liked = learn(liked, a, 1);
  let count = 0;
  for (let i = 0; i < 4000; i += 1) if (draw({ items: [a, b], rarity: 'common', profile: {}, rng, taste: liked }).item.id === 'clothing/a') count += 1;
  assert.ok(count / 4000 > 0.6, `liked share ${count / 4000}`);
  const onlyHidden = draw({ items: [a], rarity: 'common', profile: {}, rng, taste });
  assert.equal(onlyHidden.item.id, 'clothing/a', 'falls back rather than drawing nothing');
});

test('"goes well with" picks objects from other categories that share the feel', () => {
  const manifest = JSON.parse(readFileSync(new URL('../data/catalog/index.json', import.meta.url), 'utf8'));
  const items = manifest.categories.flatMap((c) => JSON.parse(readFileSync(new URL(`../data/catalog/${c.file}`, import.meta.url), 'utf8')));
  const coat = items.find((entry) => entry.title === "Levi's 501"); // a seed, so always there
  const picks = pairings(coat, items);
  assert.equal(picks.length, 3);
  assert.equal(new Set(picks.map((p) => p.category)).size, 3);
  assert.ok(picks.every((p) => p.category !== coat.category && p.image));
  assert.deepEqual(pairings(coat, items).map((p) => p.id), picks.map((p) => p.id), 'the same every time');
  assert.ok(picks.every((p) => p.vibes.some((v) => coat.vibes.includes(v)) || p.moods.some((m) => coat.moods.includes(m))));
  const hidden = pairings(coat, items, { hidden: [picks[0].id] });
  assert.ok(!hidden.some((p) => p.id === picks[0].id));
});

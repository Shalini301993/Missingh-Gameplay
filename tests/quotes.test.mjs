import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quoteFor, quoteScore, quotesItself, quoteLines, hashString } from '../src/core/quotes.js';
import { CATEGORY_IDS, VIBES, MOODS } from '../src/core/vocab.js';

const quotes = JSON.parse(readFileSync(new URL('../data/quotes.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../data/catalog/index.json', import.meta.url), 'utf8'));
const items = manifest.categories.flatMap((c) => JSON.parse(readFileSync(new URL(`../data/catalog/${c.file}`, import.meta.url), 'utf8')));

const item = (extra) => ({ id: 'home/x', title: 'Thing', category: 'home', about: '', blurb: '', vibes: [], moods: [], ...extra });

test('every quote is complete and uses the shared vocabulary', () => {
  assert.ok(quotes.length >= 80, `${quotes.length} quotes`);
  const texts = new Set();
  for (const quote of quotes) {
    for (const field of ['text', 'author', 'work', 'source']) assert.ok(quote[field]?.trim(), `${quote.text}: ${field}`);
    assert.match(quote.source, /^https:\/\/(www\.gutenberg\.org\/ebooks\/\d+|en\.wikisource\.org\/wiki\/)/);
    assert.ok(quote.cats.length && quote.cats.every((c) => CATEGORY_IDS.includes(c)), quote.text);
    assert.ok(quote.words.length, quote.text);
    assert.ok(quote.vibes.every((v) => VIBES.includes(v)) && quote.moods.every((m) => MOODS.includes(m)), quote.text);
    assert.ok(!texts.has(quote.text), `duplicate: ${quote.text}`);
    texts.add(quote.text);
  }
  for (const category of CATEGORY_IDS) assert.ok(quotes.filter((q) => q.cats.includes(category)).length >= 4, category);
});

test('a quote that names the object wins', () => {
  const tea = quoteFor(item({ id: 'home/teapot', title: 'Teapot', about: 'Vessel for steeping tea' }), quotes);
  assert.match(tea.text, /tea/i);
  const glove = quoteFor(item({ id: 'accessories/glove', title: 'Glove', category: 'accessories' }), quotes);
  assert.match(glove.text, /glove/i);
  assert.match(quoteFor(item({ id: 'vehicles/canoe', title: 'Canoe', category: 'vehicles' }), quotes).text, /boat/i);
});

test('names match whole words only', () => {
  const tieQuote = { text: 'x', cats: ['clothing'], words: ['tie'], vibes: [], moods: [] };
  assert.equal(quoteScore(item({ title: 'Tied knot', category: 'home' }), tieQuote), 0);
  assert.ok(quoteScore(item({ title: 'Bow tie', category: 'home' }), tieQuote) > 0);
  assert.ok(quoteScore(item({ title: 'Silk ties', category: 'home' }), tieQuote) > 0);
});

test('a book gets a line from itself when there is one', () => {
  const austen = quoteFor(item({ id: 'books/pride-and-prejudice', title: 'Pride and Prejudice', category: 'books' }), quotes);
  assert.equal(austen.work, 'Pride and Prejudice');
  assert.ok(quotesItself({ category: 'books', title: 'The Picture of Dorian Gray' }, { work: 'The Picture of Dorian Gray' }));
  assert.ok(!quotesItself({ category: 'toys', title: 'Emma' }, { work: 'Emma' }));
});

test('every object in the catalog gets a quote, the same one each time, and they are spread out', () => {
  const uses = new Map();
  for (const entry of items) {
    const quote = quoteFor(entry, quotes);
    assert.ok(quote, entry.id);
    assert.equal(quoteFor(entry, quotes), quote, `${entry.id} changes quote`);
    uses.set(quote.text, (uses.get(quote.text) ?? 0) + 1);
  }
  const most = Math.max(...uses.values());
  assert.ok(most / items.length < 0.08, `one quote covers ${most} objects`);
  assert.ok(uses.size >= quotes.length * 0.9, `only ${uses.size} quotes used`);
});

test('verse splits into lines and hashing is stable', () => {
  assert.deepEqual(quoteLines({ text: 'One line / two line' }), ['One line', 'two line']);
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
  assert.equal(quoteFor(item({}), []), null);
});

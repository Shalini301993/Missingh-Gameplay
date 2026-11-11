import test from 'node:test';
import assert from 'node:assert/strict';
import { score, draw, weightedPick, tierFallback, WILDCARD_CHANCE } from '../src/core/matcher.js';
import {
  newEconomy, refill, spend, settle, canPull, rollRarity, todayString, DAILY_TOKENS,
} from '../src/core/economy.js';

// Small deterministic generator so the statistical tests never flake.
function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const item = (id, extra = {}) => ({
  id, category: 'toys', vibes: [], moods: [], colours: [], budget: 'treat', rarity: 'common', ...extra,
});

test('score rewards each kind of match and is always positive', () => {
  const profile = { categories: ['books'], vibes: ['cosy'], colours: ['red'], budget: 'everyday', mood: 'calm' };
  const plain = score(item('a', { budget: 'dream' }), profile);
  assert.ok(plain > 0);
  assert.ok(score(item('b', { category: 'books', budget: 'dream' }), profile) > plain);
  assert.ok(score(item('c', { vibes: ['cosy'], budget: 'dream' }), profile) > plain);
  assert.ok(score(item('d', { moods: ['calm'], budget: 'dream' }), profile) > plain);
  assert.ok(score(item('e', { colours: ['red'], budget: 'dream' }), profile) > plain);
  assert.ok(score(item('f', { budget: 'everyday' }), profile) > score(item('g', { budget: 'treat' }), profile));
  assert.ok(score(item('h'), {}) > 0);
});

test('weightedPick follows the weights', () => {
  const rng = seeded(7);
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 4000; i += 1) counts[weightedPick(['a', 'b'], [3, 1], rng)] += 1;
  assert.ok(counts.a / 4000 > 0.7 && counts.a / 4000 < 0.8, `a share ${counts.a / 4000}`);
  assert.equal(weightedPick([], [], rng), null);
});

test('preferences shift what gets drawn', () => {
  const items = [item('toys/x'), item('books/y', { category: 'books', vibes: ['cosy'] })];
  const profile = { categories: ['books'], vibes: ['cosy'] };
  const rng = seeded(3);
  let liked = 0;
  for (let i = 0; i < 4000; i += 1) if (draw({ items, rarity: 'common', profile, rng }).item.id === 'books/y') liked += 1;
  assert.ok(liked / 4000 > 0.7, `liked share ${liked / 4000}`);
});

test('wildcards happen at about the stated rate', () => {
  const rng = seeded(11);
  let wild = 0;
  for (let i = 0; i < 5000; i += 1) if (draw({ items: [item('toys/x')], rarity: 'common', profile: {}, rng }).wildcard) wild += 1;
  assert.ok(Math.abs(wild / 5000 - WILDCARD_CHANCE) < 0.02, `wildcard share ${wild / 5000}`);
});

test('draw falls back to the nearest tier that has items', () => {
  assert.deepEqual(tierFallback('legendary'), ['legendary', 'rare', 'common']);
  assert.deepEqual(tierFallback('common'), ['common', 'rare', 'legendary']);
  const result = draw({ items: [item('toys/x')], rarity: 'legendary', profile: {}, rng: seeded(1) });
  assert.equal(result.rarity, 'common');
  assert.equal(result.item.id, 'toys/x');
  assert.equal(draw({ items: [], rarity: 'common', profile: {} }), null);
});

test('owned items are less likely and flagged as duplicates', () => {
  const items = [item('toys/x'), item('toys/y')];
  const owned = new Set(['toys/x']);
  const rng = seeded(5);
  let dupes = 0;
  for (let i = 0; i < 4000; i += 1) if (draw({ items, rarity: 'common', profile: {}, owned, rng }).duplicate) dupes += 1;
  assert.ok(dupes / 4000 > 0.15 && dupes / 4000 < 0.35, `duplicate share ${dupes / 4000}`);
});

test('tokens refill once a day and never shrink', () => {
  let economy = newEconomy('2026-01-01');
  assert.equal(economy.tokens, DAILY_TOKENS);
  economy = spend(spend(economy));
  assert.equal(refill(economy, '2026-01-01').tokens, DAILY_TOKENS - 2);
  assert.equal(refill(economy, '2026-01-02').tokens, DAILY_TOKENS);
  assert.equal(refill({ ...economy, tokens: 14 }, '2026-01-02').tokens, 14);
  assert.equal(todayString(new Date(2026, 0, 5)), '2026-01-05');
});

test('pulling with no tokens is refused', () => {
  const empty = { ...newEconomy('2026-01-01'), tokens: 0 };
  assert.equal(canPull(empty), false);
  assert.throws(() => spend(empty));
});

test('every fifth discovery and every second duplicate pay a token', () => {
  let economy = { ...newEconomy('2026-01-01'), tokens: 0 };
  const bonuses = [];
  for (let i = 0; i < 5; i += 1) { const r = settle(economy, { duplicate: false }); economy = r.economy; bonuses.push(r.bonus); }
  assert.deepEqual(bonuses, [0, 0, 0, 0, 1]);
  assert.equal(economy.tokens, 1);
  let r = settle(economy, { duplicate: true });
  assert.equal(r.bonus, 0);
  r = settle(r.economy, { duplicate: true });
  assert.equal(r.bonus, 1);
  assert.equal(r.economy.tokens, 2);
  assert.equal(r.economy.discoveries, 5);
});

test('rarity odds are about 5 / 20 / 75', () => {
  const rng = seeded(9);
  const counts = { common: 0, rare: 0, legendary: 0 };
  for (let i = 0; i < 20000; i += 1) counts[rollRarity(rng)] += 1;
  assert.ok(Math.abs(counts.legendary / 20000 - 0.05) < 0.01);
  assert.ok(Math.abs(counts.rare / 20000 - 0.2) < 0.015);
  assert.ok(Math.abs(counts.common / 20000 - 0.75) < 0.015);
});

// Scoring and weighted random selection. Pure functions; `rng` is any () => [0, 1).

import { BUDGET_IDS, RARITY_IDS } from './vocab.js';

export const WILDCARD_CHANCE = 0.15;
export const OWNED_PENALTY = 0.35;

const overlap = (a = [], b = []) => a.filter((v) => b.includes(v)).length;

// How strongly an item suits a profile. Always positive, so nothing is ever impossible.
export function score(item, profile = {}) {
  let w = 1;
  if (profile.categories?.includes(item.category)) w += 3;
  w += 1.2 * overlap(item.vibes, profile.vibes);
  if (profile.mood && item.moods?.includes(profile.mood)) w += 1.5;
  w += 0.8 * overlap(item.colours, profile.colours);
  if (profile.budget) {
    const gap = Math.abs(BUDGET_IDS.indexOf(item.budget) - BUDGET_IDS.indexOf(profile.budget));
    w += Math.max(0, 1.2 - 0.5 * gap);
  }
  return w;
}

export function weightedPick(items, weights, rng = Math.random) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!items.length || total <= 0) return null;
  let roll = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return items[i];
  }
  return items[items.length - 1];
}

// Tiers to try, nearest first, when the rolled tier has no items.
export function tierFallback(rarity) {
  const start = RARITY_IDS.indexOf(rarity);
  return [...RARITY_IDS].sort((a, b) =>
    Math.abs(RARITY_IDS.indexOf(a) - start) - Math.abs(RARITY_IDS.indexOf(b) - start));
}

// Draws one item of (ideally) the given rarity.
// `owned` is a Set of item ids the player already has; those are less likely but still possible.
export function draw({ items, rarity, profile, owned = new Set(), rng = Math.random }) {
  let pool = [];
  let tier = rarity;
  for (const candidate of tierFallback(rarity)) {
    pool = items.filter((item) => item.rarity === candidate);
    if (pool.length) { tier = candidate; break; }
  }
  if (!pool.length) return null;
  const wildcard = rng() < WILDCARD_CHANCE;
  const weights = pool.map((item) =>
    (wildcard ? 1 : score(item, profile)) * (owned.has(item.id) ? OWNED_PENALTY : 1));
  const item = weightedPick(pool, weights, rng);
  return { item, rarity: tier, wildcard, duplicate: owned.has(item.id) };
}

// Plain-language list of what an item and a profile have in common.
export function reasons(item, profile = {}) {
  const found = [];
  if (profile.categories?.includes(item.category)) found.push('a favourite category');
  for (const vibe of item.vibes ?? []) if (profile.vibes?.includes(vibe)) found.push(vibe);
  if (profile.mood && item.moods?.includes(profile.mood)) found.push(`your ${profile.mood} mood`);
  for (const colour of item.colours ?? []) if (profile.colours?.includes(colour)) found.push(colour);
  if (profile.budget && item.budget === profile.budget) found.push('your budget');
  return found;
}

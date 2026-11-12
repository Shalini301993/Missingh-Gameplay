// Learns what the player likes from what they do, and finds objects that go well together.
// Pure functions that return new state.

import { hashString } from './quotes.js';

export const emptyTaste = () => ({ category: {}, vibe: {}, mood: {}, colour: {}, hidden: [] });

const LIMIT = 3;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const average = (table, keys) => (keys.length ? keys.reduce((sum, key) => sum + (table[key] ?? 0), 0) / keys.length : 0);

// signal: +1 favourite, +0.5 opened a shop link, -1 un-favourite or "not for me".
// hide: true for "not for me", which also keeps that object out of future pulls.
export function learn(taste, item, signal, { hide = false } = {}) {
  const next = {
    category: { ...taste.category }, vibe: { ...taste.vibe }, mood: { ...taste.mood }, colour: { ...taste.colour },
    hidden: [...(taste.hidden ?? [])],
  };
  const bump = (table, key, amount) => { table[key] = clamp((table[key] ?? 0) + amount, -LIMIT, LIMIT); };
  bump(next.category, item.category, signal);
  for (const vibe of item.vibes ?? []) bump(next.vibe, vibe, signal * 0.6);
  for (const mood of item.moods ?? []) bump(next.mood, mood, signal * 0.4);
  for (const colour of item.colours ?? []) bump(next.colour, colour, signal * 0.4);
  if (hide && !next.hidden.includes(item.id)) next.hidden = [...next.hidden, item.id].slice(-500);
  return next;
}

// How much more (or less) likely an object becomes, from 0.25× to 3×.
export function tasteFactor(item, taste) {
  if (!taste) return 1;
  const sum = (taste.category[item.category] ?? 0)
    + average(taste.vibe, item.vibes ?? [])
    + 0.5 * average(taste.mood, item.moods ?? [])
    + 0.5 * average(taste.colour, item.colours ?? []);
  return clamp(Math.exp(0.35 * sum), 0.25, 3);
}

const overlap = (a = [], b = []) => a.filter((value) => b.includes(value)).length;

// Objects from other categories that share this one's feel: a perfume, a bag and a book for a coat.
export function pairings(item, items, { count = 3, hidden = [] } = {}) {
  const skip = new Set(hidden);
  const scored = [];
  for (const other of items) {
    if (other.category === item.category || other.id === item.id || skip.has(other.id) || !other.image) continue;
    const score = 2 * overlap(item.vibes, other.vibes) + 1.5 * overlap(item.moods, other.moods)
      + overlap(item.colours, other.colours) + (item.budget === other.budget ? 1 : 0);
    if (score <= 0) continue;
    // A stable tie-break, so a card shows the same pairings every time it opens.
    scored.push({ other, score: score + (hashString(`${item.id}|${other.id}`) % 1000) / 2000 });
  }
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  const categories = new Set();
  for (const { other } of scored) {
    if (categories.has(other.category)) continue;
    categories.add(other.category);
    picked.push(other);
    if (picked.length === count) break;
  }
  return picked;
}

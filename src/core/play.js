// What makes a pull exciting: the timing gauge, combos, fever, experience levels and daily
// missions. Pure functions that return new values.

import { hashString } from './quotes.js';

// ---------------------------------------------------------------- random numbers

export function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- the timing gauge
//
// A needle sweeps back and forth; the player stops it. Stopping inside the gold zone is a perfect
// pull, inside the wider band a good one. The needle speeds up and the gold zone narrows as the
// combo grows, so a streak gets harder to keep.

export function newGauge(rng, combo = 0) {
  const streak = Math.min(combo, 8);
  return {
    center: 0.22 + rng() * 0.56,
    speed: 0.85 + 0.11 * streak, // full widths per second
    perfect: Math.max(0.028, 0.055 - 0.0035 * streak), // half-widths
    good: 0.17,
  };
}

// Needle position from 0 to 1, bouncing between the ends.
export function needleAt(gauge, seconds) {
  const travel = (Math.max(0, seconds) * gauge.speed) % 2;
  return travel <= 1 ? travel : 2 - travel;
}

export function judge(gauge, position) {
  const distance = Math.abs(position - gauge.center);
  if (distance <= gauge.perfect) return 'perfect';
  if (distance <= gauge.good) return 'good';
  return 'miss';
}

// A stop position that lands in the asked-for zone (used by the ?stop= test switch).
export function positionFor(gauge, quality) {
  if (quality === 'perfect') return gauge.center;
  if (quality === 'good') return gauge.center + (gauge.perfect + gauge.good) / 2;
  return gauge.center > 0.5 ? 0 : 1;
}

export const ODDS = {
  miss: { legendary: 0.05, rare: 0.2 },
  good: { legendary: 0.08, rare: 0.27 },
  perfect: { legendary: 0.14, rare: 0.36 },
  fever: { legendary: 0.25, rare: 0.75 }, // fever pulls are always rare or better
};
export const oddsFor = (quality, fever = false) => (fever ? ODDS.fever : ODDS[quality] ?? ODDS.miss);

export const nextCombo = (combo, quality) => (quality === 'miss' ? 0 : combo + 1);

// ---------------------------------------------------------------- fever
//
// Every pull fills the fever meter, skilful and new finds fill it faster. When it is full, the next
// three pulls are fever pulls.

export const FEVER = { full: 100, pulls: 3 };

export const feverGain = ({ quality, isNew }) =>
  14 + (quality === 'perfect' ? 16 : quality === 'good' ? 6 : 0) + (isNew ? 6 : 0);

// fever: { meter, pulls }. Call once per pull, after the pull is drawn.
export function stepFever(fever, { quality, isNew }) {
  if (fever.pulls > 0) {
    const pulls = fever.pulls - 1;
    return { meter: 0, pulls, started: false, ended: pulls === 0 };
  }
  const meter = fever.meter + feverGain({ quality, isNew });
  if (meter >= FEVER.full) return { meter: 0, pulls: FEVER.pulls, started: true, ended: false };
  return { meter, pulls: 0, started: false, ended: false };
}

// ---------------------------------------------------------------- experience and levels

export const RARITY_XP = { common: 10, rare: 30, legendary: 80 };

export function xpFor({ rarity, isNew, quality, combo }) {
  const base = (RARITY_XP[rarity] ?? 10) + (isNew ? 15 : 0);
  const skill = quality === 'perfect' ? 1.5 : quality === 'good' ? 1.2 : 1;
  const streak = 1 + Math.min(combo, 10) * 0.1;
  return Math.round(base * skill * streak);
}

export const TITLES = [
  'Window-shopper', 'Browser', 'Collector', 'Curator', 'Connoisseur',
  'Tastemaker', 'Archivist', 'Museum director', 'Legend of the cabinet',
];

// Total experience needed to reach a level: 0, 100, 300, 600, 1000 …
export const xpToReach = (level) => 50 * level * (level - 1);

export function levelFor(xp) {
  let level = 1;
  while (xpToReach(level + 1) <= xp) level += 1;
  return {
    level,
    title: TITLES[Math.min(level, TITLES.length) - 1],
    into: xp - xpToReach(level),
    span: xpToReach(level + 1) - xpToReach(level),
  };
}

export const LEVEL_REWARD = 2; // tokens per level gained

// ---------------------------------------------------------------- daily missions

export const MISSIONS = [
  { id: 'pull5', text: 'Pull the lever 5 times', target: 5, on: 'pull', reward: 1 },
  { id: 'perfect3', text: 'Stop the needle in the gold 3 times', target: 3, on: 'perfect', reward: 2 },
  { id: 'skill5', text: 'Land 5 good or perfect stops', target: 5, on: 'skill', reward: 1 },
  { id: 'rare2', text: 'Find 2 rare or legendary objects', target: 2, on: 'rare', reward: 2 },
  { id: 'legendary1', text: 'Find a legendary object', target: 1, on: 'legendary', reward: 3 },
  { id: 'new4', text: 'Discover 4 new objects', target: 4, on: 'new', reward: 1 },
  { id: 'combo4', text: 'Reach a combo of 4', target: 4, on: 'combo', reward: 2, best: true },
  { id: 'fever1', text: 'Set off a fever', target: 1, on: 'fever', reward: 2 },
  { id: 'fav2', text: 'Favourite 2 objects', target: 2, on: 'favourite', reward: 1 },
  { id: 'cats3', text: 'Find objects in 3 different categories', target: 3, on: 'category', reward: 1, distinct: true },
  { id: 'shop1', text: 'Look one of your finds up in a shop', target: 1, on: 'shop', reward: 1 },
];
export const missionById = (id) => MISSIONS.find((mission) => mission.id === id);

// Three different missions, the same for everyone on a given day.
export function missionsFor(date) {
  const rng = seeded(hashString(`missions:${date}`));
  const pool = [...MISSIONS];
  const list = [];
  while (list.length < 3) {
    const [mission] = pool.splice(Math.floor(rng() * pool.length), 1);
    list.push({ id: mission.id, progress: 0, done: false, seen: [] });
  }
  return { date, list };
}

// Applies one event, such as { on: 'pull' } or { on: 'category', value: 'books' }.
// Returns the updated missions and the missions this event completed.
export function track(missions, event) {
  const completed = [];
  const list = missions.list.map((entry) => {
    const mission = missionById(entry.id);
    if (!mission || entry.done || mission.on !== event.on) return entry;
    const next = { ...entry, seen: [...(entry.seen ?? [])] };
    if (mission.distinct) {
      if (!next.seen.includes(event.value)) next.seen.push(event.value);
      next.progress = next.seen.length;
    } else if (mission.best) {
      next.progress = Math.max(next.progress, event.value ?? 0);
    } else {
      next.progress += 1;
    }
    next.progress = Math.min(next.progress, mission.target);
    if (next.progress >= mission.target) {
      next.done = true;
      completed.push(mission);
    }
    return next;
  });
  return { missions: { ...missions, list }, completed };
}

// The events a single pull produces.
export function pullEvents({ quality, rarity, isNew, combo, feverStarted, category }) {
  const events = [{ on: 'pull' }];
  if (quality === 'perfect') events.push({ on: 'perfect' });
  if (quality !== 'miss') events.push({ on: 'skill' });
  if (rarity === 'rare' || rarity === 'legendary') events.push({ on: 'rare' });
  if (rarity === 'legendary') events.push({ on: 'legendary' });
  if (isNew) events.push({ on: 'new' });
  events.push({ on: 'combo', value: combo });
  if (feverStarted) events.push({ on: 'fever' });
  events.push({ on: 'category', value: category });
  return events;
}

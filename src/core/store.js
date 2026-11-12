// Everything the game remembers lives in this browser's localStorage. Nothing is sent anywhere.

import { newEconomy, todayString } from './economy.js';
import { emptyTaste } from './taste.js';

const KEY = 'curio-capsule:v1';

export function defaultState(today = todayString()) {
  return {
    profile: { categories: [], vibes: [], colours: [], budget: 'treat', mood: null, moodDate: null, done: false, region: null },
    economy: newEconomy(today),
    collection: {}, // id -> { count, first, item }
    favourites: [],
    recent: [],
    play: { xp: 0, combo: 0, bestCombo: 0, fever: { meter: 0, pulls: 0 }, missions: null },
    taste: emptyTaste(),
    settings: { music: true, effects: true, volume: 0.7 },
  };
}

export function loadState(today = todayString()) {
  const base = defaultState(today);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!saved || typeof saved !== 'object') return base;
    return {
      profile: { ...base.profile, ...saved.profile },
      economy: { ...base.economy, ...saved.economy },
      collection: saved.collection || {},
      favourites: Array.isArray(saved.favourites) ? saved.favourites : [],
      recent: Array.isArray(saved.recent) ? saved.recent : [],
      play: { ...base.play, ...saved.play, fever: { ...base.play.fever, ...saved.play?.fever } },
      taste: { ...base.taste, ...saved.taste },
      settings: { ...base.settings, ...saved.settings },
    };
  } catch {
    return base; // storage blocked or corrupted: play with a fresh, unsaved state
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

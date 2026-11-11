// Everything the game remembers lives in this browser's localStorage. Nothing is sent anywhere.

import { newEconomy, todayString } from './economy.js';

const KEY = 'curio-capsule:v1';

export function defaultState(today = todayString()) {
  return {
    profile: { categories: [], vibes: [], colours: [], budget: 'treat', mood: null, moodDate: null, done: false },
    economy: newEconomy(today),
    collection: {}, // id -> { count, first, item }
    favourites: [],
    recent: [],
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

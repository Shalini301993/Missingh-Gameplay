// Curio Capsule: wires the machine, the catalog, the economy and the UI together.

/* global Phaser */

import { MOODS } from './core/vocab.js';
import { draw, reasons } from './core/matcher.js';
import { refill, spend, settle, canPull, rollRarity, todayString, PULL_COST } from './core/economy.js';
import { loadState, saveState } from './core/store.js';
import { loadCatalog } from './core/catalog.js';
import { MachineScene, STAGE } from './scenes/MachineScene.js';
import { h, chip, capitalise } from './ui/dom.js';
import { createProfileSheet, describeProfile } from './ui/profile.js';
import { createCardSheet } from './ui/card.js';
import { createCollectionSheet } from './ui/collection.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// `?seed=123` makes pulls repeatable, which is handy for testing.
function makeRng() {
  const seed = new URLSearchParams(location.search).get('seed');
  if (seed == null) return Math.random;
  let s = Number(seed) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng();
const state = loadState();
let catalog = null;
let busy = false;
let pendingBonus = 0;

state.economy = refill(state.economy, todayString());
if (state.profile.moodDate !== todayString()) state.profile.mood = null;
const save = () => saveState(state);
save();

// ---------------------------------------------------------------- machine

function createMachine() {
  try {
    const scene = new MachineScene({ onLever: () => pull(), reducedMotion });
    // eslint-disable-next-line no-new
    new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'stage',
      width: STAGE.width * STAGE.zoom,
      height: STAGE.height * STAGE.zoom,
      backgroundColor: '#f6f3ee',
      banner: false,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
      scene: [scene],
    });
    return scene;
  } catch (error) {
    console.error('The machine could not be drawn; pulls still work.', error);
    return { playPull: async () => {} };
  }
}

const machine = createMachine();

// ---------------------------------------------------------------- sheets

const card = createCardSheet($('card-dialog'), {
  isFavourite: (id) => state.favourites.includes(id),
  onFavourite: (id) => {
    state.favourites = state.favourites.includes(id)
      ? state.favourites.filter((other) => other !== id)
      : [...state.favourites, id];
    save();
    collection.refresh();
  },
});

const collection = createCollectionSheet($('collection-dialog'), {
  getState: () => state,
  getManifest: () => catalog?.manifest,
  onOpenItem: (item) => card.open(item, { closeLabel: 'Back to collection' }),
});

const profileSheet = createProfileSheet($('profile-dialog'), {
  getProfile: () => state.profile,
  onSave: (draft) => {
    Object.assign(state.profile, draft, { done: true, moodDate: draft.mood ? todayString() : state.profile.moodDate });
    save();
    render();
  },
});

$('open-profile').addEventListener('click', () => profileSheet.open());
$('open-collection').addEventListener('click', () => collection.open());
$('pull').addEventListener('click', () => pull());

// ---------------------------------------------------------------- rendering

function renderTokens() {
  const tokens = state.economy.tokens - pendingBonus;
  $('tokens').replaceChildren(
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('strong', {}, String(tokens)),
    ` ${tokens === 1 ? 'token' : 'tokens'}${state.economy.halves ? ' + ½' : ''}`,
  );
  const button = $('pull');
  if (!catalog) return;
  const out = !canPull(state.economy);
  button.disabled = busy || out;
  button.textContent = out ? 'Out of tokens' : busy ? 'Dispensing…' : `Pull the lever · ${PULL_COST} token`;
  if (out && !busy) $('status').textContent = 'Tokens refill tomorrow. Your collection is waiting in the meantime.';
}

function renderMood() {
  $('mood-chips').replaceChildren(...MOODS.map((mood) => chip({
    label: capitalise(mood),
    pressed: state.profile.mood === mood,
    onToggle: () => {
      state.profile.mood = state.profile.mood === mood ? null : mood;
      state.profile.moodDate = todayString();
      save();
      renderMood();
    },
  })));
}

function renderSummary() {
  $('likes-summary').replaceChildren(
    describeProfile(state.profile), ' ',
    h('button', { type: 'button', class: 'link-button', onClick: () => profileSheet.open() }, 'Edit'),
  );
}

function renderRecent() {
  const entries = state.recent.map((id) => state.collection[id]).filter(Boolean);
  $('recent').replaceChildren(...(entries.length
    ? entries.map((entry) => h('li', {},
      h('button', { type: 'button', onClick: () => card.open(entry.item, { closeLabel: 'Close' }) },
        h('span', { class: `rarity-dot ${entry.item.rarity}` }),
        h('span', { class: 'recent-title' }, entry.item.title),
        h('span', { class: 'recent-meta' }, capitalise(entry.item.rarity)))))
    : [h('li', { class: 'empty' }, 'Nothing yet. Your first capsule is one pull away.')]));
  $('collection-count').textContent = String(Object.keys(state.collection).length);
}

function render() {
  renderTokens();
  renderMood();
  renderSummary();
  renderRecent();
}

// ---------------------------------------------------------------- pulling

async function pull() {
  if (busy || !catalog) return;
  if ($('profile-dialog').open || $('card-dialog').open || $('collection-dialog').open) return;
  state.economy = refill(state.economy, todayString());
  if (!canPull(state.economy)) { renderTokens(); return; }

  const result = draw({
    items: catalog.items,
    rarity: rollRarity(rng),
    profile: state.profile,
    owned: new Set(Object.keys(state.collection)),
    rng,
  });
  if (!result) { $('status').textContent = 'The cabinet is empty.'; return; }

  // Commit the outcome before animating, so closing the tab mid-pull never loses a token.
  const { item } = result;
  const known = state.collection[item.id];
  state.collection[item.id] = { count: (known?.count ?? 0) + 1, first: known?.first ?? new Date().toISOString(), item };
  state.recent = [item.id, ...state.recent.filter((id) => id !== item.id)].slice(0, 6);
  const settled = settle(spend(state.economy), { duplicate: result.duplicate });
  state.economy = settled.economy;
  pendingBonus = settled.bonus;
  save();

  busy = true;
  $('status').textContent = '';
  renderTokens();
  try {
    await machine.playPull(result.rarity);
  } catch (error) {
    console.error(error);
  }
  busy = false;
  pendingBonus = 0;

  const notes = [];
  if (result.wildcard) notes.push('Wildcard pull: the machine ignored your likes for this one.');
  if (result.duplicate) notes.push(settled.bonus ? 'You already have this. Two duplicates make a token: +1.' : 'You already have this. Half a token back.');
  else notes.push(settled.bonus ? 'New to your collection. Fifth new find: +1 token.' : 'New to your collection.');
  card.open(item, { note: notes.join(' '), reasons: result.wildcard ? [] : reasons(item, state.profile) });
  render();
  collection.refresh();
}

// ---------------------------------------------------------------- start

render();

loadCatalog().then((loaded) => {
  catalog = loaded;
  $('catalog-note').textContent = `${loaded.manifest.total.toLocaleString('en')} objects in the cabinet across ${loaded.manifest.categories.length} categories. Catalog built ${loaded.manifest.built}.`;
  render();
  if (!state.profile.done) profileSheet.open();
}).catch((error) => {
  console.error(error);
  $('pull').textContent = 'Cabinet unavailable';
  $('status').textContent = 'The catalog could not be loaded. Check your connection and reload.';
});

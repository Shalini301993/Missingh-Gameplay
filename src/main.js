// Curio Capsule: wires the machine, the catalog, the rules, the music and the UI together.

/* global Phaser */

import { MOODS } from './core/vocab.js';
import { draw, reasons } from './core/matcher.js';
import { refill, spend, settle, canPull, rollRarity, todayString, PULL_COST } from './core/economy.js';
import { loadState, saveState } from './core/store.js';
import { loadCatalog } from './core/catalog.js';
import { quoteFor } from './core/quotes.js';
import { detectRegion } from './core/shops.js';
import { learn, tasteFactor, pairings } from './core/taste.js';
import {
  seeded, newGauge, needleAt, judge, positionFor, oddsFor, nextCombo, stepFever, xpFor, levelFor,
  LEVEL_REWARD, missionsFor, missionById, track, pullEvents, FEVER,
} from './core/play.js';
import { createAudio } from './audio/audio.js';
import { MachineScene, STAGE } from './scenes/MachineScene.js';
import { h, chip, capitalise } from './ui/dom.js';
import { createProfileSheet, describeProfile } from './ui/profile.js';
import { createCardSheet } from './ui/card.js';
import { createCollectionSheet } from './ui/collection.js';

const $ = (id) => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
// For testing: ?seed=123 makes pulls repeatable, and with it ?stop=perfect|good|miss fixes the stop.
const rng = params.has('seed') ? seeded(Number(params.get('seed'))) : Math.random;
const forcedStop = params.has('seed') ? params.get('stop') : null;

const state = loadState();
const today = todayString();
state.economy = refill(state.economy, today);
if (state.profile.moodDate !== today) state.profile.mood = null;
if (!state.profile.region) state.profile.region = detectRegion(navigator.languages ?? [navigator.language]);
if (state.play.missions?.date !== today) state.play.missions = missionsFor(today);
const save = () => saveState(state);
save();

let catalog = null;
let phase = 'idle'; // idle → aiming (needle moving) → dispensing (machine animating)
let gauge = null;
let aimStart = 0;
let aimFrame = 0;
let aimTimer = 0;
let heldTokens = 0; // tokens won this pull, shown once the capsule opens

// ---------------------------------------------------------------- sound

const audio = createAudio({ settings: state.settings, onTrack: renderNowPlaying });
audio.setMood(state.profile.mood);
// Browsers only allow sound after a click, tap or key press.
const wake = () => audio.unlock();
document.addEventListener('pointerdown', wake, true);
document.addEventListener('keydown', wake, true);

// ---------------------------------------------------------------- machine

function createMachine() {
  try {
    const scene = new MachineScene({ onLever: () => pullAction(), reducedMotion });
    scene.onTease = (step) => audio.sfx('tease', step);
    // eslint-disable-next-line no-new
    new Phaser.Game({
      // The plain 2D canvas is plenty for a few flat shapes and works without WebGL. It also avoids a
      // glitch seen in testing, where a WebGL canvas peeking out above an open card was drawn wrongly.
      type: Phaser.CANVAS,
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
    return { playPull: async (rarity, options) => { options?.onDrop?.(); options?.onReveal?.(); }, setFever() {} };
  }
}

const machine = createMachine();

// ---------------------------------------------------------------- notices

function toast(title, text, tone = '') {
  const note = h('div', { class: `toast ${tone}` }, h('strong', {}, title), text);
  $('toasts').append(note);
  setTimeout(() => {
    note.classList.add('leaving');
    setTimeout(() => note.remove(), 450);
  }, 3800);
}

const later = (ms, fn) => setTimeout(fn, ms);

// Counts an action toward today's missions and pays out any that complete.
function progress(on, value) {
  const outcome = track(state.play.missions, { on, value });
  state.play.missions = outcome.missions;
  celebrateMissions(outcome.completed);
  return outcome.completed;
}

function celebrateMissions(completed, delay = 0) {
  completed.forEach((mission, i) => {
    state.economy = { ...state.economy, tokens: state.economy.tokens + mission.reward };
    later(delay + i * 400, () => {
      toast('Mission complete', `${mission.text}. +${mission.reward} token${mission.reward > 1 ? 's' : ''}.`, 'gold');
      audio.sfx('mission');
    });
  });
  if (completed.length) { save(); later(delay, render); }
}

// ---------------------------------------------------------------- sheets

const card = createCardSheet($('card-dialog'), {
  quoteFor: (item) => quoteFor(item, catalog?.quotes),
  pairingsFor: (item) => pairings(item, catalog?.items ?? [], { hidden: state.taste.hidden }),
  getRegion: () => state.profile.region,
  onChangeRegion: () => { $('card-dialog').close(); profileSheet.open(); },
  isFavourite: (id) => state.favourites.includes(id),
  isHidden: (id) => state.taste.hidden.includes(id),
  onFavourite: (item) => {
    const on = !state.favourites.includes(item.id);
    state.favourites = on ? [...state.favourites, item.id] : state.favourites.filter((id) => id !== item.id);
    state.taste = learn(state.taste, item, on ? 1 : -1);
    if (on) progress('favourite');
    save();
    collection.refresh();
  },
  onNotForMe: (item) => {
    state.taste = learn(state.taste, item, -1, { hide: true });
    save();
    toast('Noted', 'That one will not come up again, and fewer things like it will.');
  },
  onShop: (item) => {
    state.taste = learn(state.taste, item, 0.5);
    progress('shop');
    save();
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
    audio.setMood(state.profile.mood);
    save();
    render();
  },
});

$('open-profile').addEventListener('click', () => profileSheet.open());
$('open-collection').addEventListener('click', () => collection.open());
$('pull').addEventListener('click', () => pullAction());
$('toggle-music').addEventListener('click', () => {
  state.settings.music = !state.settings.music;
  audio.setMusic(state.settings.music);
  save();
  renderSound();
});
$('toggle-sfx').addEventListener('click', () => {
  state.settings.effects = !state.settings.effects;
  audio.setEffects(state.settings.effects);
  save();
  renderSound();
});

const dialogOpen = () => ['profile-dialog', 'card-dialog', 'collection-dialog'].some((id) => $(id).open);
document.addEventListener('keydown', (event) => {
  if (event.key !== ' ' || event.repeat || dialogOpen()) return;
  if (event.target.closest?.('button, a, input, select, textarea')) return; // let focused controls handle it
  event.preventDefault();
  pullAction();
});

// ---------------------------------------------------------------- rendering

function renderPullButton() {
  const button = $('pull');
  if (!catalog) return;
  const out = !canPull(state.economy);
  button.classList.toggle('aiming', phase === 'aiming');
  button.disabled = phase === 'dispensing' || (out && phase === 'idle');
  button.textContent = phase === 'aiming' ? 'Stop!' : phase === 'dispensing' ? 'Dispensing…'
    : out ? 'Out of tokens' : `Pull the lever · ${PULL_COST} token`;
  if (out && phase === 'idle') $('status').textContent = 'Tokens refill tomorrow. Missions and level-ups also pay tokens.';
}

function renderTokens() {
  const tokens = state.economy.tokens - heldTokens;
  $('tokens').replaceChildren(...[
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('strong', {}, String(tokens)),
    ` ${tokens === 1 ? 'token' : 'tokens'}${state.economy.halves ? ' + ½' : ''}`,
    state.play.combo > 1 && h('span', { class: 'combo' }, ` · combo ×${state.play.combo}`),
  ].filter(Boolean));
  renderPullButton();
}

function renderFever() {
  const { meter, pulls } = state.play.fever;
  const on = pulls > 0;
  $('fever').classList.toggle('on', on);
  $('fever-fill').style.width = `${on ? 100 : Math.min(100, meter)}%`;
  $('fever-meter').setAttribute('aria-valuenow', String(on ? 100 : Math.round(meter)));
  $('fever-text').textContent = on ? `${pulls} fever pull${pulls === 1 ? '' : 's'} left` : `${Math.round((meter / FEVER.full) * 100)}%`;
}

function renderLevel() {
  const { level, title, into, span } = levelFor(state.play.xp);
  $('level-number').textContent = String(level);
  $('level-title').textContent = title;
  $('xp-fill').style.width = `${Math.round((into / span) * 100)}%`;
  $('xp-meter').setAttribute('aria-valuenow', String(Math.round((into / span) * 100)));
  $('xp-text').textContent = `${into} of ${span} XP to level ${level + 1}${state.play.bestCombo > 1 ? ` · best combo ×${state.play.bestCombo}` : ''}`;
}

function renderMissions() {
  const list = state.play.missions.list;
  $('missions').replaceChildren(...list.map((entry) => {
    const mission = missionById(entry.id);
    return h('li', { class: entry.done ? 'done' : '' },
      h('span', { class: 'mission-text' }, mission.text),
      h('span', { class: 'reward' }, entry.done ? 'done' : `+${mission.reward} token${mission.reward > 1 ? 's' : ''}`),
      h('div', { class: 'meter', role: 'progressbar', 'aria-label': mission.text, 'aria-valuemin': '0', 'aria-valuemax': String(mission.target), 'aria-valuenow': String(entry.progress) },
        h('div', { class: 'meter-fill', style: `width:${Math.round((entry.progress / mission.target) * 100)}%` })));
  }), ...(list.every((entry) => entry.done) ? [h('li', { class: 'small' }, 'All done. New missions tomorrow.')] : []));
}

function renderMood() {
  $('mood-chips').replaceChildren(...MOODS.map((mood) => chip({
    label: capitalise(mood),
    pressed: state.profile.mood === mood,
    onToggle: () => {
      state.profile.mood = state.profile.mood === mood ? null : mood;
      state.profile.moodDate = todayString();
      audio.setMood(state.profile.mood);
      save();
      renderMood();
    },
  })));
}

function renderNowPlaying(info = audio.describe()) {
  const line = $('now-playing');
  if (!line) return;
  if (!state.settings.music) { line.textContent = 'Music is off.'; return; }
  line.replaceChildren(
    info.playing ? 'Now playing: ' : 'Music starts with your first tap: ',
    h('em', {}, info.title), ` — ${info.feel}${state.profile.mood ? '' : '. Pick a mood to change it.'}`,
  );
}

function renderSound() {
  for (const [id, on, name] of [['toggle-music', state.settings.music, 'Music'], ['toggle-sfx', state.settings.effects, 'Sounds']]) {
    $(id).setAttribute('aria-pressed', String(on));
    $(id).textContent = `${name} ${on ? 'on' : 'off'}`;
  }
  renderNowPlaying();
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
  renderFever();
  renderLevel();
  renderMissions();
  renderMood();
  renderSound();
  renderSummary();
  renderRecent();
}

// ---------------------------------------------------------------- the gauge

function layoutGauge(current) {
  const zone = (id, half) => {
    $(id).style.left = `${(current.center - half) * 100}%`;
    $(id).style.width = `${half * 200}%`;
  };
  zone('gauge-good', current.good);
  zone('gauge-perfect', current.perfect);
}
const setNeedle = (position) => { $('gauge-needle').style.left = `${position * 100}%`; };

function verdict(quality) {
  const line = $('gauge-verdict');
  line.className = `gauge-verdict ${quality ?? ''}`;
  line.textContent = { perfect: 'Perfect!', good: 'Good', miss: 'Missed' }[quality] ?? '';
  if (quality) { void line.offsetWidth; line.classList.add('pop'); }
}

function pullAction() {
  if (!catalog || dialogOpen()) return;
  if (phase === 'idle') startAiming();
  else if (phase === 'aiming') stopAiming();
}

function startAiming() {
  state.economy = refill(state.economy, todayString());
  if (!canPull(state.economy)) { audio.sfx('empty'); renderTokens(); return; }
  phase = 'aiming';
  gauge = newGauge(rng, state.play.combo);
  layoutGauge(gauge);
  $('gauge').classList.add('live');
  verdict(null);
  $('status').textContent = '';
  aimStart = performance.now();
  audio.sfx('aim');
  const move = (now) => {
    setNeedle(needleAt(gauge, (now - aimStart) / 1000));
    aimFrame = requestAnimationFrame(move);
  };
  aimFrame = requestAnimationFrame(move);
  aimTimer = setTimeout(stopAiming, 4000); // waited too long: the needle stops where it is
  renderPullButton();
}

function stopAiming() {
  if (phase !== 'aiming') return;
  cancelAnimationFrame(aimFrame);
  clearTimeout(aimTimer);
  const position = forcedStop ? positionFor(gauge, forcedStop) : needleAt(gauge, (performance.now() - aimStart) / 1000);
  setNeedle(position);
  const quality = judge(gauge, position);
  verdict(quality);
  audio.sfx('stop', quality);
  dispense(quality);
}

// ---------------------------------------------------------------- a pull

async function dispense(quality) {
  phase = 'dispensing';
  const feverPull = state.play.fever.pulls > 0;
  const result = draw({
    items: catalog.items,
    rarity: rollRarity(rng, oddsFor(quality, feverPull)),
    profile: state.profile,
    owned: new Set(Object.keys(state.collection)),
    rng,
    taste: state.taste,
  });
  if (!result) { phase = 'idle'; $('status').textContent = 'The cabinet is empty.'; return; }

  // Settle everything before animating, so closing the tab mid-pull never loses a token.
  const { item } = result;
  const isNew = !result.duplicate;
  const known = state.collection[item.id];
  state.collection[item.id] = { count: (known?.count ?? 0) + 1, first: known?.first ?? new Date().toISOString(), item };
  state.recent = [item.id, ...state.recent.filter((id) => id !== item.id)].slice(0, 6);
  const tokensBefore = state.economy.tokens;
  const settled = settle(spend(state.economy), { duplicate: result.duplicate });
  state.economy = settled.economy;

  const combo = nextCombo(state.play.combo, quality);
  state.play.combo = combo;
  state.play.bestCombo = Math.max(state.play.bestCombo, combo);
  const xp = xpFor({ rarity: result.rarity, isNew, quality, combo });
  const before = levelFor(state.play.xp);
  state.play.xp += xp;
  const after = levelFor(state.play.xp);
  const levelsGained = after.level - before.level;
  if (levelsGained) state.economy = { ...state.economy, tokens: state.economy.tokens + LEVEL_REWARD * levelsGained };

  const fever = stepFever(state.play.fever, { quality, isNew });
  state.play.fever = { meter: fever.meter, pulls: fever.pulls };

  const completed = [];
  for (const event of pullEvents({ quality, rarity: result.rarity, isNew, combo, feverStarted: fever.started, category: item.category })) {
    const outcome = track(state.play.missions, event);
    state.play.missions = outcome.missions;
    completed.push(...outcome.completed);
  }
  const missionTokens = completed.reduce((sum, mission) => sum + mission.reward, 0);
  state.economy = { ...state.economy, tokens: state.economy.tokens + missionTokens };
  save();

  heldTokens = state.economy.tokens - (tokensBefore - PULL_COST);
  render();
  try {
    await machine.playPull(result.rarity, {
      quality,
      fever: feverPull,
      onDrop: () => audio.sfx('drop'),
      onReveal: () => audio.sfx('reveal', result.rarity),
    });
  } catch (error) {
    console.error(error);
  }
  heldTokens = 0;
  phase = 'idle';
  const feverOn = state.play.fever.pulls > 0;
  machine.setFever(feverOn);
  audio.setFever(feverOn);

  const notes = [];
  if (result.wildcard) notes.push('Wildcard pull: the machine ignored your likes for this one.');
  if (result.duplicate) notes.push(settled.bonus ? 'You already have this. Two duplicates make a token: +1.' : 'You already have this. Half a token back.');
  else notes.push(settled.bonus ? 'New to your collection. Fifth new find: +1 token.' : 'New to your collection.');
  const why = result.wildcard ? [] : reasons(item, state.profile);
  if (!result.wildcard && tasteFactor(item, state.taste) > 1.3) why.push('what you have favourited');
  card.open(item, { note: notes.join(' '), reasons: why, reward: { quality, xp, combo, fever: feverPull } });

  let delay = 300;
  if (levelsGained) {
    later(delay, () => { toast(`Level ${after.level}`, `${after.title}. +${LEVEL_REWARD * levelsGained} tokens.`, 'gold'); audio.sfx('level'); });
    delay += 500;
  }
  completed.forEach((mission) => {
    later(delay, () => { toast('Mission complete', `${mission.text}. +${mission.reward} token${mission.reward > 1 ? 's' : ''}.`, 'gold'); audio.sfx('mission'); });
    delay += 450;
  });
  if (fever.started) later(delay, () => { toast('Fever!', `The next ${FEVER.pulls} pulls are rare or better.`, 'red'); audio.sfx('fever'); });
  if (fever.ended) later(delay, () => toast('Fever over', 'Fill the meter again for another.'));
  render();
  collection.refresh();
}

// ---------------------------------------------------------------- start

render();
machine.setFever?.(state.play.fever.pulls > 0);

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

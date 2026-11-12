// Plays the mood music and the sound effects. Everything is synthesized as it plays.
//
// Browsers only allow sound after the player has clicked or tapped, so nothing starts until
// unlock() is called from a click. Music pauses while the tab is hidden.

import { TRACKS, trackFor } from './tracks.js';
import { piano, bell, brass, clap, kick, snap, reverbImpulse, noiseBuffer } from './instruments.js';
import { seeded } from '../core/play.js';

const LOOKAHEAD = 0.2; // seconds of music scheduled ahead
const EFFECTS_LEVEL = 1.7; // effects sit a little above the music
const FADE = 1.4;

// Schedules a track's steps from its cursor up to `until`.
function advance(ctx, entry, until) {
  const { track } = entry;
  const tempo = entry.fever ? 1.08 : 1;
  const beat = 60 / (track.bpm * tempo);
  const stepsPerBar = track.stepsPerBeat * track.beatsPerBar;
  while (entry.next < until) {
    const base = beat / track.stepsPerBeat;
    // Swing: on-beats a little longer, off-beats a little shorter.
    const stepDur = track.stepsPerBeat % 2 === 0 ? base * (entry.step % 2 === 0 ? 1 + track.swing : 1 - track.swing) : base;
    const position = { step: entry.step, bar: Math.floor(entry.step / stepsPerBar), stepInBar: entry.step % stepsPerBar, stepDur: base };
    if (entry.next >= ctx.currentTime - 0.01) {
      track.step(ctx, entry.out, position, entry.next, entry.rng, entry.state, entry.fever ? 1 : 0);
    }
    entry.next += stepDur;
    entry.step += 1;
  }
}

function startEntry(ctx, key, music, reverbIn, { at, fadeIn = FADE, seed = 1 }) {
  const track = TRACKS[key];
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, at);
  out.gain.linearRampToValueAtTime(track.level, at + fadeIn);
  out.connect(music);
  const send = ctx.createGain();
  send.gain.value = track.reverb;
  out.connect(send).connect(reverbIn);
  const entry = { key, track, out, send, next: at + 0.05, step: 0, rng: seeded(seed), fever: false };
  entry.state = track.setup?.(ctx, out, at) ?? {};
  return entry;
}

function stopEntry(ctx, entry, at, fade = FADE) {
  entry.out.gain.cancelScheduledValues(at);
  entry.out.gain.setValueAtTime(entry.out.gain.value, at);
  entry.out.gain.linearRampToValueAtTime(0, at + fade);
  entry.track.teardown?.(entry.state, at + fade + 0.1);
  setTimeout(() => { entry.out.disconnect(); entry.send.disconnect(); }, (fade + 2.5) * 1000);
}

// Builds the mixing chain: music and effects buses into a gentle compressor, with a shared room.
function buildGraph(ctx, settings) {
  const master = ctx.createGain();
  master.gain.value = settings.volume ?? 0.7;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.knee.value = 12;
  glue.ratio.value = 3.5;
  glue.attack.value = 0.01;
  glue.release.value = 0.25;
  master.connect(glue).connect(ctx.destination);
  const music = ctx.createGain();
  music.gain.value = settings.music === false ? 0 : 0.8;
  music.connect(master);
  const effects = ctx.createGain();
  effects.gain.value = settings.effects === false ? 0 : EFFECTS_LEVEL;
  effects.connect(master);
  const room = ctx.createConvolver();
  room.buffer = reverbImpulse(ctx);
  const roomLevel = ctx.createGain();
  roomLevel.gain.value = 0.4;
  room.connect(roomLevel).connect(master);
  noiseBuffer(ctx);
  return { master, music, effects, room };
}

// ---------------------------------------------------------------- sound effects

const SFX = {
  aim(ctx, out, t) {
    const sweep = ctx.createBiquadFilter();
    sweep.type = 'bandpass';
    sweep.Q.value = 3;
    sweep.frequency.setValueAtTime(400, t);
    sweep.frequency.exponentialRampToValueAtTime(2400, t + 0.35);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.4, t + 0.15);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.connect(sweep).connect(amp).connect(out);
    source.start(t);
    source.stop(t + 0.45);
  },
  stop(ctx, out, t, quality) {
    if (quality === 'perfect') [84, 88, 91, 96].forEach((midi, i) => bell(ctx, out, t + i * 0.045, midi, { vel: 0.9, ring: 1.4 }));
    else if (quality === 'good') [79, 84].forEach((midi, i) => bell(ctx, out, t + i * 0.06, midi, { vel: 1.2, ring: 1 }));
    else { kick(ctx, out, t, { vel: 0.5 }); piano(ctx, out, t, 47, { dur: 0.2, vel: 0.5 }); }
  },
  drop(ctx, out, t) {
    [0, 0.13, 0.21, 0.26].forEach((offset, i) => snap(ctx, out, t + offset, { vel: 1.1 - i * 0.2 }));
    kick(ctx, out, t, { vel: 0.4 });
  },
  reveal(ctx, out, t, rarity) {
    if (rarity === 'legendary') {
      brass(ctx, out, t, [60, 64, 67, 72], { dur: 0.9, vel: 0.9 });
      [96, 91, 88, 84, 79, 84, 88, 96].forEach((midi, i) => bell(ctx, out, t + 0.12 + i * 0.07, midi, { vel: 0.7, ring: 1.6 }));
    } else if (rarity === 'rare') {
      [72, 76, 79, 84].forEach((midi, i) => piano(ctx, out, t + i * 0.06, midi, { dur: 0.6, vel: 0.7 }));
      bell(ctx, out, t + 0.26, 91, { vel: 0.6 });
    } else {
      piano(ctx, out, t, 72, { dur: 0.5, vel: 0.55 });
      piano(ctx, out, t + 0.05, 79, { dur: 0.5, vel: 0.5 });
    }
  },
  level(ctx, out, t) {
    [72, 76, 79, 84, 88].forEach((midi, i) => piano(ctx, out, t + i * 0.07, midi, { dur: 0.5, vel: 0.7 }));
    bell(ctx, out, t + 0.38, 96, { vel: 0.8, ring: 2 });
  },
  tease(ctx, out, t, step) {
    const note = { common: 79, rare: 86, legendary: 91 }[step] ?? 79;
    bell(ctx, out, t, note, { vel: 1, ring: 0.7 });
    piano(ctx, out, t, note - 24, { dur: 0.2, vel: 0.5 });
  },
  mission(ctx, out, t) { bell(ctx, out, t, 88, { vel: 1.3 }); bell(ctx, out, t + 0.09, 93, { vel: 1.3 }); },
  token(ctx, out, t) { bell(ctx, out, t, 91, { vel: 1.4, ring: 0.6 }); bell(ctx, out, t + 0.06, 98, { vel: 1.4, ring: 0.8 }); },
  fever(ctx, out, t) {
    for (let i = 0; i < 6; i += 1) clap(ctx, out, t + i * 0.09, { vel: 0.5 + i * 0.08 });
    brass(ctx, out, t + 0.55, [62, 65, 69, 74], { dur: 0.7, vel: 0.9 });
  },
  empty(ctx, out, t) { piano(ctx, out, t, 50, { dur: 0.3, vel: 0.4 }); piano(ctx, out, t + 0.12, 49, { dur: 0.5, vel: 0.35 }); },
};

// ---------------------------------------------------------------- the player

export function createAudio({ settings = {}, onTrack = () => {} } = {}) {
  let ctx = null;
  let graph = null;
  let current = null;
  let mood = null;
  let fever = false;
  let timer = null;
  let seed = 1;
  const options = { music: true, effects: true, volume: 0.7, ...settings };

  const tick = () => {
    if (!ctx || ctx.state !== 'running' || !current) return;
    advance(ctx, current, ctx.currentTime + LOOKAHEAD);
  };

  function switchTo(key) {
    if (!ctx) return;
    const now = ctx.currentTime;
    if (current?.key === key) return;
    if (current) stopEntry(ctx, current, now);
    seed += 1;
    current = startEntry(ctx, key, graph.music, graph.room, { at: now + 0.05, seed });
    current.fever = fever;
    onTrack(describe());
  }

  function describe() {
    const key = trackFor(mood);
    const track = TRACKS[key];
    return { key, title: track.title, feel: track.feel, playing: Boolean(ctx && options.music && ctx.state === 'running') };
  }

  function unlock() {
    if (!ctx) {
      // iPhones mute web audio while the silent switch is on, unless the page asks to play like a
      // music player (iOS 17 and later).
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older browsers */ }
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return false;
      ctx = new Context({ latencyHint: 'playback' });
      graph = buildGraph(ctx, options);
      timer = setInterval(tick, 50);
      document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
      });
    }
    if (ctx.state === 'suspended') ctx.resume();
    if (options.music && !current) switchTo(trackFor(mood));
    onTrack(describe());
    return true;
  }

  return {
    unlock,
    get unlocked() { return Boolean(ctx); },
    describe,
    setMood(next) {
      mood = next;
      if (ctx && options.music) switchTo(trackFor(mood));
      else onTrack(describe());
    },
    setFever(on) {
      fever = Boolean(on);
      if (current) current.fever = fever;
    },
    setMusic(on) {
      options.music = on;
      if (!ctx) { onTrack(describe()); return; }
      const now = ctx.currentTime;
      graph.music.gain.cancelScheduledValues(now);
      graph.music.gain.setValueAtTime(graph.music.gain.value, now);
      graph.music.gain.linearRampToValueAtTime(on ? 0.8 : 0, now + 0.4);
      if (on && !current) switchTo(trackFor(mood));
      if (!on && current) { stopEntry(ctx, current, now, 0.4); current = null; }
      onTrack(describe());
    },
    setEffects(on) {
      options.effects = on;
      if (graph) graph.effects.gain.setValueAtTime(on ? EFFECTS_LEVEL : 0, ctx.currentTime);
    },
    setVolume(volume) {
      options.volume = volume;
      if (graph) graph.master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
    },
    sfx(name, detail) {
      if (!ctx || !options.effects || ctx.state !== 'running' || !SFX[name]) return;
      SFX[name](ctx, graph.effects, ctx.currentTime + 0.01, detail);
    },
    stop() { clearInterval(timer); if (ctx) ctx.close(); ctx = null; current = null; },
  };
}

// Renders a track into an OfflineAudioContext, for tests. Resolves to the rendered AudioBuffer.
export async function renderTrack(OfflineContext, key, seconds, { fever = false, sampleRate = 22050 } = {}) {
  const ctx = new OfflineContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const graph = buildGraph(ctx, { volume: 0.7 });
  const entry = startEntry(ctx, key, graph.music, graph.room, { at: 0, fadeIn: 0.05, seed: 7 });
  entry.fever = fever;
  advance(ctx, entry, seconds);
  return ctx.startRendering();
}

// Renders one sound effect, for tests.
export async function renderEffect(OfflineContext, name, detail, { seconds = 2.5, sampleRate = 22050 } = {}) {
  const ctx = new OfflineContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const graph = buildGraph(ctx, { volume: 0.7 });
  SFX[name](ctx, graph.effects, 0.01, detail);
  return ctx.startRendering();
}

export const EFFECTS = Object.keys(SFX);

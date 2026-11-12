// Synthesized instruments, built from Web Audio oscillators, noise and filters. No samples.
// Every voice takes (ctx, out, t, …) and schedules itself to play at time t on node `out`.

export const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const SILENT = 0.0001;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const noiseBuffers = new WeakMap();
// Two seconds of white noise per context, from a fixed seed so offline renders repeat exactly.
export function noiseBuffer(ctx) {
  if (!noiseBuffers.has(ctx)) {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 22222;
    for (let i = 0; i < data.length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = seed / 2147483648 - 1;
    }
    noiseBuffers.set(ctx, buffer);
  }
  return noiseBuffers.get(ctx);
}

let noiseOffset = 0;
function noiseSource(ctx, t, dur) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  noiseOffset = (noiseOffset + 0.377) % 1.5;
  source.start(t, noiseOffset);
  source.stop(t + dur);
  return source;
}

function gainNode(ctx, value = 0) {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

function filter(ctx, type, frequency, q = 0.7) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

function osc(ctx, type, frequency, t, stop) {
  const node = ctx.createOscillator();
  node.type = type;
  node.frequency.setValueAtTime(frequency, t);
  node.start(t);
  node.stop(stop);
  return node;
}

// Acoustic piano: a few slightly stretched partials through a filter that darkens as the note fades.
export function piano(ctx, out, t, midi, { dur = 1, vel = 0.7 } = {}) {
  const f = hz(midi);
  const ring = clamp(3.4 - (midi - 48) * 0.04, 0.7, 3.8);
  const end = t + dur + 0.9;
  const amp = gainNode(ctx);
  const tone = filter(ctx, 'lowpass', 1000);
  tone.frequency.setValueAtTime(clamp(900 + 4200 * vel, 600, 6000), t);
  tone.frequency.setTargetAtTime(Math.max(500, f * 2.2), t + 0.02, ring / 3);
  tone.connect(amp).connect(out);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.2 * vel, t + 0.006);
  amp.gain.setTargetAtTime(0, t + 0.006, ring / 4);
  amp.gain.setTargetAtTime(0, t + dur, 0.09); // the damper comes down when the key is let go
  for (const [ratio, level, type] of [[1, 1, 'triangle'], [2, 0.38, 'sine'], [3, 0.14, 'sine'], [4.02, 0.05, 'sine']]) {
    const partial = gainNode(ctx, level);
    osc(ctx, type, f * ratio * (1 + 0.00035 * ratio * ratio), t, end).connect(partial).connect(tone);
  }
  // The felt hammer: a tiny burst of filtered noise.
  const knock = gainNode(ctx);
  knock.gain.setValueAtTime(0.03 * vel, t);
  knock.gain.exponentialRampToValueAtTime(SILENT, t + 0.03);
  noiseSource(ctx, t, 0.04).connect(filter(ctx, 'bandpass', clamp(f * 4, 800, 5000), 1.2)).connect(knock).connect(out);
}

// Electric piano in the Rhodes manner: frequency modulation that softens after the strike.
export function epiano(ctx, out, t, midi, { dur = 0.8, vel = 0.7 } = {}) {
  const f = hz(midi);
  const end = t + dur + 0.7;
  const amp = gainNode(ctx);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.16 * vel, t + 0.004);
  amp.gain.setTargetAtTime(0.07 * vel, t + 0.01, 0.25);
  amp.gain.setTargetAtTime(0, t + dur, 0.1);
  amp.connect(out);
  const carrier = osc(ctx, 'sine', f, t, end);
  const modulator = osc(ctx, 'sine', f, t, end);
  const depth = gainNode(ctx);
  depth.gain.setValueAtTime(f * (0.9 + 1.4 * vel), t);
  depth.gain.setTargetAtTime(f * 0.25, t, 0.35);
  modulator.connect(depth).connect(carrier.frequency);
  carrier.connect(amp);
  // The tine: a short, bright ping on the attack.
  const tine = gainNode(ctx);
  tine.gain.setValueAtTime(0.03 * vel, t);
  tine.gain.exponentialRampToValueAtTime(SILENT, t + 0.25);
  osc(ctx, 'sine', f * 7.1, t, t + 0.3).connect(tine).connect(out);
}

// Upright or round synth bass.
export function bass(ctx, out, t, midi, { dur = 0.5, vel = 0.8, round = false } = {}) {
  const f = hz(midi);
  const end = t + dur + 0.3;
  const amp = gainNode(ctx);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.32 * vel, t + 0.008);
  amp.gain.setTargetAtTime(0.18 * vel, t + 0.01, round ? 0.4 : 0.12);
  amp.gain.setTargetAtTime(0, t + dur, 0.05);
  const tone = filter(ctx, 'lowpass', round ? 420 : 900, 0.8);
  tone.connect(amp).connect(out);
  const body = osc(ctx, 'sine', f, t, end);
  if (!round) {
    body.frequency.setValueAtTime(f * 1.015, t);
    body.frequency.exponentialRampToValueAtTime(f, t + 0.05);
  }
  body.connect(tone);
  const edge = gainNode(ctx, round ? 0.2 : 0.4);
  osc(ctx, 'triangle', f, t, end).connect(edge).connect(tone);
}

// Harmonium: reedy, slightly detuned pairs, swelling in like a hand on the bellows.
export function harmonium(ctx, out, t, midis, { dur = 2, vel = 0.6, slideFrom = null } = {}) {
  const end = t + dur + 0.4;
  const amp = gainNode(ctx);
  const level = (0.11 * vel) / Math.sqrt(midis.length);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + 0.07);
  amp.gain.setTargetAtTime(0, t + dur, 0.08);
  const tone = filter(ctx, 'lowpass', 1700, 0.9);
  tone.connect(amp).connect(out);
  for (const midi of midis) {
    const f = hz(midi);
    for (const [type, cents] of [['sawtooth', -6], ['square', 5]]) {
      const reed = osc(ctx, type, f, t, end);
      reed.detune.value = cents;
      if (slideFrom !== null) {
        // A meend: slide into the note from the one before.
        reed.frequency.setValueAtTime(hz(slideFrom), t);
        reed.frequency.exponentialRampToValueAtTime(f, t + 0.09);
      }
      const pair = gainNode(ctx, type === 'square' ? 0.5 : 0.7);
      reed.connect(pair).connect(tone);
    }
  }
}

// Brass section stab for the bebop track.
export function brass(ctx, out, t, midis, { dur = 0.25, vel = 0.7 } = {}) {
  const end = t + dur + 0.2;
  const amp = gainNode(ctx);
  const level = (0.1 * vel) / Math.sqrt(midis.length);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(level, t + 0.03);
  amp.gain.setTargetAtTime(0, t + dur, 0.05);
  const tone = filter(ctx, 'lowpass', 500, 1.5);
  tone.frequency.setValueAtTime(500, t);
  tone.frequency.linearRampToValueAtTime(900 + 2600 * vel, t + 0.05);
  tone.frequency.setTargetAtTime(1100, t + 0.06, 0.15);
  tone.connect(amp).connect(out);
  for (const midi of midis) {
    for (const cents of [-7, 6]) {
      const voice = osc(ctx, 'sawtooth', hz(midi), t, end);
      voice.detune.value = cents;
      voice.connect(tone);
    }
  }
}

// A struck bell or glockenspiel: inharmonic partials that ring and fade.
export function bell(ctx, out, t, midi, { vel = 0.6, ring = 1.6 } = {}) {
  const f = hz(midi);
  for (const [ratio, level, decay] of [[1, 1, ring], [2.76, 0.35, ring * 0.5], [5.4, 0.18, ring * 0.25]]) {
    const amp = gainNode(ctx);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(0.07 * vel * level, t + 0.003);
    amp.gain.exponentialRampToValueAtTime(SILENT, t + decay);
    osc(ctx, 'sine', f * ratio, t, t + decay + 0.05).connect(amp).connect(out);
  }
}

// A plucked string: bright attack, quick fade.
export function pluck(ctx, out, t, midi, { vel = 0.6, dur = 0.4 } = {}) {
  const f = hz(midi);
  const amp = gainNode(ctx);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.09 * vel, t + 0.003);
  amp.gain.exponentialRampToValueAtTime(SILENT, t + dur);
  const tone = filter(ctx, 'lowpass', 3500, 1);
  tone.frequency.setValueAtTime(4000, t);
  tone.frequency.exponentialRampToValueAtTime(900, t + dur);
  tone.connect(amp).connect(out);
  osc(ctx, 'triangle', f, t, t + dur + 0.05).connect(tone);
  const upper = gainNode(ctx, 0.3);
  osc(ctx, 'sawtooth', f * 2, t, t + dur + 0.05).connect(upper).connect(tone);
}

// ---------------------------------------------------------------- percussion

function hit(ctx, out, t, { freq, q = 1, type = 'bandpass', peak, decay, attack = 0.001 }) {
  const amp = gainNode(ctx);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + attack);
  amp.gain.exponentialRampToValueAtTime(SILENT, t + attack + decay);
  noiseSource(ctx, t, attack + decay + 0.02).connect(filter(ctx, type, freq, q)).connect(amp).connect(out);
}

function thump(ctx, out, t, { from, to, peak, decay, glide = 0.1, type = 'sine' }) {
  const amp = gainNode(ctx);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.002);
  amp.gain.exponentialRampToValueAtTime(SILENT, t + decay);
  const body = osc(ctx, type, from, t, t + decay + 0.02);
  body.frequency.exponentialRampToValueAtTime(to, t + glide);
  body.connect(amp).connect(out);
}

export function kick(ctx, out, t, { vel = 0.8 } = {}) {
  thump(ctx, out, t, { from: 130, to: 46, peak: 0.55 * vel, decay: 0.32, glide: 0.09 });
}

export function snare(ctx, out, t, { vel = 0.6, soft = false } = {}) {
  hit(ctx, out, t, { freq: soft ? 1400 : 1900, q: 0.6, peak: (soft ? 0.12 : 0.22) * vel, decay: soft ? 0.16 : 0.12 });
  thump(ctx, out, t, { from: 220, to: 160, peak: 0.08 * vel, decay: 0.08 });
}

// A brush swept across the snare.
export function brush(ctx, out, t, { vel = 0.5, dur = 0.18 } = {}) {
  const amp = gainNode(ctx);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(0.06 * vel, t + dur * 0.5);
  amp.gain.exponentialRampToValueAtTime(SILENT, t + dur);
  noiseSource(ctx, t, dur + 0.02).connect(filter(ctx, 'bandpass', 3200, 0.5)).connect(amp).connect(out);
}

export function hat(ctx, out, t, { vel = 0.5, open = false } = {}) {
  hit(ctx, out, t, { freq: 8000, type: 'highpass', q: 0.7, peak: 0.07 * vel, decay: open ? 0.28 : 0.045 });
}

export function ride(ctx, out, t, { vel = 0.5 } = {}) {
  hit(ctx, out, t, { freq: 6500, type: 'highpass', q: 0.5, peak: 0.05 * vel, decay: 0.45 });
  hit(ctx, out, t, { freq: 3400, q: 6, peak: 0.02 * vel, decay: 0.35 });
}

export function snap(ctx, out, t, { vel = 0.6 } = {}) {
  hit(ctx, out, t, { freq: 2600, q: 2.2, peak: 0.22 * vel, decay: 0.05 });
  thump(ctx, out, t, { from: 1900, to: 1500, peak: 0.03 * vel, decay: 0.03 });
}

// Hand claps: a few quick bursts, then the room.
export function clap(ctx, out, t, { vel = 0.6 } = {}) {
  for (const [offset, level] of [[0, 1], [0.011, 0.8], [0.023, 0.9]]) {
    hit(ctx, out, t + offset, { freq: 1150, q: 0.9, peak: 0.16 * vel * level, decay: 0.012 });
  }
  hit(ctx, out, t + 0.03, { freq: 1100, q: 0.7, peak: 0.07 * vel, decay: 0.11 });
}

export function shaker(ctx, out, t, { vel = 0.4 } = {}) {
  hit(ctx, out, t, { freq: 6000, q: 1.2, peak: 0.03 * vel, decay: 0.06, attack: 0.015 });
}

// Tabla. The bayan (bass drum) booms and bends; the dayan (treble) rings at the tonic.
export function tabla(ctx, out, t, stroke, { vel = 0.7, tonic = 62 } = {}) {
  const ringing = (decay, level = 1) => {
    const f = hz(tonic + 12);
    for (const [ratio, part] of [[1, 1], [2, 0.45], [3, 0.2], [4, 0.1]]) {
      thump(ctx, out, t, { from: f * ratio * 1.012, to: f * ratio, peak: 0.07 * vel * part * level, decay, glide: 0.04 });
    }
    hit(ctx, out, t, { freq: 3000, q: 1.5, peak: 0.03 * vel * level, decay: 0.02 });
  };
  const boom = (rise = false) => thump(ctx, out, t, {
    from: rise ? 72 : 105, to: rise ? 98 : 64, peak: 0.42 * vel, decay: rise ? 0.6 : 0.45, glide: rise ? 0.22 : 0.25,
  });
  const dry = (level = 1) => hit(ctx, out, t, { freq: 1700, q: 1.1, peak: 0.08 * vel * level, decay: 0.035 });
  switch (stroke) {
    case 'dha': boom(); ringing(0.4); break;
    case 'dhin': boom(); ringing(0.75, 0.8); break;
    case 'ge': boom(true); break;
    case 'na': ringing(0.35); break;
    case 'tin': ringing(0.7, 0.7); break;
    case 'ti': ringing(0.08, 0.8); dry(0.6); break;
    case 'ka': thump(ctx, out, t, { from: 140, to: 110, peak: 0.12 * vel, decay: 0.06 }); dry(0.9); break;
    default: dry();
  }
}

// The hiss and crackle of an old record, as a looping layer. Returns a stop function.
export function vinyl(ctx, out, t, { level = 0.5 } = {}) {
  const length = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 777;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < length; i += 1) {
    let sample = (rand() * 2 - 1) * 0.012; // hiss
    if (rand() < 0.0009) sample += (rand() < 0.5 ? -1 : 1) * (0.2 + rand() * 0.5); // crackle
    data[i] = sample;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const amp = gainNode(ctx, 0.35 * level);
  source.connect(filter(ctx, 'bandpass', 2500, 0.4)).connect(amp).connect(out);
  source.start(t);
  return (when) => { try { source.stop(when); } catch { /* already stopped */ } };
}

// Room reverb from a decaying noise burst, made once per context.
export function reverbImpulse(ctx, seconds = 2.6, decay = 3.2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 4242;
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 2147483648 - 1) * (1 - i / length) ** decay;
    }
  }
  return buffer;
}

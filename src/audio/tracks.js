// One generative piece of music per mood. Original compositions in the spirit of
// Chopin's nocturnes and waltzes, lo-fi and neo-soul grooves, qawwali and bebop.
//
// A track is a tempo, a feel and a step() function that the engine calls once per step (a
// sixteenth or a triplet, depending on the track) with the time that step starts.

import {
  piano, epiano, bass, harmonium, brass, bell, pluck,
  kick, snare, brush, hat, ride, snap, clap, shaker, tabla, vinyl,
} from './instruments.js';

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const nearest = (list, target) => list.reduce((best, note) => (Math.abs(note - target) < Math.abs(best - target) ? note : best), list[0]);
const notesIn = (pitchClasses, low, high) => {
  const notes = [];
  for (let midi = low; midi <= high; midi += 1) if (pitchClasses.includes(midi % 12)) notes.push(midi);
  return notes;
};

// A bar of melody: onsets from a rhythm template, pitches that move mostly by step and land on
// chord tones on the strong beats.
function melodyBar(rng, { template, scale, chordTones, previous, strong = [0] }) {
  const events = [];
  let note = previous ?? scale[Math.floor(scale.length / 2)];
  for (const [step, length] of template) {
    let index = scale.indexOf(nearest(scale, note));
    if (strong.includes(step)) {
      const tones = scale.filter((midi) => chordTones.includes(midi % 12));
      note = nearest(tones.length ? tones : scale, note + (rng() - 0.5) * 7);
    } else {
      const move = rng() < 0.72 ? (rng() < 0.5 ? -1 : 1) : (rng() < 0.5 ? -2 : 2);
      index = Math.min(scale.length - 1, Math.max(0, index + move));
      note = scale[index];
    }
    events.push({ step, length, midi: note });
  }
  return { events, last: note };
}

const pcs = (midis) => midis.map((midi) => midi % 12);

// ---------------------------------------------------------------- calm: a nocturne

const nocturne = {
  title: 'Nocturne in D-flat',
  feel: 'after Chopin, with jazz harmony',
  bpm: 50, stepsPerBeat: 3, beatsPerBar: 4, swing: 0, reverb: 0.55, level: 2,
  chords: [
    { arp: [37, 44, 49, 53, 56, 60], tones: [1, 5, 8, 0, 3] }, // D♭maj9
    { arp: [34, 41, 46, 49, 53, 56], tones: [10, 1, 5, 8, 0] }, // B♭m9
    { arp: [42, 49, 53, 58, 61, 58], tones: [6, 10, 1, 5] }, // G♭maj7
    { arp: [32, 44, 51, 54, 58, 61], tones: [8, 1, 3, 6, 10] }, // A♭13sus
    { arp: [41, 48, 51, 56, 60, 63], tones: [5, 8, 0, 3] }, // Fm7
    { arp: [34, 41, 46, 49, 53, 56], tones: [10, 1, 5, 8, 0] }, // B♭m9
    { arp: [39, 46, 49, 54, 58, 61], tones: [3, 6, 10, 1, 5] }, // E♭m9
    { arp: [32, 44, 48, 51, 54, 60], tones: [8, 0, 3, 6] }, // A♭7
  ],
  setup() { return { phrase: [], previous: 72 }; },
  step(ctx, out, { bar, stepInBar, stepDur }, t, rng, state, intensity) {
    const chord = this.chords[bar % this.chords.length];
    const arpOrder = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3];
    const lh = chord.arp[arpOrder[stepInBar]];
    piano(ctx, out, t, lh, { dur: stepDur * 2.5, vel: stepInBar === 0 ? 0.55 : 0.32 });
    if (stepInBar === 0) {
      const scale = notesIn([1, 3, 5, 8, 10, 0], 65, 84);
      const template = pick(rng, [
        [[0, 6], [6, 3], [9, 3]], [[0, 9], [9, 3]], [[0, 3], [3, 3], [6, 6]], [[0, 12]], [[0, 6], [6, 6]], [[0, 4], [4, 2], [6, 6]],
      ]);
      const { events, last } = melodyBar(rng, { template, scale, chordTones: chord.tones, previous: state.previous, strong: [0, 6] });
      state.previous = last;
      state.phrase = events;
    }
    for (const event of state.phrase) {
      if (event.step !== stepInBar) continue;
      const rubato = (rng() - 0.5) * 0.03;
      if (event.length >= 6 && rng() < 0.3) {
        // A Chopin turn: a quick upper neighbour before the long note.
        piano(ctx, out, t + rubato, event.midi + 2, { dur: stepDur * 0.4, vel: 0.45 });
        piano(ctx, out, t + rubato + stepDur * 0.33, event.midi, { dur: event.length * stepDur, vel: 0.7 });
      } else {
        piano(ctx, out, t + rubato, event.midi, { dur: event.length * stepDur, vel: 0.68 });
      }
    }
    if (stepInBar === 0 && bar % 4 === 3) bell(ctx, out, t + stepDur * 6, chord.arp[5] + 24, { vel: 0.35, ring: 2.4 });
    if (intensity && stepInBar % 3 === 0) brush(ctx, out, t, { vel: 0.5, dur: stepDur * 2 });
  },
};

// ---------------------------------------------------------------- romantic: a jazz waltz

const waltz = {
  title: 'Waltz for a Rose',
  feel: 'a Chopin waltz played in a jazz trio',
  bpm: 132, stepsPerBeat: 2, beatsPerBar: 3, swing: 0.12, reverb: 0.4, level: 0.95,
  chords: [
    { bass: 45, voicing: [55, 59, 60, 64], tones: [9, 0, 4, 7, 11] }, // Am9
    { bass: 50, voicing: [54, 57, 60, 64], tones: [2, 6, 9, 0, 4] }, // D9
    { bass: 43, voicing: [54, 57, 59, 62], tones: [7, 11, 2, 6, 9] }, // Gmaj9
    { bass: 48, voicing: [52, 55, 59, 62], tones: [0, 4, 7, 11, 2] }, // Cmaj9
    { bass: 42, voicing: [52, 57, 60, 64], tones: [6, 9, 0, 4] }, // F♯m7♭5
    { bass: 47, voicing: [51, 57, 60, 63], tones: [11, 3, 6, 9, 0] }, // B7♭9
    { bass: 40, voicing: [55, 59, 62, 66], tones: [4, 7, 11, 2, 6] }, // Em9
    { bass: 40, voicing: [56, 62, 67], tones: [4, 8, 11, 2] }, // E7
  ],
  setup() { return { phrase: [], previous: 76 }; },
  step(ctx, out, { bar, stepInBar, stepDur }, t, rng, state, intensity) {
    const chord = this.chords[bar % this.chords.length];
    if (stepInBar === 0) {
      bass(ctx, out, t, chord.bass, { dur: stepDur * 3.5, vel: 0.85 });
      const scale = notesIn([9, 11, 0, 2, 4, 6, 7], 67, 86);
      const template = pick(rng, [[[0, 4], [4, 2]], [[0, 2], [2, 2], [4, 2]], [[0, 6]], [[0, 3], [3, 1], [4, 2]], [[2, 4]]]);
      const { events, last } = melodyBar(rng, { template, scale, chordTones: chord.tones, previous: state.previous });
      state.phrase = events;
      state.previous = last;
    }
    if (stepInBar === 4) bass(ctx, out, t, chord.bass + 7, { dur: stepDur * 1.5, vel: 0.55 });
    if (stepInBar === 2 || stepInBar === 4) {
      for (const midi of chord.voicing) piano(ctx, out, t + (rng() - 0.5) * 0.01, midi, { dur: stepDur * 1.6, vel: 0.34 });
    }
    for (const event of state.phrase) {
      if (event.step === stepInBar) piano(ctx, out, t, event.midi, { dur: event.length * stepDur, vel: 0.72 });
    }
    if (stepInBar % 2 === 0) brush(ctx, out, t, { vel: stepInBar === 0 ? 0.55 : 0.35, dur: stepDur * 1.6 });
    if (intensity && stepInBar % 2 === 1) ride(ctx, out, t, { vel: 0.4 });
  },
};

// ---------------------------------------------------------------- nostalgic: lo-fi

const lofi = {
  title: 'Lo-fi Letters',
  feel: 'dusty electric piano and soft drums',
  bpm: 76, stepsPerBeat: 4, beatsPerBar: 4, swing: 0.2, reverb: 0.3, level: 1,
  chords: [
    { bass: 41, voicing: [57, 60, 64, 67], tones: [5, 9, 0, 4, 7] }, // Fmaj9
    { bass: 40, voicing: [55, 59, 62, 66], tones: [4, 7, 11, 2, 6] }, // Em9
    { bass: 38, voicing: [53, 57, 60, 64], tones: [2, 5, 9, 0, 4] }, // Dm9
    { bass: 43, voicing: [53, 59, 64], tones: [7, 11, 5, 4] }, // G13
  ],
  setup(ctx, out, t) { return { stopVinyl: vinyl(ctx, out, t, { level: 0.6 }), phrase: [], previous: 76 }; },
  step(ctx, out, { bar, stepInBar, stepDur }, t, rng, state, intensity) {
    const chord = this.chords[bar % this.chords.length];
    if ([0, 7, 10].includes(stepInBar)) kick(ctx, out, t, { vel: stepInBar === 0 ? 0.6 : 0.42 });
    if (stepInBar === 4 || stepInBar === 12) snare(ctx, out, t, { vel: 0.5, soft: true });
    if (stepInBar % 2 === 0 || intensity) hat(ctx, out, t, { vel: stepInBar % 4 === 2 ? 0.5 : 0.3, open: stepInBar === 14 && bar % 2 === 1 });
    if (stepInBar === 0) for (const midi of chord.voicing) epiano(ctx, out, t, midi, { dur: stepDur * 9, vel: 0.5 });
    if (stepInBar === 10) for (const midi of chord.voicing.slice(1)) epiano(ctx, out, t, midi + 12, { dur: stepDur * 3, vel: 0.28 });
    if (stepInBar === 0) bass(ctx, out, t, chord.bass, { dur: stepDur * 6, vel: 0.75, round: true });
    if (stepInBar === 10) bass(ctx, out, t, chord.bass + 7, { dur: stepDur * 3, vel: 0.6, round: true });
    if (stepInBar === 14) bass(ctx, out, t, chord.bass + (rng() < 0.5 ? -1 : 2), { dur: stepDur * 2, vel: 0.5, round: true });
    if (stepInBar === 0 && bar % 2 === 0) {
      const scale = notesIn([0, 2, 4, 7, 9], 72, 88);
      const template = pick(rng, [[[2, 2], [4, 4], [10, 6]], [[0, 3], [3, 3], [6, 2], [12, 4]], [[8, 8]], [[4, 2], [6, 2], [8, 8]]]);
      const { events, last } = melodyBar(rng, { template, scale, chordTones: chord.tones, previous: state.previous, strong: [0, 8] });
      state.phrase = events;
      state.previous = last;
    } else if (stepInBar === 0) {
      state.phrase = [];
    }
    for (const event of state.phrase) {
      if (event.step === stepInBar) {
        epiano(ctx, out, t, event.midi, { dur: event.length * stepDur, vel: 0.55 });
        if (rng() < 0.3) bell(ctx, out, t, event.midi + 12, { vel: 0.25, ring: 1 });
      }
    }
  },
  teardown(state, when) { state.stopVinyl?.(when); },
};

// ---------------------------------------------------------------- playful: neo-soul

const neosoul = {
  title: 'Rhodes and Sunlight',
  feel: 'laid-back neo-soul, in the manner of FKJ',
  bpm: 98, stepsPerBeat: 4, beatsPerBar: 4, swing: 0.14, reverb: 0.3, level: 1,
  chords: [
    { bass: 39, voicing: [55, 58, 62, 65], tones: [3, 7, 10, 2, 5] }, // E♭maj9
    { bass: 36, voicing: [55, 58, 63, 65], tones: [0, 3, 7, 10, 5] }, // Cm11
    { bass: 44, voicing: [55, 58, 60, 63], tones: [8, 0, 3, 7, 10] }, // A♭maj9
    { bass: 46, voicing: [56, 60, 63, 67], tones: [10, 3, 5, 8, 0, 7] }, // B♭13sus
  ],
  setup() { return { phrase: [], previous: 79 }; },
  step(ctx, out, { bar, stepInBar, stepDur }, t, rng, state, intensity) {
    const chord = this.chords[bar % this.chords.length];
    if ([0, 8, 11].includes(stepInBar)) kick(ctx, out, t, { vel: stepInBar === 11 ? 0.45 : 0.7 });
    if (stepInBar === 4 || stepInBar === 12) { snap(ctx, out, t, { vel: 0.7 }); if (intensity) clap(ctx, out, t, { vel: 0.5 }); }
    hat(ctx, out, t, { vel: stepInBar % 4 === 2 ? 0.55 : 0.25 });
    if (stepInBar % 4 === 2) shaker(ctx, out, t, { vel: 0.5 });
    if ([0, 3, 6, 10].includes(stepInBar)) {
      const length = stepInBar === 0 ? 3 : 2;
      for (const midi of chord.voicing) epiano(ctx, out, t, midi, { dur: stepDur * length, vel: stepInBar === 0 ? 0.55 : 0.4 });
    }
    const line = { 0: 0, 3: 12, 6: 7, 8: 0, 10: 10, 14: 12 };
    if (stepInBar in line) bass(ctx, out, t, chord.bass + line[stepInBar], { dur: stepDur * 1.6, vel: 0.8, round: true });
    if (stepInBar === 0 && bar % 2 === 1) {
      const scale = notesIn([3, 5, 7, 10, 0], 70, 87);
      const template = pick(rng, [[[0, 2], [2, 1], [3, 1], [4, 4]], [[6, 2], [8, 2], [10, 2], [12, 4]], [[2, 2], [5, 3], [10, 6]], [[0, 1], [1, 1], [2, 2], [8, 8]]]);
      const { events, last } = melodyBar(rng, { template, scale, chordTones: chord.tones, previous: state.previous, strong: [0, 8] });
      state.phrase = events;
      state.previous = last;
    } else if (stepInBar === 0) {
      state.phrase = [];
      // An answering guitar figure, rising through the chord.
      if (rng() < 0.6) chord.voicing.forEach((midi, i) => pluck(ctx, out, t + stepDur * (8 + i), midi + 12, { vel: 0.5 }));
    }
    for (const event of state.phrase) if (event.step === stepInBar) epiano(ctx, out, t, event.midi, { dur: event.length * stepDur, vel: 0.62 });
  },
};

// ---------------------------------------------------------------- adventurous: qawwali

const qawwali = {
  title: 'Qawwali Nights',
  feel: 'harmonium, tabla and hand claps over a walking bass',
  bpm: 100, stepsPerBeat: 2, beatsPerBar: 4, swing: 0.06, reverb: 0.35, level: 0.95,
  chords: [
    { bass: 38, drone: [50, 57, 60, 65], tones: [2, 5, 9, 0, 4] }, // Dm9
    { bass: 38, drone: [50, 57, 60, 65], tones: [2, 5, 9, 0, 4] },
    { bass: 43, drone: [53, 57, 59, 62], tones: [7, 11, 2, 5, 9] }, // G9
    { bass: 45, drone: [52, 55, 57, 62], tones: [9, 2, 4, 7] }, // A7sus4
  ],
  // Keherwa: the eight-beat cycle of qawwali, one stroke per step.
  theka: ['dha', 'ge', 'na', 'ti', 'na', 'ka', 'dhin', 'na'],
  setup() { return { phrase: [], previous: 69, lastNote: null }; },
  step(ctx, out, { bar, stepInBar, stepDur }, t, rng, state, intensity) {
    const chord = this.chords[bar % this.chords.length];
    tabla(ctx, out, t, this.theka[stepInBar], { vel: stepInBar === 0 ? 0.9 : 0.65, tonic: 62 });
    if (stepInBar % 2 === 0 || intensity) clap(ctx, out, t + 0.005, { vel: stepInBar === 0 ? 0.75 : 0.55 });
    if (stepInBar === 0) harmonium(ctx, out, t, chord.drone, { dur: stepDur * 7.6, vel: 0.5 });
    if (stepInBar % 2 === 0) {
      // Walking bass: root, a chord tone, then a step toward the next chord.
      const next = this.chords[(bar + 1) % this.chords.length].bass;
      const walk = [chord.bass, chord.bass + pick(rng, [3, 7]), chord.bass + pick(rng, [7, 10, 12]), next + (rng() < 0.5 ? -1 : 1)];
      bass(ctx, out, t, walk[stepInBar / 2], { dur: stepDur * 1.8, vel: 0.75 });
    }
    if (stepInBar === 0) {
      const scale = notesIn([2, 4, 5, 7, 9, 11, 0], 62, 81);
      const template = bar % 4 === 3
        ? [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 2]] // a taan: a fast run to end the phrase
        : pick(rng, [[[0, 3], [3, 1], [4, 4]], [[0, 2], [2, 2], [4, 2], [6, 2]], [[0, 6], [6, 2]], [[2, 2], [4, 4]]]);
      const { events, last } = melodyBar(rng, { template, scale, chordTones: chord.tones, previous: state.previous, strong: [0, 4] });
      state.phrase = events;
      state.previous = last;
    }
    for (const event of state.phrase) {
      if (event.step !== stepInBar) continue;
      harmonium(ctx, out, t, [event.midi + 12], { dur: event.length * stepDur * 0.95, vel: 0.85, slideFrom: event.length > 1 ? state.lastNote : null });
      state.lastNote = event.midi + 12;
    }
  },
};

// ---------------------------------------------------------------- bold: bebop

const bebop = {
  title: 'Midnight Bebop',
  feel: 'swing at full tilt: walking bass, ride and horns',
  bpm: 172, stepsPerBeat: 2, beatsPerBar: 4, swing: 0.32, reverb: 0.22, level: 0.95,
  // Two chords to a bar, rhythm-changes style.
  bars: [
    [{ root: 46, voicing: [50, 55, 60] }, { root: 43, voicing: [53, 59, 63] }], // B♭6 G7
    [{ root: 48, voicing: [51, 58, 62] }, { root: 41, voicing: [51, 57, 62] }], // Cm7 F7
    [{ root: 38, voicing: [53, 60, 64] }, { root: 43, voicing: [53, 59, 63] }], // Dm7 G7
    [{ root: 48, voicing: [51, 58, 62] }, { root: 41, voicing: [51, 57, 62] }], // Cm7 F7
  ],
  setup() { return { phrase: [], previous: 70 }; },
  step(ctx, out, { bar, stepInBar, stepDur }, t, rng, state, intensity) {
    const halves = this.bars[bar % this.bars.length];
    const chord = halves[stepInBar < 4 ? 0 : 1];
    const nextRoot = this.bars[(bar + 1) % this.bars.length][0].root;
    if (stepInBar % 2 === 0) {
      ride(ctx, out, t, { vel: 0.55 });
      const beat = stepInBar / 2;
      const walk = [chord.root, chord.root + pick(rng, [4, 3, 7]), chord.root, nextRoot + (rng() < 0.5 ? -1 : 1)];
      bass(ctx, out, t, walk[beat], { dur: stepDur * 1.7, vel: 0.85 });
      if (beat === 1 || beat === 3) hat(ctx, out, t, { vel: 0.35 });
    } else if (stepInBar === 3 || stepInBar === 7) {
      ride(ctx, out, t, { vel: 0.35 });
    }
    if (stepInBar === 0 || stepInBar === 3 || (rng() < 0.15 && stepInBar === 5)) {
      for (const midi of chord.voicing) piano(ctx, out, t, midi, { dur: stepDur * 1.2, vel: 0.45 });
    }
    if (intensity && stepInBar % 2 === 1) snare(ctx, out, t, { vel: 0.25, soft: true });
    if (stepInBar === 0) {
      if (bar % 2 === 0) {
        const scale = notesIn([10, 0, 2, 3, 5, 7, 9, 11, 1], 65, 84);
        const template = [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 2]].filter(() => rng() < 0.85);
        const { events, last } = melodyBar(rng, { template, scale, chordTones: [chord.root % 12, (chord.root + 4) % 12, (chord.root + 7) % 12, (chord.root + 10) % 12], previous: state.previous, strong: [0, 4] });
        state.phrase = events;
        state.previous = last;
      } else {
        state.phrase = [];
        if (bar % 4 === 3) brass(ctx, out, t + stepDur * 7, chord.voicing.map((m) => m + 12), { dur: stepDur * 1.5, vel: 0.8 });
      }
    }
    for (const event of state.phrase) {
      if (event.step !== stepInBar) continue;
      if (bar % 4 === 0) brass(ctx, out, t, [event.midi], { dur: stepDur * event.length * 0.9, vel: 0.7 });
      else piano(ctx, out, t, event.midi, { dur: stepDur * event.length, vel: 0.62 });
    }
  },
};

export const TRACKS = { calm: nocturne, romantic: waltz, nostalgic: lofi, playful: neosoul, adventurous: qawwali, bold: bebop };
export const DEFAULT_TRACK = 'nostalgic';
export const trackFor = (mood) => (TRACKS[mood] ? mood : DEFAULT_TRACK);

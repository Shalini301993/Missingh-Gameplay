import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seeded, newGauge, needleAt, judge, positionFor, oddsFor, ODDS, nextCombo, stepFever, feverGain, FEVER,
  xpFor, levelFor, xpToReach, TITLES, missionsFor, missionById, track, pullEvents, MISSIONS,
} from '../src/core/play.js';
import { rollRarity } from '../src/core/economy.js';

test('the needle bounces between the ends of the gauge', () => {
  const gauge = { center: 0.5, speed: 1, perfect: 0.05, good: 0.17 };
  assert.equal(needleAt(gauge, 0), 0);
  assert.equal(needleAt(gauge, 0.5), 0.5);
  assert.equal(needleAt(gauge, 1), 1);
  assert.equal(needleAt(gauge, 1.25), 0.75);
  assert.equal(needleAt(gauge, 2), 0);
  assert.equal(needleAt(gauge, -1), 0);
});

test('stops are judged by distance from the centre', () => {
  const gauge = { center: 0.4, speed: 1, perfect: 0.05, good: 0.17 };
  assert.equal(judge(gauge, 0.42), 'perfect');
  assert.equal(judge(gauge, 0.5), 'good');
  assert.equal(judge(gauge, 0.7), 'miss');
  for (const quality of ['perfect', 'good', 'miss']) assert.equal(judge(gauge, positionFor(gauge, quality)), quality);
});

test('a longer combo makes the gauge faster and the gold zone narrower', () => {
  const calm = newGauge(seeded(1), 0);
  const tense = newGauge(seeded(1), 8);
  assert.ok(tense.speed > calm.speed);
  assert.ok(tense.perfect < calm.perfect && tense.perfect >= 0.028);
  for (let i = 0; i < 50; i += 1) {
    const gauge = newGauge(seeded(i), i % 10);
    assert.ok(gauge.center - gauge.good >= 0 && gauge.center + gauge.good <= 1, 'zones stay on the gauge');
  }
});

test('better stops improve the odds, and fever pulls are always rare or better', () => {
  assert.ok(ODDS.perfect.legendary > ODDS.good.legendary && ODDS.good.legendary > ODDS.miss.legendary);
  assert.deepEqual(oddsFor('miss'), ODDS.miss);
  assert.deepEqual(oddsFor('perfect', true), ODDS.fever);
  const rng = seeded(3);
  for (let i = 0; i < 2000; i += 1) assert.notEqual(rollRarity(rng, ODDS.fever), 'common');
  const counts = { common: 0, rare: 0, legendary: 0 };
  for (let i = 0; i < 20000; i += 1) counts[rollRarity(rng, ODDS.perfect)] += 1;
  assert.ok(Math.abs(counts.legendary / 20000 - ODDS.perfect.legendary) < 0.01);
});

test('combos grow on good stops and break on a miss', () => {
  assert.equal(nextCombo(0, 'good'), 1);
  assert.equal(nextCombo(3, 'perfect'), 4);
  assert.equal(nextCombo(5, 'miss'), 0);
});

test('fever fills, gives three pulls, then resets', () => {
  let fever = { meter: 0, pulls: 0 };
  let steps = 0;
  let started = false;
  while (!started) {
    const next = stepFever(fever, { quality: 'perfect', isNew: true });
    started = next.started;
    fever = { meter: next.meter, pulls: next.pulls };
    steps += 1;
  }
  assert.equal(steps, Math.ceil(FEVER.full / feverGain({ quality: 'perfect', isNew: true })));
  assert.equal(fever.pulls, FEVER.pulls);
  const ends = [];
  for (let i = 0; i < FEVER.pulls; i += 1) {
    const next = stepFever(fever, { quality: 'miss', isNew: false });
    fever = { meter: next.meter, pulls: next.pulls };
    ends.push(next.ended);
  }
  assert.deepEqual(ends, [false, false, true]);
  assert.deepEqual(fever, { meter: 0, pulls: 0 });
});

test('experience rewards rarity, new finds, skill and streaks', () => {
  const base = xpFor({ rarity: 'common', isNew: false, quality: 'miss', combo: 0 });
  assert.equal(base, 10);
  assert.ok(xpFor({ rarity: 'legendary', isNew: false, quality: 'miss', combo: 0 }) > xpFor({ rarity: 'rare', isNew: false, quality: 'miss', combo: 0 }));
  assert.ok(xpFor({ rarity: 'common', isNew: true, quality: 'miss', combo: 0 }) > base);
  assert.ok(xpFor({ rarity: 'common', isNew: false, quality: 'perfect', combo: 0 }) > xpFor({ rarity: 'common', isNew: false, quality: 'good', combo: 0 }));
  assert.ok(xpFor({ rarity: 'common', isNew: false, quality: 'good', combo: 5 }) > xpFor({ rarity: 'common', isNew: false, quality: 'good', combo: 1 }));
});

test('levels follow the experience curve and have titles', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(xpToReach), [0, 100, 300, 600, 1000]);
  assert.deepEqual(levelFor(0), { level: 1, title: TITLES[0], into: 0, span: 100 });
  assert.equal(levelFor(99).level, 1);
  assert.equal(levelFor(100).level, 2);
  assert.equal(levelFor(650).level, 4);
  assert.equal(levelFor(650).into, 50);
  assert.equal(levelFor(10 ** 6).title, TITLES[TITLES.length - 1]);
});

test('each day has three different missions, the same for everyone', () => {
  const day = missionsFor('2026-11-12');
  assert.deepEqual(missionsFor('2026-11-12'), day);
  assert.equal(day.list.length, 3);
  assert.equal(new Set(day.list.map((entry) => entry.id)).size, 3);
  const days = new Set(Array.from({ length: 20 }, (_, i) => missionsFor(`2026-12-${String(i + 1).padStart(2, '0')}`).list.map((e) => e.id).join()));
  assert.ok(days.size > 10, 'missions vary from day to day');
  for (const mission of MISSIONS) assert.ok(mission.target > 0 && mission.reward > 0, mission.id);
});

test('missions count events and complete once', () => {
  const missions = { date: 'd', list: [{ id: 'pull5', progress: 0, done: false, seen: [] }, { id: 'cats3', progress: 0, done: false, seen: [] }, { id: 'combo4', progress: 0, done: false, seen: [] }] };
  let current = missions;
  const finished = [];
  for (let i = 0; i < 6; i += 1) {
    const outcome = track(current, { on: 'pull' });
    current = outcome.missions;
    finished.push(...outcome.completed.map((m) => m.id));
  }
  assert.deepEqual(finished, ['pull5']);
  assert.equal(current.list[0].progress, 5);
  for (const category of ['books', 'books', 'toys']) current = track(current, { on: 'category', value: category }).missions;
  assert.equal(current.list[1].progress, 2, 'only different categories count');
  const third = track(current, { on: 'category', value: 'home' });
  assert.deepEqual(third.completed.map((m) => m.id), ['cats3']);
  current = track(third.missions, { on: 'combo', value: 2 }).missions;
  current = track(current, { on: 'combo', value: 1 }).missions;
  assert.equal(current.list[2].progress, 2, 'a combo mission keeps the best');
  assert.equal(missions.list[0].progress, 0, 'the original is not changed');
  assert.equal(missionById('nope'), undefined);
});

test('a pull produces the right mission events', () => {
  const events = pullEvents({ quality: 'perfect', rarity: 'legendary', isNew: true, combo: 3, feverStarted: true, category: 'toys' }).map((e) => e.on);
  assert.deepEqual(events, ['pull', 'perfect', 'skill', 'rare', 'legendary', 'new', 'combo', 'fever', 'category']);
  const quiet = pullEvents({ quality: 'miss', rarity: 'common', isNew: false, combo: 0, feverStarted: false, category: 'toys' }).map((e) => e.on);
  assert.deepEqual(quiet, ['pull', 'combo', 'category']);
});

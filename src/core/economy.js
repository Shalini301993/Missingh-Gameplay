// Tokens, daily refill and rarity odds. Pure functions that return new state.

export const DAILY_TOKENS = 10;
export const PULL_COST = 1;
export const BONUS_EVERY = 5; // one bonus token per this many new discoveries
export const RARITY_ODDS = { legendary: 0.05, rare: 0.2 }; // the rest is common

export function newEconomy(today) {
  return { tokens: DAILY_TOKENS, lastRefill: today, halves: 0, discoveries: 0 };
}

export function todayString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Tops tokens up to the daily amount once per calendar day. Never takes tokens away.
export function refill(economy, today) {
  if (economy.lastRefill === today) return economy;
  return { ...economy, tokens: Math.max(economy.tokens, DAILY_TOKENS), lastRefill: today };
}

export const canPull = (economy) => economy.tokens >= PULL_COST;

export function spend(economy) {
  if (!canPull(economy)) throw new Error('Not enough tokens');
  return { ...economy, tokens: economy.tokens - PULL_COST };
}

// Applies the outcome of a pull. Returns the new state and what was awarded.
export function settle(economy, { duplicate }) {
  const next = { ...economy };
  let bonus = 0;
  if (duplicate) {
    next.halves += 1;
    if (next.halves >= 2) { next.halves = 0; bonus = 1; }
  } else {
    next.discoveries += 1;
    if (next.discoveries % BONUS_EVERY === 0) bonus = 1;
  }
  next.tokens += bonus;
  return { economy: next, bonus };
}

// odds: { legendary, rare } as chances from 0 to 1; the rest is common.
export function rollRarity(rng = Math.random, odds = RARITY_ODDS) {
  const roll = rng();
  if (roll < odds.legendary) return 'legendary';
  if (roll < odds.legendary + odds.rare) return 'rare';
  return 'common';
}

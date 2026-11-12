// Picks a fitting line from literature for an object. Pure functions.
//
// Every quote in data/quotes.json was checked word for word against its source text (Project
// Gutenberg or Wikisource). A quote fits an object when it shares the object's category, mentions
// what the object is ("glove", "teapot", "boat") or shares its vibes and moods. Among the best fits
// the choice is fixed by the object's id, so an object always shows the same quote.

const patterns = new Map();
const wordPattern = (word) => {
  if (!patterns.has(word)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]+');
    patterns.set(word, new RegExp(`(^|[^a-z])${escaped}(e?s)?($|[^a-z])`, 'i'));
  }
  return patterns.get(word);
};

const overlap = (a = [], b = []) => a.filter((value) => b.includes(value)).length;
const plain = (text) => String(text).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

// A book quoted from itself: Pride and Prejudice gets a line from Pride and Prejudice.
export const quotesItself = (item, quote) => item.category === 'books' && plain(item.title) === plain(quote.work);

export function hashString(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function quoteScore(item, quote) {
  const title = item.title || '';
  const about = `${item.about ?? ''} ${item.blurb ?? ''}`;
  let mention = 0;
  for (const word of quote.words) {
    if (wordPattern(word).test(title)) { mention = 6; break; }
    if (mention < 2 && wordPattern(word).test(about)) mention = 2;
  }
  const sameCategory = quote.cats.includes(item.category);
  if (!sameCategory && mention < 6) return 0; // off-topic unless it names the object itself
  return (sameCategory ? 3 : 0) + mention + 0.75 * overlap(quote.vibes, item.vibes) + 0.5 * overlap(quote.moods, item.moods);
}

// The quote for an item, or null when there are no quotes at all.
export function quoteFor(item, quotes) {
  if (!quotes?.length) return null;
  const own = quotes.filter((quote) => quotesItself(item, quote));
  if (own.length) return own[hashString(item.id) % own.length];
  const scored = quotes.map((quote) => ({ quote, score: quoteScore(item, quote) })).filter((entry) => entry.score > 0);
  const pool = scored.length ? scored : quotes.map((quote) => ({ quote, score: 1 }));
  const best = Math.max(...pool.map((entry) => entry.score));
  // Near-best quotes all qualify, so similar objects do not all get the same line.
  const shortlist = pool.filter((entry) => entry.score >= best - 1.5).map((entry) => entry.quote);
  return shortlist[hashString(item.id) % shortlist.length];
}

// Verse is stored with " / " between lines.
export const quoteLines = (quote) => quote.text.split(' / ');

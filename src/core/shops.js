// Where to buy: links that open a search for an object on shops that sell its kind of thing.
// Pure functions.
//
// Every link format here was checked to open that shop's search results (November 2026). Amazon's
// regional sites, AbeBooks, Open Library, Sephora, Thomann, IKEA, Nordstrom, Flipkart and Target
// answered directly. eBay, Etsy and Bookshop.org turn away automated checks, so their formats were
// confirmed from their documentation and from their own redirects instead.

// Optional: an Amazon Associates tracking ID, added to every Amazon link when set.
export const AMAZON_TAG = '';

export const REGIONS = [
  { id: 'US', label: 'United States', amazon: 'amazon.com', ebay: 'ebay.com', ikea: 'us/en', abebooks: 'abebooks.com', bookshop: 'bookshop.org' },
  { id: 'GB', label: 'United Kingdom', amazon: 'amazon.co.uk', ebay: 'ebay.co.uk', ikea: 'gb/en', abebooks: 'abebooks.co.uk', bookshop: 'uk.bookshop.org' },
  { id: 'IN', label: 'India', amazon: 'amazon.in', ikea: 'in/en' },
  { id: 'CA', label: 'Canada', amazon: 'amazon.ca', ebay: 'ebay.ca', ikea: 'ca/en' },
  { id: 'AU', label: 'Australia', amazon: 'amazon.com.au', ebay: 'ebay.com.au', ikea: 'au/en' },
  { id: 'DE', label: 'Germany', amazon: 'amazon.de', ebay: 'ebay.de', ikea: 'de/de', abebooks: 'abebooks.de' },
  { id: 'FR', label: 'France', amazon: 'amazon.fr', ebay: 'ebay.fr', ikea: 'fr/fr' },
  { id: 'IT', label: 'Italy', amazon: 'amazon.it', ebay: 'ebay.it', ikea: 'it/it' },
  { id: 'ES', label: 'Spain', amazon: 'amazon.es', ebay: 'ebay.es', ikea: 'es/es' },
  { id: 'NL', label: 'Netherlands', amazon: 'amazon.nl', ikea: 'nl/nl' },
  { id: 'JP', label: 'Japan', amazon: 'amazon.co.jp', ikea: 'jp/ja' },
  { id: 'AE', label: 'United Arab Emirates', amazon: 'amazon.ae', ikea: 'ae/en' },
  { id: 'SG', label: 'Singapore', amazon: 'amazon.sg', ikea: 'sg/en' },
  { id: 'MX', label: 'Mexico', amazon: 'amazon.com.mx', ikea: 'mx/es' },
  { id: 'BR', label: 'Brazil', amazon: 'amazon.com.br' },
];

const LANGUAGE_REGION = { de: 'DE', fr: 'FR', it: 'IT', es: 'ES', nl: 'NL', ja: 'JP', hi: 'IN', bn: 'IN', ta: 'IN', te: 'IN', mr: 'IN', pt: 'BR', ar: 'AE' };

export const regionById = (id) => REGIONS.find((region) => region.id === id) ?? REGIONS[0];

// Guesses the shopping region from the browser's languages, such as "en-IN" → India.
export function detectRegion(languages = []) {
  for (const tag of languages) {
    const country = String(tag).split('-')[1]?.toUpperCase();
    if (REGIONS.some((region) => region.id === country)) return country;
  }
  for (const tag of languages) {
    const language = String(tag).split('-')[0].toLowerCase();
    if (LANGUAGE_REGION[language]) return LANGUAGE_REGION[language];
  }
  return 'US';
}

// Words that already say what kind of thing it is, so nothing needs adding to the search.
const KIND_WORDS = {
  shoes: /shoe|boot|sandal|sneaker|slipper|heel|clog|loafer|trainer|moccasin|espadrille|flip-flop|mule|pump/i,
  perfumes: /perfume|parfum|fragrance|cologne|eau de|oil|incense|attar|water/i,
  bags: /bag|purse|pack|case|trunk|luggage|wallet|satchel|tote|pouch|basket|holdall|briefcase/i,
  watches: /watch|clock|chronograph|chronometer|timer|sundial|hourglass/i,
};
const KIND_NOUN = { shoes: 'shoes', perfumes: 'perfume', bags: 'bag', watches: 'watch' };

// The maker or author named in a short description: "1965 novel by Frank Herbert" → "Frank Herbert".
export function makerOf(about = '') {
  const match = about.match(/\bby (?:the )?([A-Z][^,;()]*?)(?:\s+(?:in|from|for|since)\s+\d{4})?\s*$/);
  return match ? match[1].trim() : '';
}

const wordsOf = (text) => new Set(String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []);

// What to type into a shop's search box for an object.
export function searchQuery(item) {
  const title = item.title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const parts = [title];
  if (item.category === 'books' || item.category === 'perfumes') {
    const maker = makerOf(item.about);
    const titleWords = wordsOf(title);
    if (maker && ![...wordsOf(maker)].some((word) => titleWords.has(word))) parts.push(maker);
  }
  const kind = KIND_WORDS[item.category];
  if (kind && !kind.test(title)) parts.push(KIND_NOUN[item.category]);
  return parts.join(' ');
}

const encode = (query) => encodeURIComponent(query).replace(/%20/g, '+');

const SHOP = {
  amazon: (region, q) => ({ id: 'amazon', label: `Amazon (${region.amazon})`, note: 'new',
    url: `https://www.${region.amazon}/s?k=${encode(q)}${AMAZON_TAG ? `&tag=${encodeURIComponent(AMAZON_TAG)}` : ''}` }),
  ebay: (region, q, note = 'new and pre-owned') => ({ id: 'ebay', label: 'eBay', note,
    url: `https://www.${region.ebay ?? 'ebay.com'}/sch/i.html?_nkw=${encode(q)}` }),
  etsy: (region, q) => ({ id: 'etsy', label: 'Etsy', note: 'vintage and handmade', url: `https://www.etsy.com/search?q=${encode(q)}` }),
  abebooks: (region, q) => ({ id: 'abebooks', label: 'AbeBooks', note: 'new, used and rare',
    url: `https://www.${region.abebooks ?? 'abebooks.com'}/servlet/SearchResults?kn=${encode(q)}` }),
  bookshop: (region, q) => ({ id: 'bookshop', label: 'Bookshop.org', note: 'supports local bookshops',
    url: `https://${region.bookshop}/search?keywords=${encode(q)}` }),
  openlibrary: (region, q) => ({ id: 'openlibrary', label: 'Open Library', note: 'borrow free', url: `https://openlibrary.org/search?q=${encode(q)}` }),
  sephora: (region, q) => ({ id: 'sephora', label: 'Sephora', note: 'fragrance', url: `https://www.sephora.com/search?keyword=${encode(q)}` }),
  nordstrom: (region, q) => ({ id: 'nordstrom', label: 'Nordstrom', note: 'fashion', url: `https://www.nordstrom.com/sr?keyword=${encode(q)}` }),
  target: (region, q) => ({ id: 'target', label: 'Target', note: '', url: `https://www.target.com/s?searchTerm=${encode(q)}` }),
  flipkart: (region, q) => ({ id: 'flipkart', label: 'Flipkart', note: '', url: `https://www.flipkart.com/search?q=${encode(q)}` }),
  ikea: (region, q) => ({ id: 'ikea', label: 'IKEA', note: 'home', url: `https://www.ikea.com/${region.ikea}/search/?q=${encode(q)}` }),
  thomann: (region, q) => ({ id: 'thomann', label: 'Thomann', note: 'music shop, ships worldwide', url: `https://www.thomann.de/intl/search_dir.html?sw=${encode(q)}` }),
};

// Which shops suit each category, in order of usefulness. Regional shops are skipped elsewhere.
const PLAN = {
  clothing: ['nordstrom', 'flipkart', 'etsy', 'ebay'],
  shoes: ['nordstrom', 'flipkart', 'ebay', 'etsy'],
  perfumes: ['sephora', 'nordstrom', 'flipkart', 'ebay'],
  books: ['bookshop', 'abebooks', 'flipkart', 'openlibrary'],
  bags: ['nordstrom', 'flipkart', 'etsy', 'ebay'],
  accessories: ['nordstrom', 'flipkart', 'etsy', 'ebay'],
  watches: ['ebay', 'etsy', 'flipkart'],
  toys: ['target', 'flipkart', 'etsy', 'ebay'],
  vehicles: ['ebay', 'etsy'],
  gadgets: ['target', 'flipkart', 'ebay'],
  home: ['ikea', 'target', 'flipkart', 'etsy'],
  instruments: ['thomann', 'flipkart', 'ebay'],
};

const AVAILABLE = {
  nordstrom: (region) => region.id === 'US',
  sephora: (region) => region.id === 'US',
  target: (region) => region.id === 'US',
  flipkart: (region) => region.id === 'IN',
  bookshop: (region) => Boolean(region.bookshop),
  ikea: (region) => Boolean(region.ikea),
  // eBay does not trade in every country; elsewhere eBay.com still ships to many.
  ebay: () => true,
};

// Amazon first, then the shops that suit the object, for the player's region. A small maker's
// card goes straight to the maker's own shop instead.
export function shopLinks(item, regionId = 'US') {
  if (item.kind === 'maker' && item.site) {
    return [{ id: 'maker', label: item.maker ?? item.title, note: "the maker's own shop", url: item.site }];
  }
  const region = regionById(regionId);
  const q = searchQuery(item);
  const links = [SHOP.amazon(region, q)];
  for (const id of PLAN[item.category] ?? ['ebay', 'etsy']) {
    if (AVAILABLE[id] && !AVAILABLE[id](region)) continue;
    const note = id === 'ebay' && ['watches', 'gadgets', 'vehicles'].includes(item.category)
      ? { watches: 'pre-owned watches', gadgets: 'refurbished and retro', vehicles: 'including eBay Motors' }[item.category] : undefined;
    links.push(SHOP[id](region, q, note));
  }
  return links.slice(0, 5);
}

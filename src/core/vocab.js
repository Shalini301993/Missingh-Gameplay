// The fixed vocabulary shared by the game and the catalog generator.

export const CATEGORIES = [
  { id: 'clothing', label: 'Clothing' },
  { id: 'shoes', label: 'Shoes' },
  { id: 'perfumes', label: 'Perfumes' },
  { id: 'books', label: 'Books' },
  { id: 'bags', label: 'Bags' },
  { id: 'accessories', label: 'Jewellery & Accessories' },
  { id: 'watches', label: 'Watches' },
  { id: 'toys', label: 'Toys & Games' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'gadgets', label: 'Gadgets' },
  { id: 'home', label: 'Home & Design' },
  { id: 'instruments', label: 'Musical Instruments' },
];

export const VIBES = [
  'cosy', 'minimalist', 'retro', 'futuristic', 'luxe',
  'sporty', 'whimsical', 'rugged', 'romantic', 'bookish',
];

export const MOODS = ['calm', 'adventurous', 'romantic', 'playful', 'nostalgic', 'bold'];

export const COLOURS = [
  { id: 'neutrals', label: 'Neutrals', hex: '#d8cfc0' },
  { id: 'black', label: 'Black', hex: '#1c1b19' },
  { id: 'red', label: 'Red', hex: '#c8452c' },
  { id: 'pink', label: 'Pink', hex: '#e3a5b4' },
  { id: 'blue', label: 'Blue', hex: '#2f5d9b' },
  { id: 'green', label: 'Green', hex: '#4f7a5a' },
  { id: 'gold', label: 'Gold', hex: '#c39a3b' },
  { id: 'multicolour', label: 'Multicolour', hex: 'conic-gradient(#c8452c,#c39a3b,#4f7a5a,#2f5d9b,#e3a5b4,#c8452c)' },
];

export const BUDGETS = [
  { id: 'everyday', label: 'Everyday' },
  { id: 'treat', label: 'Treat' },
  { id: 'splurge', label: 'Splurge' },
  { id: 'dream', label: 'Dream' },
];

export const RARITIES = [
  { id: 'common', label: 'Common', hex: '#6f6a62' },
  { id: 'rare', label: 'Rare', hex: '#2f5d9b' },
  { id: 'legendary', label: 'Legendary', hex: '#c39a3b' },
];

export const KINDS = ['iconic', 'generic', 'artifact', 'maker'];
export const KIND_LABELS = {
  iconic: 'Brand or named object', generic: 'Rare kind of object', artifact: 'Traditional craft', maker: 'Small maker',
};
export const ORIGINS = { IN: 'India', US: 'USA' };

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const COLOUR_IDS = COLOURS.map((c) => c.id);
export const BUDGET_IDS = BUDGETS.map((b) => b.id);
export const RARITY_IDS = RARITIES.map((r) => r.id);

export const categoryById = (id) => CATEGORIES.find((c) => c.id === id);
export const rarityById = (id) => RARITIES.find((r) => r.id === id);

export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Returns a list of problems with a catalog item; empty when the item is valid.
export function itemProblems(item) {
  const problems = [];
  const subset = (list, allowed) => Array.isArray(list) && list.every((v) => allowed.includes(v));
  if (!item || typeof item !== 'object') return ['not an object'];
  if (typeof item.id !== 'string' || !/^[a-z]+\/[a-z0-9-]+$/.test(item.id)) problems.push('bad id');
  if (typeof item.title !== 'string' || !item.title.trim()) problems.push('missing title');
  if (!CATEGORY_IDS.includes(item.category)) problems.push(`unknown category ${item.category}`);
  if (typeof item.id === 'string' && !item.id.startsWith(`${item.category}/`)) problems.push('id does not match category');
  if (!KINDS.includes(item.kind)) problems.push(`unknown kind ${item.kind}`);
  if (typeof item.blurb !== 'string' || !item.blurb.trim()) problems.push('missing blurb');
  if (item.about != null && typeof item.about !== 'string') problems.push('bad about');
  if (!subset(item.vibes, VIBES)) problems.push('bad vibes');
  if (!subset(item.moods, MOODS)) problems.push('bad moods');
  if (!subset(item.colours, COLOUR_IDS)) problems.push('bad colours');
  if (!BUDGET_IDS.includes(item.budget)) problems.push(`unknown budget ${item.budget}`);
  if (!RARITY_IDS.includes(item.rarity)) problems.push(`unknown rarity ${item.rarity}`);
  if (item.wiki != null && (typeof item.wiki !== 'string' || /\s/.test(item.wiki))) problems.push('bad wiki title');
  if (item.image != null && !/^https:\/\//.test(item.image)) problems.push('image must be https');
  if (item.kind === 'maker' && !/^https:\/\/[^\s]+$/.test(item.site ?? '')) problems.push('a maker needs a shop website');
  if (item.origin != null && !/^[A-Z]{2}$/.test(item.origin)) problems.push('bad origin');
  return problems;
}

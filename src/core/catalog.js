// Loads the built catalog and, when an item has no baked image, asks Wikipedia for one.

const BASE = new URL('../../data/catalog/', import.meta.url);

export async function loadCatalog() {
  const manifest = await fetchJson(new URL('index.json', BASE));
  const files = await Promise.all(
    manifest.categories.map((c) => fetchJson(new URL(c.file, BASE)).catch(() => [])),
  );
  return { manifest, items: files.flat() };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

const summaries = new Map();

// Fills in a missing image from Wikipedia's page summary. Resolves to the item either way.
export async function enrich(item) {
  if (item.image || !item.wiki) return item;
  if (!summaries.has(item.wiki)) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(item.wiki)}`;
    summaries.set(item.wiki, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  }
  const summary = await summaries.get(item.wiki);
  const image = summary?.thumbnail?.source;
  return image ? { ...item, image } : item;
}

export const wikiUrl = (item) => (item.wiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(item.wiki)}` : null);
export const webSearchUrl = (item) => `https://duckduckgo.com/?q=${encodeURIComponent(item.title)}`;
export const shopSearchUrl = (item) => `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(item.title)}`;

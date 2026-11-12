// Loads the built catalog and, for a seeds-only catalog, asks Wikipedia for missing pictures.

const BASE = new URL('../../data/catalog/', import.meta.url);

let lookUpPictures = true;

export async function loadCatalog() {
  const manifest = await fetchJson(new URL('index.json', BASE));
  // A catalog built with Wikipedia already holds every picture it could find, so only a
  // seeds-only catalog looks pictures up while playing.
  lookUpPictures = manifest.source === 'seeds';
  const [files, quotes] = await Promise.all([
    Promise.all(manifest.categories.map((c) => fetchJson(new URL(c.file, BASE)).catch(() => []))),
    fetchJson(new URL('../quotes.json', BASE)).catch(() => []),
  ]);
  return { manifest, items: files.flat(), quotes };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

const summaries = new Map();

// Fills in a missing image from Wikipedia's page summary. Resolves to the item either way.
export async function enrich(item) {
  if (!lookUpPictures || item.image || !item.wiki) return item;
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

// Builds data/catalog/ from the hand-written seeds plus Wikipedia.
//
//   node scripts/catalog/build.mjs            seeds + Wikipedia (needs network; runs in GitHub Actions)
//   node scripts/catalog/build.mjs --offline  seeds only
//
// No dependencies; needs Node 20+.

import { readFile, writeFile, mkdir, readdir, rm, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CATEGORIES, VIBES, MOODS, BUDGET_IDS, slugify, itemProblems,
} from '../../src/core/vocab.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = process.env.CATALOG_USER_AGENT
  || 'CurioCapsuleCatalog/1.0 (static game catalog builder; Node fetch)';

// ---------------------------------------------------------------- Wikipedia API

export function createApi({ fetchImpl = fetch, delayMs = 120, log = () => {} } = {}) {
  let requests = 0;
  async function call(params) {
    const url = new URL(API);
    const full = { action: 'query', format: 'json', formatversion: '2', maxlag: '5', ...params };
    for (const [key, value] of Object.entries(full)) url.searchParams.set(key, String(value));
    for (let attempt = 0; ; attempt += 1) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      requests += 1;
      let response;
      try {
        response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT } });
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      if (response.ok) {
        const data = await response.json();
        if (data.error?.code === 'maxlag' && attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        if (data.error) throw new Error(`API error ${data.error.code}: ${data.error.info}`);
        return data;
      }
      if (attempt >= 4 || ![429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(`HTTP ${response.status} from Wikipedia`);
      }
      log(`  retrying after HTTP ${response.status}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }

  // Follows API continuation, merging the pieces of each page, until `limit` pages are complete.
  async function pages(params, { limit = Infinity, generatorKeys = [] } = {}) {
    const byId = new Map();
    let cont = {};
    for (;;) {
      const data = await call({ ...params, ...cont });
      for (const page of data.query?.pages ?? []) {
        const key = page.pageid ?? `missing:${page.title}`;
        const known = byId.get(key);
        if (!known) { byId.set(key, page); continue; }
        const pageviews = { ...known.pageviews, ...page.pageviews };
        Object.assign(known, page);
        if (Object.keys(pageviews).length) known.pageviews = pageviews;
      }
      if (!data.continue) break;
      cont = data.continue;
      const propsPending = Object.keys(cont).some((k) => k !== 'continue' && !generatorKeys.includes(k));
      if (!propsPending && byId.size >= limit) break;
    }
    return { pages: [...byId.values()], redirects: [], data: null };
  }

  async function subcategories(category, depth, cap = 60) {
    const seen = new Set([category]);
    let frontier = [category];
    for (let level = 0; level < depth && frontier.length; level += 1) {
      const next = [];
      for (const parent of frontier) {
        let cont = {};
        do {
          const data = await call({
            list: 'categorymembers', cmtitle: `Category:${parent}`, cmtype: 'subcat', cmlimit: '500', ...cont,
          });
          for (const member of data.query?.categorymembers ?? []) {
            const name = member.title.replace(/^Category:/, '');
            if (seen.size < cap && !seen.has(name)) { seen.add(name); next.push(name); }
          }
          cont = data.continue;
        } while (cont && seen.size < cap);
      }
      frontier = next;
    }
    return [...seen];
  }

  return { call, pages, subcategories, get requests() { return requests; } };
}

const MEMBER_PROPS = {
  prop: 'pageimages|description|pageprops|pageviews',
  piprop: 'thumbnail', pithumbsize: '640', pilimit: 'max',
  ppprop: 'disambiguation', pvipdays: '30',
};

async function fetchSource(api, source) {
  const limit = source.limit ?? 300;
  if (source.search) {
    const { pages } = await api.pages({
      generator: 'search', gsrsearch: source.search, gsrnamespace: '0', gsrlimit: '50', ...MEMBER_PROPS,
    }, { limit, generatorKeys: ['gsroffset'] });
    return pages;
  }
  const categories = await api.subcategories(source.cat, source.depth ?? 0);
  const all = new Map();
  for (const category of categories) {
    if (all.size >= limit) break;
    const { pages } = await api.pages({
      generator: 'categorymembers', gcmtitle: `Category:${category}`, gcmtype: 'page', gcmnamespace: '0',
      gcmlimit: '50', ...MEMBER_PROPS,
    }, { limit: limit - all.size, generatorKeys: ['gcmcontinue'] });
    for (const page of pages) if (page.pageid) all.set(page.pageid, page);
  }
  return [...all.values()];
}

// ---------------------------------------------------------------- filtering and tagging

const NOT_AN_OBJECT_TITLE = /^(List|Lists|Timeline|History|Outline|Index|Glossary|Comparison) of\b/i;
const UNSUITABLE = /\b(weapons?|firearms?|rifles?|pistols?|guns?|swords?|daggers?|tobacco|cigarettes?|cigars?|vap(e|ing)|lingerie|fetish|erotic|sex|condoms?|missiles?|bombs?|warfare|military|army|nazi|narcotics?|cannabis|alcoholic|gambling)\b/i;
const PERSON = /^(an? )?([\w-]+ ){0,3}(designer|perfumer|businessman|businesswoman|businessperson|entrepreneur|author|writer|novelist|poet|actor|actress|singer|musician|engineer|inventor|artist|model|politician|luthier|watchmaker|shoemaker|architect)\b(?!.*\bby\b)/i;
const ORGANISATION = /\b(company|companies|manufacturer|corporation|retailer|conglomerate|subsidiary|fashion house|publisher|publishing house|organi[sz]ation|association|museum|chain of|department store|record label|studio)\b/i;
const NOT_A_THING = /\b(film|television|tv series|album|song|single by|episode|magazine|website|festival|award|trade fair|exhibition|subculture|genre|industry|disambiguation|wikimedia|political|law|act of)\b/i;

export function rejectReason(page, { allowOrganisations = false, require, drop } = {}) {
  const description = page.description || '';
  const text = `${page.title} ${description}`;
  if (page.missing || page.invalid) return 'missing';
  if (page.pageprops && 'disambiguation' in page.pageprops) return 'disambiguation';
  if (NOT_AN_OBJECT_TITLE.test(page.title)) return 'list-page';
  if (!page.thumbnail?.source) return 'no-image';
  if (!description) return 'no-description';
  if (UNSUITABLE.test(text)) return 'unsuitable';
  if (PERSON.test(description) || /\((born )?\d{4}([–-]\d{4})?\)/.test(description)) return 'person';
  if (!allowOrganisations && ORGANISATION.test(description)) return 'organisation';
  if (NOT_A_THING.test(description)) return 'not-a-thing';
  if (drop && new RegExp(drop, 'i').test(text)) return 'source-drop';
  if (require && !new RegExp(require, 'i').test(text)) return 'source-require';
  return null;
}

const VIBE_RULES = {
  luxe: /luxur|haute|couture|diamond|premium|high-end|prestig|jewel|gold/i,
  retro: /vintage|classic|antique|tradition|histor|\b1[89]\d\d\b|victorian|art deco/i,
  futuristic: /electric|digital|smart|electronic|futur|space|robot|virtual|wireless/i,
  sporty: /sport|athlet|racing|running|basketball|tennis|football|skate|cycling|fitness/i,
  cosy: /wool|knit|warm|soft|blanket|tea\b|comfort|plush|quilt/i,
  minimalist: /simple|minimal|plain|modernis|bauhaus|compact/i,
  whimsical: /toy|novelty|cartoon|children|doll|puzzle|magic|fairy/i,
  rugged: /outdoor|work ?wear|durable|leather|off-road|hiking|utility|denim|pickup/i,
  romantic: /floral|rose|romanc|love|lace|silk|evening|wedding|bridal/i,
  bookish: /novel|literar|book|writing|librar|academic|poem|fountain pen/i,
};
const MOOD_RULES = {
  nostalgic: /vintage|classic|antique|tradition|\b1[89]\d\d\b|discontinued|childhood/i,
  adventurous: /travel|outdoor|off-road|expedition|adventure|explor|mountain|dive|diving|sail|rally/i,
  playful: /toy|game|fun|children|colou?rful|cartoon|novelty/i,
  romantic: /floral|rose|romanc|love|lace|silk|evening|wedding/i,
  calm: /\btea\b|home|soft|garden|quiet|meditat|sleep|relax/i,
  bold: /racing|fast|power|luxur|punk|rock|supercar|statement|high-performance/i,
};
const COLOUR_RULES = {
  red: /\bred\b|scarlet|crimson/i, pink: /\bpink\b/i, blue: /\bblue\b|navy|denim/i, green: /\bgreen\b/i,
  gold: /\bgold(en)?\b|brass/i, black: /\bblack\b/i, neutrals: /\bwhite\b|beige|cream|ivory|khaki|grey|gray/i,
  multicolour: /colou?rful|rainbow|multi-?colou?r/i,
};

const matching = (rules, text) => Object.keys(rules).filter((key) => rules[key].test(text));
const unique = (list) => [...new Set(list)];

export function tagItem(text, defaults = {}) {
  const vibes = unique([...matching(VIBE_RULES, text), ...(defaults.vibes ?? [])]).filter((v) => VIBES.includes(v)).slice(0, 3);
  const moods = unique([...matching(MOOD_RULES, text), ...(defaults.moods ?? [])]).filter((m) => MOODS.includes(m)).slice(0, 2);
  const colours = unique([...matching(COLOUR_RULES, text), ...(defaults.colours ?? [])]).slice(0, 3);
  let budget = BUDGET_IDS.indexOf(defaults.budget ?? 'treat');
  if (/luxur|haute|diamond|supercar|limited edition/i.test(text)) budget = Math.min(budget + 1, BUDGET_IDS.length - 1);
  return { vibes, moods, colours, budget: BUDGET_IDS[budget] };
}

export const displayTitle = (title) => title.replace(/\s+\([^)]*\)$/, '');
export const wikiTitle = (title) => title.replace(/ /g, '_');
const viewCount = (page) => Object.values(page.pageviews ?? {}).reduce((sum, n) => sum + (n || 0), 0);

export function tidyBlurb(extract, fallback) {
  let text = (extract || '').replace(/\s+/g, ' ').replace(/\s\([^)]*\)/g, '').trim();
  if (text.length < 40) text = fallback || text;
  if (text.length > 300) {
    const cut = text.slice(0, 300);
    const stop = cut.lastIndexOf('. ');
    text = stop > 120 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  }
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

// Top 5% by page views are legendary, the next 20% rare, the rest common.
export function assignRarity(items) {
  const ranked = [...items].sort((a, b) => b.views - a.views);
  ranked.forEach((item, index) => {
    const share = index / ranked.length;
    item.rarity = share < 0.05 ? 'legendary' : share < 0.25 ? 'rare' : 'common';
  });
}

// ---------------------------------------------------------------- seeds

export async function loadSeeds() {
  const seeds = [];
  for (const category of CATEGORIES) {
    const file = path.join(ROOT, 'data/seeds', `${category.id}.json`);
    let entries = [];
    try { entries = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`${file}: ${error.message}`);
    }
    for (const entry of entries) {
      seeds.push({
        id: `${category.id}/${slugify(entry.title)}`, title: entry.title, kind: entry.kind, category: category.id,
        blurb: entry.blurb, wiki: entry.wiki ?? null, image: entry.image ?? null,
        vibes: entry.vibes ?? [], moods: entry.moods ?? [], colours: entry.colours ?? [],
        budget: entry.budget, rarity: entry.rarity, source: 'seed',
      });
    }
  }
  return seeds;
}

async function enrichSeeds(api, seeds, log) {
  const wanted = seeds.filter((seed) => seed.wiki && !seed.image);
  let filled = 0;
  for (let i = 0; i < wanted.length; i += 20) {
    const batch = wanted.slice(i, i + 20);
    const data = await api.call({
      titles: batch.map((seed) => seed.wiki.replace(/_/g, ' ')).join('|'), redirects: '1',
      prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '640', pilimit: 'max',
    });
    const hop = new Map();
    for (const step of [...(data.query?.normalized ?? []), ...(data.query?.redirects ?? [])]) hop.set(step.from, step.to);
    const byTitle = new Map((data.query?.pages ?? []).map((page) => [page.title, page]));
    for (const seed of batch) {
      let title = seed.wiki.replace(/_/g, ' ');
      for (let hops = 0; hop.has(title) && hops < 4; hops += 1) title = hop.get(title);
      const page = byTitle.get(title);
      if (!page || page.missing) { log(`  seed has no Wikipedia page: ${seed.title} (${seed.wiki})`); continue; }
      if (page.thumbnail?.source) { seed.image = page.thumbnail.source; filled += 1; }
    }
  }
  log(`Seeds: ${filled} of ${wanted.length} images filled from Wikipedia`);
}

// ---------------------------------------------------------------- build

export async function build({ offline = false, api = null, log = console.log } = {}) {
  const config = JSON.parse(await readFile(path.join(ROOT, 'scripts/catalog/sources.json'), 'utf8'));
  const seeds = await loadSeeds();
  const report = [];
  const byCategory = new Map(CATEGORIES.map((c) => [c.id, []]));
  const taken = new Set(seeds.filter((s) => s.wiki).map((s) => s.wiki.toLowerCase()));
  let failures = 0;
  let attempts = 0;

  if (!offline) {
    api ??= createApi({ log });
    await enrichSeeds(api, seeds, log);
    for (const category of CATEGORIES) {
      const settings = config.categories[category.id] ?? { sources: [] };
      const candidates = [];
      for (const source of settings.sources) {
        const name = source.search ? `search: ${source.search}` : `category: ${source.cat}`;
        const row = { category: category.id, source: name, fetched: 0, kept: 0, rejected: {} };
        report.push(row);
        attempts += 1;
        let pages;
        try { pages = await fetchSource(api, source); } catch (error) {
          failures += 1; row.error = error.message; log(`  FAILED ${name}: ${error.message}`); continue;
        }
        row.fetched = pages.length;
        for (const page of pages) {
          const wiki = wikiTitle(page.title);
          const reason = taken.has(wiki.toLowerCase()) ? 'duplicate' : rejectReason(page, {
            allowOrganisations: source.allowOrganisations ?? settings.allowOrganisations,
            require: source.require ?? settings.require, drop: source.drop ?? settings.drop,
          });
          if (reason) { row.rejected[reason] = (row.rejected[reason] ?? 0) + 1; continue; }
          taken.add(wiki.toLowerCase());
          row.kept += 1;
          candidates.push({
            page, wiki, views: viewCount(page), kind: source.kind ?? settings.kind ?? 'iconic',
            defaults: { ...settings.defaults, ...source.defaults },
          });
        }
        log(`${category.id.padEnd(12)} ${String(row.kept).padStart(4)} kept of ${String(row.fetched).padStart(4)}  ${name}`);
      }
      const seedCount = seeds.filter((s) => s.category === category.id).length;
      const cap = Math.max(0, (config.perCategoryCap ?? 140) - seedCount);
      candidates.sort((a, b) => b.views - a.views);
      byCategory.set(category.id, candidates.slice(0, cap));
    }
    if (attempts && failures === attempts) throw new Error('Every Wikipedia source failed; catalog left unchanged.');

    // Intro text only for the pages that made the cut.
    const chosen = [...byCategory.values()].flat();
    for (let i = 0; i < chosen.length; i += 20) {
      const batch = chosen.slice(i, i + 20);
      const data = await api.call({
        pageids: batch.map((c) => c.page.pageid).join('|'), prop: 'extracts',
        exintro: '1', explaintext: '1', exsentences: '2', exlimit: 'max',
      });
      const extracts = new Map((data.query?.pages ?? []).map((page) => [page.pageid, page.extract]));
      for (const candidate of batch) candidate.extract = extracts.get(candidate.page.pageid);
    }
  }

  const catalog = new Map();
  for (const category of CATEGORIES) {
    const generated = byCategory.get(category.id).map((candidate) => {
      const { page } = candidate;
      const title = displayTitle(page.title);
      const blurb = tidyBlurb(candidate.extract, page.description);
      return {
        id: `${category.id}/${slugify(page.title)}`, title, kind: candidate.kind, category: category.id,
        blurb, wiki: candidate.wiki, image: page.thumbnail.source,
        ...tagItem(`${page.title} ${page.description} ${blurb}`, candidate.defaults),
        rarity: 'common', source: 'wikipedia', views: candidate.views,
      };
    });
    assignRarity(generated);
    const ids = new Set();
    const items = [...seeds.filter((s) => s.category === category.id), ...generated]
      .map(({ views, ...item }) => item)
      .filter((item) => item.id.split('/')[1] && !ids.has(item.id) && ids.add(item.id) && !itemProblems(item).length)
      .sort((a, b) => a.title.localeCompare(b.title, 'en'));
    catalog.set(category.id, items);
  }
  return { catalog, report, requests: api?.requests ?? 0 };
}

export async function writeCatalog(catalog, { offline }) {
  const dir = path.join(ROOT, 'data/catalog');
  await mkdir(dir, { recursive: true });
  for (const file of await readdir(dir)) if (file.endsWith('.json')) await rm(path.join(dir, file));
  const categories = [];
  for (const [id, items] of catalog) {
    await writeFile(path.join(dir, `${id}.json`), `[\n${items.map((item) => JSON.stringify(item)).join(',\n')}\n]\n`);
    categories.push({ id, file: `${id}.json`, count: items.length });
  }
  const total = categories.reduce((sum, c) => sum + c.count, 0);
  const manifest = {
    built: new Date().toISOString().slice(0, 10), source: offline ? 'seeds' : 'seeds+wikipedia', total, categories,
  };
  await writeFile(path.join(dir, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function reportMarkdown(manifest, report) {
  const lines = [`## Catalog build: ${manifest.total} items`, '', '| Category | Items |', '|---|---|'];
  for (const c of manifest.categories) lines.push(`| ${c.id} | ${c.count} |`);
  if (report.length) {
    lines.push('', '| Category | Source | Fetched | Kept | Rejected |', '|---|---|---|---|---|');
    for (const row of report) {
      const rejected = row.error ? `ERROR: ${row.error}` : Object.entries(row.rejected).map(([k, n]) => `${k} ${n}`).join(', ');
      lines.push(`| ${row.category} | ${row.source.replace(/\|/g, '/')} | ${row.fetched} | ${row.kept} | ${rejected} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const offline = process.argv.includes('--offline');
  try {
    const { catalog, report, requests } = await build({ offline });
    const manifest = await writeCatalog(catalog, { offline });
    const markdown = reportMarkdown(manifest, report);
    console.log(`\n${markdown}`);
    console.log(`Wrote ${manifest.total} items in ${manifest.categories.length} categories (${requests} API requests).`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  } catch (error) {
    console.error(`Catalog build failed: ${error.message}`);
    process.exit(1);
  }
}

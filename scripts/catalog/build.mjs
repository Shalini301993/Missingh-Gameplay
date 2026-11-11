// Builds data/catalog/ from the hand-written seeds plus Wikipedia.
//
//   node scripts/catalog/build.mjs                      seeds + Wikipedia (needs internet)
//   node scripts/catalog/build.mjs --offline            seeds only
//   node scripts/catalog/build.mjs --probe 'deepcat:"Hats"'   show what a search returns, write nothing
//   node scripts/catalog/build.mjs --refilter           re-apply the rules to the catalog on disk
//
// Wikipedia only lets an unidentified script make a few requests a minute. So every source is one
// search that returns pictures, descriptions and intro text together, the build waits whenever it is
// told to slow down, and it stops cleanly when its time budget runs out.
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
const USER_AGENT = process.env.CATALOG_USER_AGENT || 'CurioCapsuleCatalog/1.0 (static game catalog builder)';
const THUMB_WIDTH = 500;
const PAGE = 50; // the most pages Wikipedia returns pictures for in one request

// ---------------------------------------------------------------- Wikipedia API

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class OutOfTime extends Error {
  constructor() { super('out of time'); this.name = 'OutOfTime'; }
}

export function createApi({
  fetchImpl = fetch, log = () => {}, sleep = realSleep, now = Date.now, minIntervalMs = 250, deadline = Infinity,
} = {}) {
  const stats = { requests: 0, limited: 0, waitedMs: 0 };
  const warned = new Set();
  let lastRequestAt = -Infinity;
  let limitExplained = false;
  let ranking = 'popular_inclinks_pv'; // ask for results ordered mainly by page views

  async function call(params) {
    const url = new URL(API);
    const full = { action: 'query', format: 'json', formatversion: '2', ...params };
    for (const [key, value] of Object.entries(full)) url.searchParams.set(key, String(value));
    let failures = 0;
    let refusals = 0;
    for (;;) {
      const gap = lastRequestAt + minIntervalMs - now();
      if (gap > 0) await sleep(gap);
      if (now() >= deadline) throw new OutOfTime();
      lastRequestAt = now();
      stats.requests += 1;

      let response;
      try {
        response = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
      } catch (error) {
        failures += 1;
        if (failures > 3) throw error;
        await sleep(2000 * failures);
        continue;
      }

      if (response.status === 429) {
        stats.limited += 1;
        refusals += 1;
        const retryAfter = Number(response.headers?.get?.('retry-after')) || 0;
        if (!limitExplained) {
          limitExplained = true;
          const said = (await response.text().catch(() => ''))
            .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
          log(`Wikipedia is rate-limiting this build (HTTP 429, retry-after: ${retryAfter || 'not given'}).`);
          log(`  It says: ${said || '(no message)'}`);
          log('  The build waits for the next minute each time this happens.');
        }
        if (refusals > 10) throw new Error('Wikipedia kept refusing requests (HTTP 429)');
        // The limit resets on the minute, so wait for the next one unless told to wait longer.
        const wait = Math.max(retryAfter * 1000, 60000 - (now() % 60000)) + 1500;
        if (now() + wait >= deadline) throw new OutOfTime();
        stats.waitedMs += wait;
        await sleep(wait);
        continue;
      }

      if (!response.ok) {
        failures += 1;
        if (failures > 3 || response.status < 500) throw new Error(`HTTP ${response.status} from Wikipedia`);
        await sleep(2000 * failures);
        continue;
      }

      const data = await response.json();
      if (data.error) throw new Error(`${data.error.code}: ${data.error.info}`);
      for (const [module, entry] of Object.entries(data.warnings ?? {})) {
        const text = `${module}: ${entry?.warnings ?? JSON.stringify(entry)}`;
        if (!warned.has(text)) { warned.add(text); log(`  Wikipedia warning – ${text}`); }
      }
      return data;
    }
  }

  // Runs one search and returns up to `limit` pages, best match first, each with its properties.
  // If a later request fails, whatever already arrived is returned along with the error.
  async function search(query, { limit = 100, props = PAGE_PROPS } = {}) {
    const byId = new Map();
    let cont = {};
    let error = null;
    for (let round = 0; round < Math.ceil(limit / PAGE) + 5; round += 1) {
      let data;
      try {
        data = await call({
          generator: 'search', gsrsearch: query, gsrnamespace: '0', gsrlimit: String(Math.min(PAGE, limit)),
          ...(ranking ? { gsrqiprofile: ranking } : {}), ...props, ...cont,
        });
      } catch (caught) {
        if (ranking && /qiprofile/i.test(caught.message)) {
          log(`  Wikipedia does not offer the "${ranking}" ranking here; using its default order.`);
          ranking = null;
          continue;
        }
        error = caught;
        break;
      }
      for (const page of data.query?.pages ?? []) {
        if (page.pageid != null) byId.set(page.pageid, { ...byId.get(page.pageid), ...page });
      }
      if (!data.continue) break;
      cont = data.continue;
      const propsPending = Object.keys(cont).some((key) => key !== 'continue' && key !== 'gsroffset');
      if (!propsPending && byId.size >= limit) break;
    }
    if (error && !byId.size) throw error;
    const pages = [...byId.values()].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).slice(0, limit);
    return { pages, error };
  }

  return { call, search, stats };
}

const PAGE_PROPS = {
  prop: 'pageimages|description|pageprops|cirrusdoc',
  piprop: 'thumbnail', pithumbsize: String(THUMB_WIDTH), pilimit: 'max',
  ppprop: 'disambiguation',
  // From the search index: intro text, share of page views, categories and the title as displayed.
  cdincludes: 'opening_text|popularity_score|category|display_title',
};

// Turns a source from sources.json into a Wikipedia search.
//   { "template": "Infobox toy" }             pages that use that infobox
//   { "cats": ["Hats", "Caps"] }              pages directly in any of those categories
//   { "deepcat": "Chairs" }                   pages in that category or its subcategories
//   { "search": "fantasy novel" }             extra search words; combines with the others
export function sourceQuery(source) {
  const quote = (value) => `"${String(value).replace(/"/g, '')}"`;
  const parts = [];
  if (source.template) parts.push(`hastemplate:${quote(source.template)}`);
  if (source.cats?.length) parts.push(`incategory:${quote(source.cats.join('|'))}`);
  if (source.deepcat) parts.push(`deepcat:${quote(source.deepcat)}`);
  if (source.search) parts.push(source.search);
  return parts.join(' ');
}

// ---------------------------------------------------------------- filtering and tagging
//
// Wikipedia categories are about topics, so a search of "Chairs" also finds chair designers, a
// president who used a wheelchair and a puzzle about sofas. These rules keep the objects.

// Titles that are about a subject rather than being a thing.
const TOPIC_TITLE = /^(List|Lists|Timeline|History|Outline|Index|Glossary|Comparison|Culture|Types) of\b|\s(sizes?|collecting|making|weaving|handling|allowance|ban|problem|hoax|spill|flight|ceremony|prescription|time|industry|fashion|controversy|position)$/i;

// Never right for an all-ages game, wherever it turns up (title, description or intro).
const ADULT = /\b(sex|sexual\w*|sex toys?|erotic\w*|fetish\w*|bdsm|bondage|vibrators?|dildos?|pornograph\w*|genital\w*|penis|vagina\w*|pubic|orgasm\w*|masturbat\w*|condoms?|upskirt|voyeur\w*|prostitut\w*|brothel|striptease|strippers?|rape[ds]?|incest\w*|pa?edophil\w*|molest\w*)\b/i;
// Left out when it is the subject, but harmless in passing ("a shirt was once an undergarment").
const INTIMATE = /\b(nud(e|ity)|naked|buttocks|breasts|lingerie|g-string|thongs?|undergarments?|underwear|brassieres?|panties|diapers?)\b/i;

// Not suitable when it is what the page is about (title or description).
const UNSUITABLE = /\b(weapons?|firearms?|rifles?|pistols?|guns?|swords?|daggers?|tobacco|cigarettes?|cigars?|vap(e|ing)|missiles?|bombs?|warfare|military|army|naval|navy|warships?|nazi|narcotics?|cannabis|hash|heroin|cocaine|alcoholic|gambling|casino|torture|execut(ed|ion|ions)|electric chairs?|punish\w*|corporal|penance|penitent\w*|mortification|restrain(t|ts|ing)?|straitjacket|handcuffs?|shackles?|guillotine|gallows|slave\w*|racis\w*|caricature|blackface|supremac\w*|genocide|holocaust|suicide|murder\w*|corpses?|cadavers?|human bod(y|ies)|foot binding|bound feet|hoax|conspiracy|haunted|paranormal|voodoo|outlaw|criminal)\b/i;

// People are recognised by their Wikipedia categories ("1884 births", "Living people") and,
// failing that, by a description that leads with a role or carries life dates.
const PERSON_CATEGORY = /\b(births|deaths)$|\bliving people$/i;
const PERSON = /^(an? )?([\w-]+ ){0,3}(designer|perfumer|businessman|businesswoman|businessperson|entrepreneur|author|writer|novelist|poet|actor|actress|singer|musician|engineer|inventor|artist|politician|architect|illustrator|composer|president|governor|pope|monarch|prime minister|senator|footballer|athlete|spy|spies)\b(?!.*\bby\b)/i;
const LIFE_DATES = /\((born )?\d{4}([–-]\d{4})?\)|\b(from|since) \d{4}\b/i;

const ORGANISATION = /\b(company|companies|manufacturer|corporation|conglomerate|subsidiary|fashion house|design house|publisher|publishing house|organi[sz]ation|association|museum|record label|studio|watchmaker|shoemaker|luthier|jewell?er|firm)\b/i;
// Shops are never objects, even where brands are allowed.
const RETAIL = /\b(retailers?|retail|department store|supermarket|chain of|store chain|stores?|shops?|e-commerce|marketplace|boutique)\b/i;

// What a description says the page is, when that is not a physical thing. The first list matches
// anywhere in the head of the description, the second only where the head ends, so that
// "1999 film" is rejected but "film camera" is not, and "winter sport" but not "sports car".
const NOT_A_THING = /\b(tv series|television (series|show|program|programme|network|channel|film|drama|special)|episode|website|festival|trade fair|exhibition|subculture|genre|disambiguation|wikimedia|act of|profession|occupation|craft of|art of|process|processing|technique|classification|sizes|measurement|theory|phenomenon|(art|social|cultural|political|design) movement|visual arts?|architecture|revolution|ceremony|ritual|tradition|manner of|martial art|operating system|software|web browser|programming language|protocol|video games?(?! (console|system|controller|accessor))|franchise|fictional|deity|god|goddess|mytholog\w*|mystical|species|genus|flowering plant|church|chapel|cathedral|palace|statue|sculpture|painting|battalion|regiment|incident|accident|disaster|scandal|court case|cuisine|beverage|appetizer|dessert|chemical|spice|shrub|mineral|alloy|symbol\w*|emblem|slogan|phrase|idiom|person who|people who|paradox|(city|town|village|borough|province|river|mountain|island|country) in)\b|^(term|word|name|nickname)\b/i;
const NOT_A_THING_AT_END = /\b(films?|albums?|songs?|singles?|magazines?|awards?|industry|law|term|concepts?|methods?|activit(y|ies)|pastime|hobby|sports?|customs?|practice|service|labels?|marks?|characters?|plants?|fruits?|trees?|herbs?|compounds?|dish(es)?|meals?|drinks?|snacks?|coffee|index|temperature|variance|problems?|trials?|affairs?|city|town|village|country)$/i;

// A description's head is what the thing is, before "by …", "from …", "used for …" and the like.
// "Sports car manufactured by the manufacturer Porsche" is a car; "German car manufacturer" is not.
const AFTER_HEAD = /\b(by|from|for|based|adapted|made|produced|manufactured|designed|developed|marketed|sold|owned|created|featuring|used|worn|introduced|released|endorsed)\b/i;
const headOf = (description) => description.split(AFTER_HEAD)[0].replace(/[\s,;:]+$/, '');

// Why a page is not wanted, or null when it is. `page` is a search result; `options` are the
// source's settings plus `exclude`, a set of lower-case titles to leave out, and `named`, true for
// named works and products, whose titles ("Crime and Punishment", "Epiphone Casino") say nothing
// about what they are.
export function rejectReason(page, { allowOrganisations = false, allowNoImage = false, named = false, require, drop, exclude } = {}) {
  const description = page.description || '';
  const doc = page.cirrusdoc?.[0]?.source ?? {};
  const intro = typeof doc.opening_text === 'string' ? doc.opening_text.slice(0, 400) : '';
  const text = `${page.title} ${description}`;
  const head = headOf(description);
  if (page.missing || page.invalid) return 'missing';
  if (page.pageprops && 'disambiguation' in page.pageprops) return 'disambiguation';
  if (!named && TOPIC_TITLE.test(displayTitle(page.title))) return 'topic-page';
  if (exclude?.has(page.title.toLowerCase())) return 'excluded';
  if (!allowNoImage && !page.thumbnail?.source) return 'no-image';
  if (!description) return 'no-description';
  const subject = named ? description : text;
  if (ADULT.test(`${text} ${intro}`) || INTIMATE.test(subject) || UNSUITABLE.test(subject)) return 'unsuitable';
  if ((doc.category ?? []).some((category) => PERSON_CATEGORY.test(category))) return 'person';
  if (PERSON.test(description) || LIFE_DATES.test(description)) return 'person';
  if (RETAIL.test(head) || (!allowOrganisations && ORGANISATION.test(head))) return 'organisation';
  if (NOT_A_THING.test(head) || NOT_A_THING_AT_END.test(head)) return 'not-a-thing';
  if (drop && new RegExp(drop, 'i').test(text)) return 'source-drop';
  if (require && !new RegExp(require, 'i').test(text)) return 'source-require';
  return null;
}

// Items whose titles start with the same word ("iPhone 13", "iPhone 14", …) are one family.
export const familyOf = (title) => title.replace(/^(the|an?)\s+/i, '').split(/[\s\-–:,.']+|(?<=[A-Za-z])(?=\d)/)[0].toLowerCase();

// Wikipedia stores "iPhone" as "IPhone". Use the page's own display title when it only differs
// in capitals, and fix the best-known cases otherwise.
export function properTitle(title, shown) {
  const plain = typeof shown === 'string'
    ? shown.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim() : '';
  if (plain && plain.toLowerCase() === title.toLowerCase()) return plain;
  return title.replace(/^I(Phone|Pad|Pod|Mac|Book|Tunes)/, 'i$1').replace(/^E(Bay|Reader)/, 'e$1');
}

// A named product ("1921 perfume", "line of toys by Hasbro") or a kind of thing ("type of hat")?
export function guessKind(description = '') {
  return /^\d{4}s?\b|\b(brand|model|series|line of|range of|(manufactured|produced|made|designed|developed|created|sold|marketed) by|introduced in|released in)\b/i.test(description)
    ? 'iconic' : 'generic';
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
const sentenceCase = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
export const wikiTitle = (title) => title.replace(/ /g, '_');

// Housekeeping notes that sometimes come before the first real sentence of an article.
const NOTICE = /^(This article|This page|For other uses|For the|Not to be confused|Without proper rendering support|Several terms redirect here)[^.]*\.\s*/i;
const ABBREVIATION = /(?:^|[\s(])(?:No|Dr|Mr|Mrs|Ms|St|Jr|Sr|vs|Inc|Ltd|Co|Corp|Mt|Ft|[A-Z])$/;

// One or two opening sentences, at most about 300 characters.
export function tidyBlurb(text, fallback) {
  let blurb = (text || '').replace(/\s+/g, ' ').trim();
  while (NOTICE.test(blurb)) blurb = blurb.replace(NOTICE, '');
  blurb = blurb.replace(/\s\([^)]*\)/g, '').replace(/\s+([,.;:])/g, '$1').trim();
  if (blurb.length < 40) blurb = (fallback || blurb).trim();
  if (blurb.length > 300) {
    const window = blurb.slice(0, 300);
    let stop = -1;
    for (let at = window.lastIndexOf('. '); at > 100; at = window.lastIndexOf('. ', at - 1)) {
      if (!ABBREVIATION.test(window.slice(0, at))) { stop = at; break; }
    }
    blurb = stop > 0 ? window.slice(0, stop + 1) : `${window.slice(0, window.lastIndexOf(' '))}…`;
  }
  return blurb ? blurb[0].toUpperCase() + blurb.slice(1) : blurb;
}

// Takes turns across the lists (each already best-first) until `cap` items are chosen, so that
// every source is represented. A list with weight 2 gets two picks per turn.
export function pickBalanced(lists, cap, weights = []) {
  const picked = [];
  const next = lists.map(() => 0);
  for (let progressed = true; progressed && picked.length < cap;) {
    progressed = false;
    for (let i = 0; i < lists.length; i += 1) {
      for (let turn = 0; turn < (weights[i] ?? 1) && picked.length < cap; turn += 1) {
        const candidate = lists[i][next[i]];
        if (candidate === undefined) break;
        next[i] += 1;
        picked.push(candidate);
        progressed = true;
      }
    }
  }
  return picked;
}

// The top 5% by score are legendary, the next 20% rare, the rest common.
export function assignRarity(items, scoreOf = (item) => item.score) {
  const ranked = [...items].sort((a, b) => scoreOf(b) - scoreOf(a));
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
  for (let i = 0; i < wanted.length; i += PAGE) {
    const batch = wanted.slice(i, i + PAGE);
    const data = await api.call({
      titles: batch.map((seed) => seed.wiki.replace(/_/g, ' ')).join('|'), redirects: '1',
      prop: 'pageimages', piprop: 'thumbnail', pithumbsize: String(THUMB_WIDTH), pilimit: 'max',
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
  log(`Seeds: ${filled} of ${wanted.length} pictures found on Wikipedia`);
}

// ---------------------------------------------------------------- build

function toCandidate(page, source, settings) {
  const doc = page.cirrusdoc?.[0]?.source ?? {};
  return {
    pageid: page.pageid, title: properTitle(page.title, doc.display_title), wiki: wikiTitle(page.title),
    description: page.description,
    image: page.thumbnail?.source ?? null,
    opening: typeof doc.opening_text === 'string' && doc.opening_text.trim() ? doc.opening_text : null,
    popularity: Number(doc.popularity_score) || 0,
    kind: source.kind ?? settings.kind ?? guessKind(page.description),
    defaults: { ...settings.defaults, ...source.defaults },
  };
}

const filtersFor = (source, settings, exclude) => ({
  exclude,
  named: (source.kind ?? settings.kind) === 'iconic',
  allowOrganisations: source.allowOrganisations ?? settings.allowOrganisations,
  allowNoImage: source.allowNoImage ?? settings.allowNoImage,
  require: source.require ?? settings.require,
  drop: source.drop ?? settings.drop,
});

export async function build({
  offline = false, api = null, log = console.log, now = Date.now,
  timeBudgetMs = (Number(process.env.CATALOG_TIME_BUDGET_MIN) || 40) * 60000,
} = {}) {
  const config = JSON.parse(await readFile(path.join(ROOT, 'scripts/catalog/sources.json'), 'utf8'));
  const seeds = await loadSeeds();
  const report = [];
  const pools = new Map(CATEGORIES.map((category) => [category.id, []]));
  const taken = new Set(seeds.filter((seed) => seed.wiki).map((seed) => seed.wiki.toLowerCase()));
  const chosen = new Map(CATEGORIES.map((category) => [category.id, []]));
  const exclude = new Set((config.exclude ?? []).map((title) => title.toLowerCase()));
  const families = new Map(CATEGORIES.map((category) => [category.id, new Map()]));
  let outOfTime = false;

  if (!offline) {
    api ??= createApi({ log, now, deadline: now() + timeBudgetMs });
    await enrichSeeds(api, seeds, log);

    // Visit the first source of every category, then the second of each, and so on, so that
    // running out of time leaves every category with something.
    const steps = [];
    const settingsFor = (category) => config.categories[category.id] ?? { sources: [] };
    const most = Math.max(0, ...CATEGORIES.map((category) => settingsFor(category).sources.length));
    for (let order = 0; order < most; order += 1) {
      for (const category of CATEGORIES) {
        const source = settingsFor(category).sources[order];
        if (source) steps.push({ category, settings: settingsFor(category), source, order });
      }
    }

    let failures = 0;
    for (const { category, settings, source, order } of steps) {
      const query = sourceQuery(source);
      const row = { category: category.id, order, source: query, fetched: 0, kept: 0, picked: 0, rejected: {}, note: '' };
      report.push(row);
      if (outOfTime) { row.note = 'skipped: out of time'; continue; }
      let result;
      try {
        result = await api.search(query, { limit: source.limit ?? 100 });
      } catch (error) {
        if (error instanceof OutOfTime) { outOfTime = true; row.note = 'skipped: out of time'; continue; }
        failures += 1;
        row.note = `failed: ${error.message}`;
        log(`${category.id.padEnd(12)} FAILED  ${query}: ${error.message}`);
        continue;
      }
      if (result.error instanceof OutOfTime) outOfTime = true;
      if (result.error) row.note = `cut short: ${result.error.message}`;
      row.fetched = result.pages.length;
      const candidates = [];
      for (const page of result.pages) {
        const wiki = wikiTitle(page.title).toLowerCase();
        // No more than a handful from one family, or the iPhones and Toyotas crowd everything out.
        const family = familyOf(page.title);
        const familyCount = families.get(category.id);
        const familyFull = (familyCount.get(family) ?? 0) >= (settings.perFamilyCap ?? config.perFamilyCap ?? 5);
        const reason = taken.has(wiki) ? 'duplicate'
          : rejectReason(page, filtersFor(source, settings, exclude)) ?? (familyFull ? 'too-many-alike' : null);
        if (reason) { row.rejected[reason] = (row.rejected[reason] ?? 0) + 1; continue; }
        taken.add(wiki);
        familyCount.set(family, (familyCount.get(family) ?? 0) + 1);
        candidates.push({ ...toCandidate(page, source, settings), row });
      }
      row.kept = candidates.length;
      pools.get(category.id).push({ candidates, weight: source.weight ?? 1 });
      log(`${category.id.padEnd(12)} ${String(row.kept).padStart(3)} kept of ${String(row.fetched).padStart(3)}  ${query}`);
    }
    if (steps.length && failures === steps.length) throw new Error('Every Wikipedia search failed; catalog left unchanged.');
    if (outOfTime) log('Out of time: finishing with what has been collected.');

    for (const category of CATEGORIES) {
      const seedCount = seeds.filter((seed) => seed.category === category.id).length;
      const cap = Math.max(0, (config.perCategoryCap ?? 140) - seedCount);
      const lists = pools.get(category.id);
      const picked = pickBalanced(lists.map((list) => list.candidates), cap, lists.map((list) => list.weight));
      for (const candidate of picked) candidate.row.picked += 1;
      chosen.set(category.id, picked);
    }

    // Intro text normally arrives with the search. Fetch it separately only where it is missing.
    const missing = [...chosen.values()].flat().filter((candidate) => !candidate.opening);
    if (missing.length && !outOfTime) {
      log(`Fetching intro text for ${missing.length} items that came without it…`);
      try {
        for (let i = 0; i < missing.length; i += 20) {
          const batch = missing.slice(i, i + 20);
          const data = await api.call({
            pageids: batch.map((candidate) => candidate.pageid).join('|'), prop: 'extracts',
            exintro: '1', explaintext: '1', exsentences: '3', exlimit: 'max',
          });
          const extracts = new Map((data.query?.pages ?? []).map((page) => [page.pageid, page.extract]));
          for (const candidate of batch) candidate.opening = extracts.get(candidate.pageid) || null;
        }
      } catch (error) {
        log(`  Intro text is incomplete (${error.message}); short descriptions are used instead.`);
      }
    }
  }

  const catalog = new Map();
  for (const category of CATEGORIES) {
    const picked = chosen.get(category.id);
    const byViews = picked.some((candidate) => candidate.popularity > 0);
    const titles = new Set(seeds.filter((seed) => seed.category === category.id).map((seed) => seed.title.toLowerCase()));
    const generated = picked.map((candidate, index) => {
      const blurb = tidyBlurb(candidate.opening, candidate.description);
      // "BMW 3 Series (E90)" keeps its bracket when the short form is already taken.
      const short = displayTitle(candidate.title);
      const title = titles.has(short.toLowerCase()) ? candidate.title : short;
      titles.add(title.toLowerCase());
      return {
        id: `${category.id}/${slugify(candidate.title)}`, title, kind: candidate.kind,
        category: category.id, about: sentenceCase(candidate.description), blurb, wiki: candidate.wiki, image: candidate.image,
        ...tagItem(`${candidate.title} ${candidate.description} ${blurb}`, candidate.defaults),
        rarity: 'common', source: 'wikipedia', score: byViews ? candidate.popularity : -index,
      };
    });
    assignRarity(generated);
    const ids = new Set();
    const items = [...seeds.filter((seed) => seed.category === category.id), ...generated]
      .map(({ score, ...item }) => item)
      .filter((item) => item.id.split('/')[1] && !ids.has(item.id) && ids.add(item.id) && !itemProblems(item).length)
      .sort((a, b) => a.title.localeCompare(b.title, 'en'));
    catalog.set(category.id, items);
  }
  report.sort((a, b) => CATEGORIES.findIndex((c) => c.id === a.category) - CATEGORIES.findIndex((c) => c.id === b.category) || a.order - b.order);
  return { catalog, report, stats: api?.stats ?? { requests: 0, limited: 0, waitedMs: 0 }, outOfTime };
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

export function reportMarkdown(counts, report, stats) {
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  const lines = [`# Catalog build: ${total} items`, '', '| Category | Items |', '|---|---|'];
  for (const c of counts) lines.push(`| ${c.id} | ${c.count} |`);
  if (report.length) {
    lines.push('', `Wikipedia requests: ${stats.requests}, told to slow down ${stats.limited} times, waited ${Math.round(stats.waitedMs / 60000)} min.`, '');
    lines.push('| Category | Search | Found | Kept | Used | Rejected | Note |', '|---|---|---|---|---|---|---|');
    for (const row of report) {
      const rejected = Object.entries(row.rejected).map(([reason, count]) => `${reason} ${count}`).join(', ');
      lines.push(`| ${row.category} | ${row.source.replace(/\|/g, ' / ')} | ${row.fetched} | ${row.kept} | ${row.picked} | ${rejected} | ${row.note} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// Re-applies the current rules and the exclude list to the Wikipedia items already in
// data/catalog/, without contacting Wikipedia. It can only remove items; a full build adds them.
export async function refilter({ log = console.log } = {}) {
  const config = JSON.parse(await readFile(path.join(ROOT, 'scripts/catalog/sources.json'), 'utf8'));
  const exclude = new Set((config.exclude ?? []).map((title) => title.toLowerCase()));
  const catalog = new Map();
  for (const category of CATEGORIES) {
    const items = JSON.parse(await readFile(path.join(ROOT, 'data/catalog', `${category.id}.json`), 'utf8'));
    catalog.set(category.id, items.filter((item) => {
      if (item.source !== 'wikipedia') return true;
      const page = {
        title: item.wiki.replace(/_/g, ' '), description: item.about || 'object', thumbnail: { source: 'kept' },
        cirrusdoc: [{ source: { opening_text: item.blurb } }],
      };
      // Which source an item came from is not recorded, so only the rules shared by all apply.
      const reason = rejectReason(page, { allowOrganisations: true, named: item.kind === 'iconic', exclude });
      if (reason) log(`  removing ${item.title} (${category.id}): ${reason}`);
      return !reason;
    }));
  }
  return catalog;
}

// Prints what each search returns and why each page would be kept or rejected. Writes nothing.
async function probe(queries, log = console.log) {
  const api = createApi({ log });
  for (const query of queries) {
    log(`\n=== ${query}`);
    const { pages, error } = await api.search(query, { limit: 20 });
    if (error) log(`cut short: ${error.message}`);
    for (const page of pages) {
      const candidate = toCandidate(page, {}, {});
      const verdict = rejectReason(page) ?? 'keep';
      log(`${String(page.index ?? '?').padStart(3)}  ${verdict.padEnd(14)} ${page.title}  —  ${page.description ?? '(no description)'}`
        + `  [picture: ${candidate.image ? 'yes' : 'no'}, views: ${candidate.popularity.toExponential(1)}, intro: ${candidate.opening ? candidate.opening.length : 0} chars]`);
    }
    if (pages[0]) log(`first page as received: ${JSON.stringify(pages[0]).slice(0, 1200)}`);
    if (!pages.length) log('(no results)');
  }
  log(`\n${api.stats.requests} requests, told to slow down ${api.stats.limited} times.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  try {
    if (args.includes('--refilter')) {
      const manifest = await writeCatalog(await refilter(), { offline: false });
      console.log(`Kept ${manifest.total} items.`);
    } else if (args.includes('--probe')) {
      const queries = (args[args.indexOf('--probe') + 1] ?? '').split(';;').map((query) => query.trim()).filter(Boolean);
      if (!queries.length) throw new Error('Give --probe a search, e.g. --probe \'deepcat:"Hats"\'');
      await probe(queries);
    } else {
      let before = 0;
      try { before = JSON.parse(await readFile(path.join(ROOT, 'data/catalog/index.json'), 'utf8')).total; } catch { /* first build */ }
      const { catalog, report, stats } = await build({ offline });
      const counts = [...catalog].map(([id, items]) => ({ id, count: items.length }));
      const total = counts.reduce((sum, c) => sum + c.count, 0);
      const markdown = reportMarkdown(counts, report, stats);
      console.log(`\n${markdown}`);
      if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
      // A throttled or interrupted run must not replace a good catalog with a much smaller one.
      if (!offline && !args.includes('--force') && total < before * 0.7) {
        throw new Error(`Only ${total} items this time, against ${before} already in the catalog. Keeping the existing catalog (use --force to replace it).`);
      }
      const manifest = await writeCatalog(catalog, { offline });
      if (!offline) await writeFile(path.join(ROOT, 'data/catalog-report.md'), markdown);
      console.log(`Wrote ${manifest.total} items in ${manifest.categories.length} categories.`);
    }
  } catch (error) {
    console.error(`Catalog build failed: ${error.message}`);
    process.exit(1);
  }
}

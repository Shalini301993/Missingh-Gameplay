# Curio Capsule

A capsule-machine game for the browser. Tell the machine what you like, pull the lever, and it
drops a capsule holding a random object matched to you: clothes, shoes, perfumes, books, bags,
jewellery, watches, toys, vehicles, gadgets, home objects and musical instruments. Every find goes
into your collection book with a short description, a picture, and links to read more or look for
it online.

Built with [Phaser](https://phaser.io/) 4 as a plain static site, so it runs on GitHub Pages with no
server.

## How to play

1. **Pick your likes** – favourite categories, vibes, colours and a budget level. Change them any
   time under *Your likes*.
2. **Pick today's mood** beside the machine. It resets each day.
3. **Pull the lever** (the button, or the brass dial on the machine). Each pull costs one token.
4. **Open the capsule.** Capsules are common, rare (1 in 5) or legendary (1 in 20). The card tells
   you what the object is and why it matched.
5. **Fill your collection.** Favourite the ones you love.

Tokens: you are topped up to 10 every day. Every fifth new discovery earns a bonus token, and two
duplicates make one token. About one pull in seven is a *wildcard* that ignores your likes, so the
machine can still surprise you.

Your likes, tokens and collection are saved in your browser only. Nothing is sent anywhere.

## Run it locally

```bash
node scripts/serve.mjs
```

Then open <http://localhost:8080/>. Any static file server works; there is no build step.

## Put it on GitHub Pages

1. Merge this branch into `main`.
2. In the repository, go to **Settings → Pages** and pick either source:
   - **Deploy from a branch** → `main`, folder `/ (root)`. GitHub publishes the repository as it
     is; the site needs no build step.
   - **GitHub Actions**. The *Deploy to GitHub Pages* workflow then publishes just the game files
     on every push to `main`, after checking the catalog.

Either way the game appears at `https://<your-user>.github.io/<repository>/` a minute or two later.

## The catalog

The catalog lives in `data/catalog/`, one file per category. It is built from two places:

- **Seeds** (`data/seeds/*.json`) – about 150 hand-written, hand-tagged objects. Edit these files to
  add your own.
- **Wikipedia** – `scripts/catalog/build.mjs` runs the searches listed in
  `scripts/catalog/sources.json`, keeps pages that are objects (not people, companies, places,
  events or anything unsuitable for an all-ages game), tags them by keyword, and takes turns across
  the sources so each one is represented. Within a category the most-read pages become legendary
  and rare.

The *Build catalog* workflow runs the generator on GitHub and commits the result. It runs only when
you start it (**Actions → Build catalog → Run workflow**), so the catalog changes only when you ask
for it. Run it after editing the seeds or `sources.json`. Each build also writes
`data/catalog-report.md`, which shows how many items every search found, kept and used. That is the
place to look when tuning `sources.json`.

A rebuild samples Wikipedia afresh, so it can bring in pages nobody has looked at yet. Skim the new
entries afterwards and exclude anything that does not belong (see below).

```bash
node scripts/catalog/build.mjs            # seeds + Wikipedia (needs internet)
node scripts/catalog/build.mjs --offline  # seeds only
node scripts/catalog/build.mjs --refilter # re-apply the rules to the existing catalog, no internet
node scripts/catalog/validate.mjs         # check the catalog files
```

Spotted something that should not be there? Add its Wikipedia page title to the `exclude` list at
the top of `sources.json` and run `--refilter` (or run the workflow with *mode* set to *refilter*,
which takes seconds); it is removed straight away and stays out of future builds.

### Adding sources

Each line in a category's `sources` list is one Wikipedia search:

```json
{ "template": "Infobox toy", "limit": 200 }
{ "cats": ["Hats", "Scarves"], "limit": 100 }
{ "deepcat": "Chairs", "limit": 150 }
{ "template": "Infobox book", "search": "detective novel", "limit": 100 }
```

- `template` – pages that use that infobox; `cats` – pages directly in any of those categories;
  `deepcat` – a category and everything beneath it; `search` – extra search words.
- `limit` – how many results to look at, most popular first.
- Optional: `kind` (`iconic` or `generic`), `weight` (a bigger share of the category), `defaults`
  (tags to fall back on), `require` / `drop` (patterns a page must or must not match),
  `allowOrganisations`, `allowNoImage`. A `require` set on a category applies to all its sources.

At the top of the file, `perCategoryCap` sets how many items each category may hold and
`perFamilyCap` how many may start with the same word, so that one product line (every iPhone,
every Toyota) cannot crowd out the rest.

To see what a search returns before adding it, without changing anything:

```bash
node scripts/catalog/build.mjs --probe 'deepcat:"Hats"'
```

The same thing is available from the **Actions** tab: run *Build catalog* and fill in the *probe*
box.

### Why a build takes a while

Wikipedia limits how fast scripts that do not identify themselves may ask. The build asks for
50 pages at a time, waits whenever it is told to slow down, and stops cleanly after 40 minutes with
whatever it has collected. A build that comes back much smaller than the existing catalog is
discarded rather than committed.

Wikipedia asks scripts to identify themselves with contact details, and may allow identified
scripts more requests. If you want that, add a repository variable named `CATALOG_USER_AGENT`
(**Settings → Secrets and variables → Actions → Variables**), for example
`CurioCapsuleCatalog/1.0 (https://github.com/you/your-repo; you@example.com)`. Nothing personal is
sent unless you set it.

Good to know: tags on Wikipedia-sourced items are guessed from keywords, so they are rougher than
the hand-tagged seeds. If something odd turns up, add a `drop` pattern to its source or put a
corrected version in the seeds (seeds always win).

## Tests

```bash
npm test             # matching, tokens, generator and catalog checks
node tests/smoke.mjs # plays the game in a real browser (needs Playwright with Chromium)
```

Every pull request runs `npm test` and the catalog check automatically (the *Tests* workflow).

## Layout

```
index.html, styles/     the page and its museum-catalogue look
src/scenes/             the Phaser machine: capsules, dial, chute, reveal
src/ui/                 likes sheet, product card, collection book
src/core/               vocabulary, matching, tokens, storage, catalog loading
data/seeds/             hand-written objects
data/catalog/           the built catalog the game loads
scripts/catalog/        the generator, its sources and the validator
vendor/                 Phaser (MIT licence)
```

## Credits

Descriptions and images come from [Wikipedia](https://en.wikipedia.org/) and Wikimedia Commons and
remain under their own licences (Wikipedia text is CC BY-SA); each card links to its source article.
Product and brand names belong to their owners and are used only to describe the objects.

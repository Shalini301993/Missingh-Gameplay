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

1. In the repository, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Merge this branch into `main`.

The *Deploy to GitHub Pages* workflow publishes the site on every push to `main`.

## The catalog

The catalog lives in `data/catalog/`, one file per category. It is built from two places:

- **Seeds** (`data/seeds/*.json`) – about 150 hand-written, hand-tagged objects. Edit these files to
  add your own.
- **Wikipedia** – `scripts/catalog/build.mjs` walks the Wikipedia categories and searches listed in
  `scripts/catalog/sources.json`, keeps pages that are objects with a picture, tags them by keyword,
  and ranks rarity by how often each page is read.

The *Build catalog* workflow runs the generator and commits the result whenever the seeds or the
generator change, or when you run it by hand from the **Actions** tab. Its run summary shows how
many items each source produced, which is the place to look when tuning `sources.json`.

```bash
node scripts/catalog/build.mjs            # seeds + Wikipedia (needs internet)
node scripts/catalog/build.mjs --offline  # seeds only
node scripts/catalog/validate.mjs         # check the catalog files
```

To grow a category, add a line to its `sources` list in `sources.json`:

```json
{ "cat": "Wikipedia category name", "depth": 1, "limit": 200 }
{ "search": "hastemplate:\"Infobox book\" detective novel", "limit": 200 }
```

`perCategoryCap` at the top of that file sets how many items each category may hold.

Good to know: tags on Wikipedia-sourced items are guessed from keywords, so they are rougher than
the hand-tagged seeds. If something odd turns up, add a `drop` pattern to its source or put a
corrected version in the seeds (seeds always win).

## Tests

```bash
npm test             # matching, tokens, generator and catalog checks
node tests/smoke.mjs # plays the game in a real browser (needs Playwright with Chromium)
```

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
remain under their own free licences (text is CC BY-SA); each card links to its source article.
Product and brand names belong to their owners and are used only to describe the objects.

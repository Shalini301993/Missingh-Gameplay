# Curio Capsule

A capsule-machine game for the browser. Tell the machine what you like, pull the lever, and it
drops a capsule holding a random object matched to you: clothes, shoes, perfumes, books, bags,
jewellery, watches, toys, vehicles, gadgets, home objects and musical instruments. Every find goes
into your collection book with a short description, a picture, a line from literature, links to
shops that sell it, and three other objects it goes well with. Each mood has its own music.

Built with [Phaser](https://phaser.io/) 4 as a plain static site, so it runs on GitHub Pages with no
server.

## How to play

1. **Pick your likes** – favourite categories, vibes, colours, a budget level and the country you
   shop in. Change them any time under *Your likes*.
2. **Pick today's mood** beside the machine. It sets the music and nudges what drops. It resets
   each day.
3. **Pull the lever** – press the button (or <kbd>Space</kbd>, or the brass dial) and a needle
   starts sweeping the gauge. Press again to stop it. Stop in the **gold** for a perfect pull, in
   the blue band for a good one. Each pull costs one token.
4. **Open the capsule.** It arrives in a plain wrapper; watch the glow behind it climb from grey to
   blue to gold. The card tells you what the object is, why it matched, and where to find one.
5. **Fill your collection.** Favourite the ones you love, and say *Not for me* to the ones you
   don't. The machine learns from both.

### The rules

| | |
|---|---|
| **Odds** | Common, rare or legendary. A missed stop gives 5% legendary and 20% rare; a good stop 8% and 27%; a perfect stop 14% and 36%. |
| **Combo** | Each good or perfect stop in a row adds to your combo, which adds experience. The needle speeds up and the gold narrows as the combo grows. A miss breaks it. |
| **Fever** | Every pull fills the fever meter, perfect stops and new finds fastest. When it is full, the next 3 pulls are rare or better. |
| **Levels** | Pulls earn experience (more for rarer, newer and more skilful finds). Each new collector level pays 2 tokens. |
| **Missions** | Three a day, the same for everyone, such as *Stop the needle in the gold 3 times*. Each pays 1–3 tokens. |
| **Tokens** | Topped up to 10 every day. Every fifth new discovery pays 1, and two duplicates make 1. |
| **Wildcards** | About one pull in seven ignores your likes, so the machine can still surprise you. |

Your likes, tokens, progress and collection are saved in your browser only. Nothing is sent anywhere.

### Music

Each mood has an original piece, composed by the game itself as it plays (nothing is downloaded,
and there are no recordings):

| Mood | Piece | In the spirit of |
|---|---|---|
| Calm | *Nocturne in D-flat* | a Chopin nocturne, with jazz harmony |
| Romantic | *Waltz for a Rose* | a Chopin waltz played by a jazz trio |
| Nostalgic | *Lo-fi Letters* | dusty electric piano and soft drums (also plays when no mood is picked) |
| Playful | *Rhodes and Sunlight* | laid-back neo-soul, in the manner of FKJ |
| Adventurous | *Qawwali Nights* | harmonium, tabla and hand claps over a walking bass |
| Bold | *Midnight Bebop* | fast swing: walking bass, ride cymbal and horns |

The music changes when you change mood, speeds up during fever, and starts with your first tap
(browsers do not allow sound before that). *Music* and *Sounds* in the header switch it off.

### Where to buy

Every card has a button to search **Amazon** in your country, then shops that suit the object:

- Books: Bookshop.org (US and UK), AbeBooks, and Open Library to borrow free
- Fashion, shoes, bags and accessories: Nordstrom (US), Flipkart (India), Etsy and eBay
- Perfume: Sephora and Nordstrom (US), Flipkart (India)
- Home: IKEA, Target (US), Flipkart (India) and Etsy
- Instruments: Thomann; watches, gadgets and vehicles: eBay; toys: Target (US), Etsy and eBay

Each link opens a search on that shop for the object. The country comes from your browser's
language settings and can be changed under *Your likes*. To earn from Amazon links, put your
Amazon Associates tracking ID in `AMAZON_TAG` at the top of `src/core/shops.js`.

### Quotes

Each object carries a line from a public-domain work (Shakespeare, Austen, Carroll, Wilde,
Thoreau, Dickens, Whitman, Keats and others), chosen because it names the object, shares its
category or shares its mood. All 102 quotes in `data/quotes.json` were checked word for word
against their source texts on Project Gutenberg and Wikisource, and each links to the full work.

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
npm test             # rules, matching, shop links, quotes, generator and catalog checks
node tests/smoke.mjs # plays the game in a real browser and renders all the music (needs Playwright)
```

Every pull request runs `npm test` and the catalog check automatically (the *Tests* workflow).

## Layout

```
index.html, styles/     the page and its museum-catalogue look
src/scenes/             the Phaser machine: capsules, dial, chute, reveal, fever ring
src/audio/              the music (tracks.js), the synthesized instruments and the player
src/ui/                 likes sheet, product card, collection book
src/core/               rules (play.js), matching, taste learning, shop links, quotes, storage
data/seeds/             hand-written objects
data/catalog/           the built catalog the game loads
data/quotes.json        the checked quotes
scripts/catalog/        the generator, its sources and the validator
vendor/                 Phaser (MIT licence)
```

## Credits

Descriptions and images come from [Wikipedia](https://en.wikipedia.org/) and Wikimedia Commons and
remain under their own licences (Wikipedia text is CC BY-SA); each card links to its source article.
Product and brand names belong to their owners and are used only to describe the objects.

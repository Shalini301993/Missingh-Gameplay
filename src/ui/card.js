// The product card shown when a capsule opens, styled like a museum label.

import { categoryById, rarityById, COLOURS, BUDGETS, KIND_LABELS, ORIGINS } from '../core/vocab.js';
import { enrich, wikiUrl, webSearchUrl } from '../core/catalog.js';
import { quoteLines } from '../core/quotes.js';
import { shopLinks, regionById } from '../core/shops.js';
import { h, capitalise, openDialog, closeOnBackdrop } from './dom.js';

// A picture frame that falls back to a lettered plate when there is no usable image.
export function plate(item, { small = false, onImage } = {}) {
  const category = categoryById(item.category);
  const initial = (item.title.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
  const blank = () => (small
    ? h('span', { class: 'glyph', 'aria-hidden': 'true' }, initial)
    : h('div', { class: 'plate-blank' },
      h('span', { class: 'glyph', 'aria-hidden': 'true' }, initial),
      h('span', { class: 'plate-word' }, item.kind === 'maker'
        ? `Small maker${ORIGINS[item.origin] ? ` · ${ORIGINS[item.origin]}` : ''}` : category?.label ?? 'Object')));
  const frame = h('div', { class: small ? 'tile-plate' : 'plate-frame' });
  const show = (source) => {
    const image = h('img', { src: source, alt: small ? '' : item.title, loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    image.addEventListener('error', () => { frame.replaceChildren(blank()); onImage?.(false); });
    image.addEventListener('load', () => onImage?.(true));
    frame.replaceChildren(image);
  };
  if (item.image) show(item.image);
  else {
    frame.append(blank());
    if (!small) enrich(item).then((found) => { if (found.image && frame.isConnected) show(found.image); });
  }
  return frame;
}

function quoteBlock(quote) {
  if (!quote) return null;
  const lines = quoteLines(quote);
  return h('figure', { class: 'quote' },
    h('blockquote', {}, lines.map((line, i) => [line, i < lines.length - 1 ? h('br') : null])),
    h('figcaption', {}, '— ', quote.author, ', ',
      h('a', { href: quote.source, target: '_blank', rel: 'noopener', title: 'Read the whole work free' }, h('cite', {}, quote.work))));
}

const external = (href, text, onClick) => h('a', { href, target: '_blank', rel: 'noopener', onClick }, text);

export function createCardSheet(dialog, {
  isFavourite, onFavourite, onNotForMe, isHidden, onShop, onChangeRegion,
  quoteFor = () => null, pairingsFor = () => [], getRegion = () => 'US',
}) {
  closeOnBackdrop(dialog);
  let parent = null; // the card a "goes well with" preview returns to

  function shopSection(item) {
    const region = regionById(getRegion());
    const [first, ...others] = shopLinks(item, region.id);
    const visit = () => onShop?.(item);
    const own = first.id === 'maker';
    return h('section', { class: 'shop', 'aria-labelledby': 'shop-heading' },
      h('div', { class: 'section-head' },
        h('h3', { id: 'shop-heading' }, own ? 'Buy from the maker' : 'Find one'),
        !own && h('button', { type: 'button', class: 'link-button small', onClick: () => onChangeRegion?.() }, `Shops in ${region.label}`)),
      h('a', { class: 'buy', id: 'buy', href: first.url, target: '_blank', rel: 'noopener', onClick: visit },
        h('span', {}, own ? `Visit ${first.label}'s shop` : `Search ${first.label}`), h('span', { 'aria-hidden': 'true' }, '↗')),
      h('ul', { class: 'shops' }, others.map((link) => h('li', {},
        external(link.url, `${link.label} ↗`, visit),
        link.note && h('span', { class: 'shop-note' }, link.note)))),
      h('p', { class: 'fine' }, own
        ? `${first.label} is a small independent business. Prices, stock and shipping are theirs.`
        : 'Each link opens a search on that shop. Prices and stock are theirs.'));
  }

  function pairSection(item) {
    const pairs = pairingsFor(item);
    if (!pairs.length) return null;
    return h('section', { class: 'pairs', 'aria-labelledby': 'pairs-heading' },
      h('div', { class: 'section-head' }, h('h3', { id: 'pairs-heading' }, 'Goes well with')),
      h('ul', { class: 'pair-list' }, pairs.map((other) => h('li', {},
        h('button', { type: 'button', class: 'pair', onClick: () => preview(other) },
          plate(other, { small: true }),
          h('span', { class: 'pair-title' }, other.title),
          h('span', { class: 'pair-meta' }, categoryById(other.category)?.label ?? ''))))));
  }

  function preview(other) {
    open(other, { preview: true, closeLabel: 'Back', back: parent });
  }

  function open(item, options = {}) {
    const { note, reasons = [], closeLabel = 'Back to the machine', preview: isPreview = false, reward = null, back = null } = options;
    if (!isPreview) parent = { item, options };
    const category = categoryById(item.category);
    const rarity = rarityById(item.rarity);
    const wiki = wikiUrl(item);
    const label = (list, id) => list.find((entry) => entry.id === id)?.label ?? id;
    const tags = [
      ...item.vibes.map(capitalise), ...item.moods.map(capitalise),
      ...item.colours.map((id) => label(COLOURS, id)), `${label(BUDGETS, item.budget)} budget`,
    ];

    const credit = h('figcaption', { hidden: true }, 'Image via Wikipedia / Wikimedia Commons');
    const favourite = h('button', { type: 'button', class: 'secondary', id: 'favourite' });
    const paintFavourite = () => {
      const on = isFavourite(item.id);
      favourite.textContent = on ? '★ Favourite' : '☆ Favourite';
      favourite.setAttribute('aria-pressed', String(on));
    };
    favourite.addEventListener('click', () => { onFavourite(item); paintFavourite(); });
    paintFavourite();
    const notForMe = h('button', { type: 'button', class: 'secondary quiet', id: 'not-for-me' });
    const paintNotForMe = () => {
      const hidden = isHidden(item.id);
      notForMe.textContent = hidden ? 'Hidden from future pulls' : 'Not for me';
      notForMe.disabled = hidden;
    };
    notForMe.addEventListener('click', () => { onNotForMe(item); paintNotForMe(); });
    paintNotForMe();

    const close = isPreview && back
      ? () => open(back.item, back.options)
      : () => dialog.close();

    dialog.replaceChildren(
      h('article', { class: `card ${item.rarity}${isPreview ? ' preview' : ''}` },
        h('figure', { class: 'plate' },
          plate(item, { onImage: (shown) => { credit.hidden = !shown; } }),
          credit),
        h('div', { class: 'label' },
          h('p', { class: 'eyebrow' },
            h('span', { class: `rarity-dot ${item.rarity}` }),
            h('span', { class: 'rarity-word' }, rarity?.label ?? item.rarity),
            h('span', {}, [category?.label ?? item.category, KIND_LABELS[item.kind], ORIGINS[item.origin]].filter(Boolean).join(' · '))),
          h('h2', { id: 'card-title' }, item.title),
          item.about && h('p', { class: 'about' }, item.about),
          reward && h('p', { class: `reward ${reward.quality}` },
            h('strong', {}, { perfect: 'Perfect stop', good: 'Good stop', miss: 'Missed the zone' }[reward.quality]),
            ` · +${reward.xp} XP`, reward.combo > 1 ? ` · combo ×${reward.combo}` : '', reward.fever ? ' · fever pull' : ''),
          isPreview ? h('p', { class: 'note' }, 'Not in your collection yet. Pull the lever and it might be.') : note && h('p', { class: 'note' }, note),
          h('p', { class: 'blurb' }, item.blurb),
          quoteBlock(quoteFor(item)),
          h('ul', { class: 'tags', 'aria-label': 'Tags' }, [...new Set(tags)].map((tag) => h('li', {}, tag))),
          reasons.length > 0 && h('p', { class: 'why' }, `Matched on: ${reasons.join(', ')}.`),
          shopSection(item),
          h('p', { class: 'research' },
            wiki && external(wiki, 'Read on Wikipedia ↗'),
            external(webSearchUrl(item), 'Search the web ↗')),
          !isPreview && pairSection(item),
          h('div', { class: 'actions' },
            !isPreview && favourite,
            !isPreview && notForMe,
            h('button', { type: 'button', class: 'primary', id: 'close-card', onClick: close }, closeLabel)))),
    );
    // Open at the top, on the picture and title; the heading takes focus for screen readers.
    openDialog(dialog);
  }

  return { open };
}

// The product card shown when a capsule opens, styled like a museum label.

import { categoryById, rarityById, COLOURS, BUDGETS } from '../core/vocab.js';
import { enrich, wikiUrl, webSearchUrl, shopSearchUrl } from '../core/catalog.js';
import { h, capitalise, openDialog, closeOnBackdrop } from './dom.js';

// A picture frame that falls back to a typographic plate when there is no usable image.
export function plate(item, { small = false, onImage } = {}) {
  const category = categoryById(item.category);
  const initial = (item.title.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
  const blank = () => (small
    ? h('span', { class: 'glyph', 'aria-hidden': 'true' }, initial)
    : h('div', { class: 'plate-blank' },
      h('span', { class: 'glyph', 'aria-hidden': 'true' }, initial),
      h('span', { class: 'plate-word' }, category?.label ?? 'Object')));
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

export function createCardSheet(dialog, { isFavourite, onFavourite }) {
  closeOnBackdrop(dialog);

  function open(item, { note, reasons = [], closeLabel = 'Back to the machine' } = {}) {
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
      favourite.textContent = on ? '★ Favourite' : '☆ Add to favourites';
      favourite.setAttribute('aria-pressed', String(on));
    };
    favourite.addEventListener('click', () => { onFavourite(item.id); paintFavourite(); });
    paintFavourite();

    dialog.replaceChildren(
      h('article', { class: `card ${item.rarity}` },
        h('figure', { class: 'plate' },
          plate(item, { onImage: (shown) => { credit.hidden = !shown; } }),
          credit),
        h('div', { class: 'label' },
          h('p', { class: 'eyebrow' },
            h('span', { class: `rarity-dot ${item.rarity}` }),
            h('span', { class: 'rarity-word' }, rarity?.label ?? item.rarity),
            h('span', {}, `${category?.label ?? item.category} · ${item.kind === 'iconic' ? 'Iconic object' : 'Type of object'}`)),
          h('h2', { id: 'card-title' }, item.title),
          item.about && h('p', { class: 'about' }, item.about),
          note && h('p', { class: 'note' }, note),
          h('p', { class: 'blurb' }, item.blurb),
          h('ul', { class: 'tags', 'aria-label': 'Tags' }, [...new Set(tags)].map((tag) => h('li', {}, tag))),
          reasons.length > 0 && h('p', { class: 'why' }, `Matched on: ${reasons.join(', ')}.`),
          h('div', { class: 'links' },
            wiki && h('a', { href: wiki, target: '_blank', rel: 'noopener' }, 'Read on Wikipedia ↗'),
            h('a', { href: webSearchUrl(item), target: '_blank', rel: 'noopener' }, 'Search the web ↗'),
            h('a', { href: shopSearchUrl(item), target: '_blank', rel: 'noopener' }, 'Search shopping ↗')),
          h('div', { class: 'actions' },
            favourite,
            h('button', { type: 'button', class: 'primary', id: 'close-card', onClick: () => dialog.close() }, closeLabel)))),
    );
    openDialog(dialog);
    dialog.querySelector('#close-card').focus();
  }

  return { open };
}

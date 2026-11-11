// The collection book: everything the player has discovered, with progress per category.

import { CATEGORIES, RARITIES, categoryById } from '../core/vocab.js';
import { h, chip, openDialog, closeOnBackdrop } from './dom.js';
import { plate } from './card.js';

export function createCollectionSheet(dialog, { getState, getManifest, onOpenItem }) {
  closeOnBackdrop(dialog);
  let filter = 'all';

  function render() {
    const state = getState();
    const manifest = getManifest();
    const owned = Object.values(state.collection).sort((a, b) => (b.first || '').localeCompare(a.first || ''));
    const totalFor = (id) => manifest?.categories.find((c) => c.id === id)?.count ?? 0;
    const ownedIn = (id) => owned.filter((entry) => entry.item.category === id).length;
    const favourites = owned.filter((entry) => state.favourites.includes(entry.item.id));

    const shown = filter === 'all' ? owned
      : filter === 'favourites' ? favourites
        : owned.filter((entry) => entry.item.category === filter);

    const filterChip = (id, label, progress) => chip({
      label,
      pressed: filter === id,
      extra: h('span', { class: 'progress' }, progress),
      onToggle: () => { filter = id; render(); },
    });

    dialog.replaceChildren(
      h('header', { class: 'sheet-head' },
        h('div', {},
          h('p', { class: 'eyebrow' }, 'Your cabinet'),
          h('h2', { id: 'collection-title' }, 'Collection')),
        h('button', { type: 'button', class: 'secondary', id: 'close-collection', onClick: () => dialog.close() }, 'Close')),
      h('div', { class: 'sheet-body' },
        h('p', { class: 'stats' },
          h('span', {}, h('strong', {}, String(owned.length)), `of ${manifest?.total ?? '…'} discovered`),
          RARITIES.map((rarity) => h('span', {},
            h('strong', {}, String(owned.filter((entry) => entry.item.rarity === rarity.id).length)),
            rarity.label.toLowerCase()))),
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter collection' },
          filterChip('all', 'Everything', String(owned.length)),
          filterChip('favourites', '★ Favourites', String(favourites.length)),
          CATEGORIES.map((category) => filterChip(category.id, category.label, `${ownedIn(category.id)}/${totalFor(category.id)}`))),
        shown.length
          ? h('ul', { class: 'tiles' }, shown.map((entry) => h('li', {},
            h('button', { type: 'button', class: 'tile', onClick: () => onOpenItem(entry.item) },
              plate(entry.item, { small: true }),
              h('span', { class: 'tile-label' },
                h('span', { class: 'tile-title' }, entry.item.title),
                h('span', { class: 'tile-meta' },
                  h('span', { class: `rarity-dot ${entry.item.rarity}` }),
                  categoryById(entry.item.category)?.label ?? '',
                  entry.count > 1 && ` ×${entry.count}`))))))
          : h('p', { class: 'empty' }, owned.length
            ? 'Nothing here yet. Keep pulling.'
            : 'Your cabinet is empty. Pull the lever to find your first object.')),
    );
  }

  return {
    open() { render(); openDialog(dialog); },
    refresh() { if (dialog.open) render(); },
  };
}

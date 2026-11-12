// The "Your likes" sheet: categories, vibes, colours and budget.

import { CATEGORIES, VIBES, COLOURS, BUDGETS, MOODS } from '../core/vocab.js';
import { REGIONS, regionById } from '../core/shops.js';
import { h, chip, capitalise, openDialog, closeOnBackdrop } from './dom.js';

export function createProfileSheet(dialog, { getProfile, onSave }) {
  closeOnBackdrop(dialog);
  let draft;

  function multi(key, options) {
    return h('div', { class: 'chips' }, options.map((option) => chip({
      label: option.label,
      swatch: option.hex,
      pressed: draft[key].includes(option.id),
      onToggle: (button) => {
        const on = !draft[key].includes(option.id);
        draft[key] = on ? [...draft[key], option.id] : draft[key].filter((id) => id !== option.id);
        button.setAttribute('aria-pressed', String(on));
      },
    })));
  }

  function single(key, options, { allowNone = false } = {}) {
    const group = h('div', { class: 'chips' });
    const paint = () => [...group.children].forEach((button, i) =>
      button.setAttribute('aria-pressed', String(draft[key] === options[i].id)));
    group.append(...options.map((option) => chip({
      label: option.label,
      pressed: draft[key] === option.id,
      onToggle: () => {
        draft[key] = allowNone && draft[key] === option.id ? null : option.id;
        paint();
      },
    })));
    return group;
  }

  function field(title, hint, control) {
    return h('fieldset', {}, h('legend', {}, title), h('p', { class: 'field-hint' }, hint), control);
  }

  function render(first) {
    dialog.replaceChildren(
      h('header', { class: 'sheet-head' },
        h('div', {},
          h('p', { class: 'eyebrow' }, first ? 'Welcome' : 'Tune the machine'),
          h('h2', { id: 'profile-title' }, first ? 'What are you drawn to?' : 'Your likes'))),
      h('form', { method: 'dialog', onSubmit: (event) => { event.preventDefault(); onSave(draft); dialog.close(); } },
        h('div', { class: 'sheet-body' },
          first && h('p', { class: 'lede' },
            'Curio Capsule is a machine full of objects: clothes, perfumes, books, bags, toys, vehicles and more. '
            + 'Tell it what you like and each capsule will lean your way. Pick as many or as few as you want.'),
          field('Categories', 'Favourites turn up more often. Leave empty to be open to everything.', multi('categories', CATEGORIES)),
          field('Vibes', 'The feel of things you are drawn to.', multi('vibes', VIBES.map((id) => ({ id, label: capitalise(id) })))),
          field('Today’s mood', 'Changes what drops today. You can switch it any time beside the machine.',
            single('mood', MOODS.map((id) => ({ id, label: capitalise(id) })), { allowNone: true })),
          field('Colours', 'Palettes you like to see.', multi('colours', COLOURS)),
          field('Budget', 'From everyday finds to dream objects.', single('budget', BUDGETS)),
          field('Shop in', 'Where the shop links on each card should take you.',
            h('select', { id: 'region', class: 'select', onChange: (event) => { draft.region = event.target.value; } },
              REGIONS.map((region) => h('option', { value: region.id, selected: region.id === draft.region }, region.label))))),
        h('footer', { class: 'sheet-foot' },
          h('span', { class: 'hint' }, 'Saved in this browser only.'),
          !first && h('button', { type: 'button', class: 'secondary', onClick: () => dialog.close() }, 'Cancel'),
          h('button', { type: 'submit', class: 'primary', id: 'save-profile' }, first ? 'Start pulling' : 'Save likes'))),
    );
  }

  return {
    open() {
      const profile = getProfile();
      draft = {
        categories: [...profile.categories], vibes: [...profile.vibes], colours: [...profile.colours],
        budget: profile.budget, mood: profile.mood, region: profile.region,
      };
      render(!profile.done);
      openDialog(dialog);
    },
  };
}

// One-line summary of the profile for the side panel.
export function describeProfile(profile) {
  const label = (list, id) => list.find((entry) => entry.id === id)?.label ?? id;
  const parts = [];
  if (profile.categories.length) parts.push(profile.categories.map((id) => label(CATEGORIES, id)).join(', '));
  if (profile.vibes.length) parts.push(profile.vibes.map(capitalise).join(', '));
  if (profile.colours.length) parts.push(profile.colours.map((id) => label(COLOURS, id)).join(', '));
  parts.push(`${label(BUDGETS, profile.budget)} budget`);
  if (profile.region) parts.push(`shops in ${regionById(profile.region).label}`);
  return parts.join(' · ');
}

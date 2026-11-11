// Tiny DOM helpers. Text is always set as text, never as HTML, so catalog content can't inject markup.

export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'style') element.style.cssText = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

export function chip({ label, pressed, onToggle, swatch, extra }) {
  const button = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(Boolean(pressed)) },
    swatch && h('span', { class: 'swatch', style: `background:${swatch}` }),
    h('span', {}, label),
    extra);
  button.addEventListener('click', () => onToggle(button));
  return button;
}

export const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1);

export function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  // Start at the heading rather than on whichever control happens to come first.
  const heading = dialog.querySelector('h2');
  if (heading) { heading.tabIndex = -1; heading.focus(); }
}

// Closes a dialog when its backdrop is clicked.
export function closeOnBackdrop(dialog) {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

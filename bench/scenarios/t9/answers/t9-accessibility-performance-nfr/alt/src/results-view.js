import { rowHtml } from './render.js';

export const ROWS_PER_PAGE = 50;

// Owns the table body and the "Show more" button. show(list) starts again at page one.
export function createResultsView({ tbody, moreButton, onChange }) {
  let list = [];
  let upTo = 0;

  const sync = () => {
    moreButton.hidden = upTo >= list.length;
    if (onChange) onChange({ total: list.length, shown: upTo });
  };

  moreButton.addEventListener('click', () => {
    const next = Math.min(upTo + ROWS_PER_PAGE, list.length);
    tbody.insertAdjacentHTML('beforeend', list.slice(upTo, next).map(rowHtml).join(''));
    upTo = next;
    sync();
  });

  return {
    show(next) {
      list = next;
      upTo = Math.min(ROWS_PER_PAGE, list.length);
      tbody.innerHTML = list.slice(0, upTo).map(rowHtml).join('');
      sync();
    },
  };
}

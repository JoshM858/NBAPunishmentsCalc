// The one sortable, dense table. Pages describe columns; this draws them. Clicks are handled by the page via
// data-sort (header) and data-row (row) attributes.
import { esc } from './dom.js';

/**
 * columns: [{ key, label, num?, sortable?, cell(row) -> html, cls?, title? }]
 * opts: { sort: { key, asc }, selected, rowKey(row), rowClass(row), empty }
 */
export function tableHtml(columns, rows, { sort, selected, rowKey = (r) => r.id, rowClass, empty = 'Nothing matches.', cls = '' } = {}) {
  const head = columns
    .map((c) => {
      const on = sort?.key === c.key;
      const aria = on ? ` aria-sort="${sort.asc ? 'ascending' : 'descending'}"` : '';
      return `<th scope="col" class="${c.num ? 'num ' : ''}${c.cls || ''}"${c.sortable ? ` data-sort="${esc(c.key)}"` : ''}${aria}${c.title ? ` title="${esc(c.title)}"` : ''}>${esc(c.label)}</th>`;
    })
    .join('');
  const body = rows.length
    ? rows
        .map((r) => {
          const key = rowKey(r);
          const klass = [selected != null && key === selected && 'sel', rowClass?.(r)].filter(Boolean).join(' ');
          return `<tr data-row="${esc(key)}" class="${klass}">${columns.map((c) => `<td class="${c.num ? 'num ' : ''}${c.cls || ''}">${c.cell(r)}</td>`).join('')}</tr>`;
        })
        .join('')
    : `<tr><td colspan="${columns.length}" class="empty">${esc(empty)}</td></tr>`;
  return `<div class="tbl-wrap"><table class="tbl sortable ${cls}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// Toggle a sort: a new column starts high-to-low (A-Z for text), the same column flips.
export function nextSort(sort, key, textKeys = ['name', 'team', 'pos']) {
  if (sort?.key === key) return { key, asc: !sort.asc };
  return { key, asc: textKeys.includes(key) };
}

export function pager(total, page, size) {
  const pages = Math.max(1, Math.ceil(total / size));
  const p = Math.min(Math.max(1, page), pages);
  return { page: p, pages, from: (p - 1) * size, to: Math.min(total, p * size), html: `<div class="pager"><button type="button" class="btn sm" data-page="${p - 1}"${p <= 1 ? ' disabled' : ''}>Prev</button><span>${total ? `${(p - 1) * size + 1}–${Math.min(total, p * size)} of ${total}` : '0'}</span><button type="button" class="btn sm" data-page="${p + 1}"${p >= pages ? ' disabled' : ''}>Next</button></div>` };
}

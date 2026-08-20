/**
 * Reusable pagination component (framework-agnostic, string-based rendering).
 *
 * Mirrors the UX of mature component libraries (Element UI / Ant Design):
 * numbered pages with ellipsis windowing, first/last jumps, prev/next,
 * and a "jump to page" input.
 */

export type PaginationItem = number | "ellipsis-start" | "ellipsis-end";

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i += 1) out.push(i);
  return out;
}

/**
 * Compute the list of page "slots" to display given the current page and total.
 * When the page count is large, collapses distant pages into ellipsis markers
 * while always keeping the first/last page and a window of siblings around
 * the current page.
 */
export function getPaginationWindow(current: number, total: number, siblingCount = 1): PaginationItem[] {
  const currentPage = clamp(current, 1, Math.max(total, 1));
  // When there is enough room to show every page (plus the two ellipsis
  // placeholders we never use), just list them all.
  const totalPageNumbers = siblingCount * 2 + 5;
  if (total <= totalPageNumbers) {
    return range(1, total);
  }

  const leftSiblingIndex = Math.max(currentPage - siblingCount, 1);
  const rightSiblingIndex = Math.min(currentPage + siblingCount, total);
  const shouldShowLeftDots = leftSiblingIndex > 2;
  const shouldShowRightDots = rightSiblingIndex < total - 1;

  if (!shouldShowLeftDots && shouldShowRightDots) {
    const leftItemCount = 3 + 2 * siblingCount;
    return [1, ...range(2, leftItemCount), "ellipsis-end", total];
  }

  if (shouldShowLeftDots && !shouldShowRightDots) {
    const rightItemCount = 3 + 2 * siblingCount;
    return [1, "ellipsis-start", ...range(total - rightItemCount + 1, total)];
  }

  return [1, "ellipsis-start", ...range(leftSiblingIndex, rightSiblingIndex), "ellipsis-end", total];
}

export interface RenderPaginationOptions {
  /** Currently active page (1-based). */
  current: number;
  /** Total number of pages. */
  total: number;
  /** How many page numbers to show on each side of the current page. */
  siblingCount?: number;
  /** HTML attribute applied to clickable page buttons (consumed by the host). */
  pageAttr?: string;
  /** Show the « / » first/last buttons. */
  showFirstLast?: boolean;
  /** Show the "jump to page" input form. */
  showJump?: boolean;
}

const ARROWS = {
  first: "«",
  prev: "‹",
  next: "›",
  last: "»",
} as const;

/**
 * Return the pagination bar as an HTML string.
 * Every navigable control carries the `pageAttr` so the host page can bind a
 * single delegated click handler; the jump form uses `data-content-jump`.
 */
export function renderPagination(options: RenderPaginationOptions): string {
  const {
    current,
    total,
    siblingCount = 1,
    pageAttr = "data-content-page",
    showFirstLast = true,
    showJump = true,
  } = options;

  if (total <= 1) return "";

  const currentPage = clamp(current, 1, total);
  const atFirst = currentPage <= 1;
  const atLast = currentPage >= total;
  const items = getPaginationWindow(currentPage, total, siblingCount);

  const numberButtons = items
    .map((slot) => {
      if (slot === "ellipsis-start" || slot === "ellipsis-end") {
        return `<span class="pagination-ellipsis" aria-hidden="true">…</span>`;
      }
      const isActive = slot === currentPage;
      return `<button type="button" class="pagination-page${isActive ? " active" : ""}" ${pageAttr}="${slot}"${
        isActive ? ' aria-current="page"' : ""
      }>${slot}</button>`;
    })
    .join("");

  const first = showFirstLast
    ? `<button type="button" class="pagination-nav" ${pageAttr}="1" ${atFirst ? "disabled" : ""} aria-label="第一页">${ARROWS.first}</button>`
    : "";
  const last = showFirstLast
    ? `<button type="button" class="pagination-nav" ${pageAttr}="${total}" ${atLast ? "disabled" : ""} aria-label="最后一页">${ARROWS.last}</button>`
    : "";
  const prev = `<button type="button" class="pagination-nav" ${pageAttr}="${currentPage - 1}" ${atFirst ? "disabled" : ""} aria-label="上一页">${ARROWS.prev}</button>`;
  const next = `<button type="button" class="pagination-nav" ${pageAttr}="${currentPage + 1}" ${atLast ? "disabled" : ""} aria-label="下一页">${ARROWS.next}</button>`;

  const jump = showJump
    ? `<form class="pagination-jump" data-content-jump>
        <label for="paginationJumpInput">跳至</label>
        <input id="paginationJumpInput" type="number" min="1" max="${total}" value="${currentPage}" inputmode="numeric" aria-label="跳转页码" />
        <span>页</span>
        <button type="submit" class="pagination-nav">前往</button>
      </form>`
    : "";

  return `<nav class="pagination" aria-label="分页导航">${first}${prev}${numberButtons}${next}${last}${jump}</nav>`;
}

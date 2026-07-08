import { useState, useEffect, useMemo } from 'react'

// Shared by every paginated table (Dispatch Board, Fleet, Crews) so the page-size
// choice and Prev/Next controls look and behave identically everywhere.
export const PAGE_SIZE_OPTIONS = [5, 10, 50]

export function usePagination(items, defaultSize = 10) {
  const [pageSize, setPageSize] = useState(defaultSize)
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  // Changing the page size (or having the list shrink under the current page,
  // e.g. after a filter/search) should never leave the view on a page that no
  // longer exists.
  useEffect(() => { setPage(0) }, [pageSize])
  useEffect(() => { if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1)) }, [pageCount, page])
  const paged = useMemo(() => items.slice(page * pageSize, page * pageSize + pageSize), [items, page, pageSize])
  return { page, setPage, pageSize, setPageSize, pageCount, paged }
}

export function PaginationBar({ page, setPage, pageCount, pageSize, setPageSize, total, itemLabel = 'items', suffix = '' }) {
  return (
    <div className="flex items-center justify-between mt-3 px-1 shrink-0 flex-wrap gap-2">
      <div className="text-[12px]" style={{ color: '#6B7280' }}>
        {total === 0 ? `0 ${itemLabel}` : (
          <>Showing {page * pageSize + 1}–{Math.min(total, page * pageSize + pageSize)} of {total}{suffix}</>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#6B7280' }}>
          <span>Show</span>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
            aria-label="Rows per page"
            className="h-7 pl-2 pr-1.5 rounded-lg text-[12px] font-semibold"
            style={{ background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(0,0,0,0.08)', color: '#374151' }}>
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
              className="h-7 px-2.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-35"
              style={{ background: 'rgba(255,255,255,0.9)', color: '#374151' }}>Prev</button>
            <span className="text-[12px] px-2" style={{ color: '#6B7280' }}>Page {page + 1} of {pageCount}</span>
            <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
              className="h-7 px-2.5 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-35"
              style={{ background: 'rgba(255,255,255,0.9)', color: '#374151' }}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}

import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { RULEBOOK_COMPENDIUM_DATABASE_PATH } from './paths'

export interface RulebookSummary {
  id: string
  title: string
  year: number | null
  rulesVersion: string
  filename: string
  pageCount: number
  indexedPageCount: number
}

export interface RulebookSearchResult {
  bookId: string
  bookTitle: string
  year: number | null
  pageNumber: number
  excerpt: string
}

function openDatabase(): DatabaseSync | null {
  if (!fs.existsSync(RULEBOOK_COMPENDIUM_DATABASE_PATH)) return null
  return new DatabaseSync(RULEBOOK_COMPENDIUM_DATABASE_PATH, { readOnly: true, timeout: 5000 })
}

function safeTerms(query: string): string[] {
  return String(query ?? '')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu)
    ?.slice(0, 12) ?? []
}

export function listRulebooks(): RulebookSummary[] {
  const database = openDatabase()
  if (!database) return []
  try {
    return (database.prepare(`
      SELECT id, title, year, rules_version, filename, page_count, indexed_page_count
      FROM books
      ORDER BY COALESCE(year, 0) DESC, title COLLATE NOCASE
    `).all() as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      year: Number.isFinite(Number(row.year)) ? Number(row.year) : null,
      rulesVersion: String(row.rules_version),
      filename: String(row.filename),
      pageCount: Number(row.page_count),
      indexedPageCount: Number(row.indexed_page_count),
    }))
  } finally {
    database.close()
  }
}

export function rulebookStatus() {
  const books = listRulebooks()
  return {
    ready: books.length > 0,
    bookCount: books.length,
    pageCount: books.reduce((sum, book) => sum + book.pageCount, 0),
    indexedPageCount: books.reduce((sum, book) => sum + book.indexedPageCount, 0),
    books,
  }
}

export function searchRulebooks(query: string, bookId = '', limit = 40): RulebookSearchResult[] {
  const terms = safeTerms(query)
  if (!terms.length) return []
  const database = openDatabase()
  if (!database) return []
  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit) || 40))
  const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(' AND ')
  try {
    const rows = database.prepare(`
      SELECT
        pages_fts.book_id,
        books.title,
        books.year,
        pages_fts.page_number,
        snippet(pages_fts, 0, '[', ']', ' … ', 38) AS excerpt
      FROM pages_fts
      JOIN books ON books.id = pages_fts.book_id
      WHERE pages_fts MATCH ?
        AND (? = '' OR pages_fts.book_id = ?)
      ORDER BY bm25(pages_fts), COALESCE(books.year, 0) DESC
      LIMIT ?
    `).all(match, bookId, bookId, boundedLimit) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      bookId: String(row.book_id),
      bookTitle: String(row.title),
      year: Number.isFinite(Number(row.year)) ? Number(row.year) : null,
      pageNumber: Number(row.page_number),
      excerpt: String(row.excerpt).replaceAll('[', '').replaceAll(']', ''),
    }))
  } finally {
    database.close()
  }
}

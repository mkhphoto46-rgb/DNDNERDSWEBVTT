export interface BackendCharacterCatalogOption {
  id: string
  name: string
  rulesVersion: string
  sourceId: string
  sourceTitle: string
  sourcePage: number | null
}

export interface BackendCharacterSubclassOption extends BackendCharacterCatalogOption {
  className: string
}

export interface BackendCharacterCatalog {
  ready: boolean
  classes: BackendCharacterCatalogOption[]
  subclasses: BackendCharacterSubclassOption[]
  species: BackendCharacterCatalogOption[]
  backgrounds: BackendCharacterCatalogOption[]
}

export interface BackendCatalogFamily {
  id: string
  label: string
  count: number
}

export interface BackendCatalogStatus {
  ready: boolean
  totalRecords: number
  families: BackendCatalogFamily[]
}

export interface BackendCatalogEntry {
  id: string
  name: string
  family: string
  category: string
  subcategory: string
  rulesVersion: string
  sourceId: string
  sourceTitle: string
  sourcePage: number | null
  validationScope: string
  summary: string
  structured: Record<string, unknown>
}

export function mergeCatalogNames(
  remoteNames: readonly string[],
  fallbackNames: readonly string[],
  currentValue = '',
): string[] {
  return [...new Set(
    [
      ...remoteNames,
      ...fallbackNames,
      currentValue,
    ]
      .map((value) => value.trim())
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right))
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase()
}

export function subclassNamesForClass(
  catalog: BackendCharacterCatalog | null,
  className: string,
  fallbackNames: readonly string[],
  currentValue = '',
): string[] {
  const classKey = normalized(className)
  const remoteNames = catalog?.subclasses
    .filter((option) => normalized(option.className) === classKey)
    .map((option) => option.name) ?? []

  return mergeCatalogNames(remoteNames, fallbackNames, currentValue)
}

export async function fetchBackendCharacterCatalog(
  signal?: AbortSignal,
): Promise<BackendCharacterCatalog> {
  const response = await fetch(
    '/api/library/character-options?rulesVersion=2024',
    {
      cache: 'no-store',
      signal,
    },
  )

  if (!response.ok) {
    throw new Error('Backend character catalog is unavailable.')
  }

  return response.json() as Promise<BackendCharacterCatalog>
}

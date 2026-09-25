export type ContentEntryType =
  | 'spell'
  | 'cantrip'
  | 'class-feature'
  | 'feat'
  | 'equipment'
  | 'weapon'
  | 'armor'
  | 'pack'
  | 'magic-item'
  | 'background'
  | 'poison'

export interface ContentLibraryEntry {
  id: string
  name: string
  type: ContentEntryType
  category: string
  sourceId: string
  sourceLabel: string
  rulesVersion: '2024' | '2014' | 'homebrew'
  rarity: string
  summary: string
  description: string
  tags: string[]
  facts: Array<{ label: string; value: string }>
}


import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeCatalogNames,
  subclassNamesForClass,
  type BackendCharacterCatalog,
} from './backendCatalog'

test('backend catalog merges remote names with safe local fallbacks', () => {
  assert.deepEqual(
    mergeCatalogNames(
      ['Wizard', 'Fighter'],
      ['Fighter', 'Cleric'],
      'Homebrew Class',
    ),
    ['Cleric', 'Fighter', 'Homebrew Class', 'Wizard'],
  )
})

test('subclass catalog is class-bounded and preserves the current value', () => {
  const catalog: BackendCharacterCatalog = {
    ready: true,
    classes: [],
    species: [],
    backgrounds: [],
    subclasses: [
      {
        id: 'sub-1',
        name: 'Battle Master',
        className: 'Fighter',
        rulesVersion: '2024',
        sourceId: 'phb',
        sourceTitle: "Player's Handbook",
        sourcePage: 1,
      },
      {
        id: 'sub-2',
        name: 'Evoker',
        className: 'Wizard',
        rulesVersion: '2024',
        sourceId: 'phb',
        sourceTitle: "Player's Handbook",
        sourcePage: 1,
      },
    ],
  }

  assert.deepEqual(
    subclassNamesForClass(
      catalog,
      'Fighter',
      ['Champion'],
      'Legacy Fighter Subclass',
    ),
    ['Battle Master', 'Champion', 'Legacy Fighter Subclass'],
  )
})

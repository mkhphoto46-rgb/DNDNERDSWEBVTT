import {
  OPEN_BACKGROUND_RULES,
  normalizedCatalogKey,
} from './characterCatalog'

import {
  SRD_FEATS,
  type SrdFeatRecord,
} from '../data/srdFeats.generated'

import {
  SRD_SPELLS,
  type SrdSpellRecord,
} from '../data/srdSpells.generated'

const FULL_CASTERS = new Set([
  'bard',
  'cleric',
  'druid',
  'sorcerer',
  'wizard',
])

const HALF_CASTERS = new Set([
  'paladin',
  'ranger',
])

function normalizedClass(value: string): string {
  return normalizedCatalogKey(value)
}

export function featById(id: string): SrdFeatRecord | null {
  return SRD_FEATS.find((feat) => feat.id === id) ?? null
}

export function spellById(id: string): SrdSpellRecord | null {
  return SRD_SPELLS.find((spell) => spell.id === id) ?? null
}

export function openFeatCatalog(): SrdFeatRecord[] {
  return [...SRD_FEATS].sort((a, b) =>
    a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
  )
}

export function openSpellCatalog(): SrdSpellRecord[] {
  return [...SRD_SPELLS].sort(
    (a, b) => a.level - b.level || a.name.localeCompare(b.name),
  )
}

export function featMeetsMinimumLevel(
  feat: Pick<SrdFeatRecord, 'minimumLevel'>,
  characterLevel: number,
): boolean {
  return feat.minimumLevel === null || characterLevel >= feat.minimumLevel
}

export function backgroundGrantedFeatName(background: string): string | null {
  return OPEN_BACKGROUND_RULES[background]?.feat ?? null
}

export function backgroundGrantedFeatRecord(
  background: string,
): SrdFeatRecord | null {
  const granted = backgroundGrantedFeatName(background)
  if (!granted) return null

  const baseName = granted.replace(/\s*\([^)]*\)\s*$/, '')
  const normalizedName = normalizedCatalogKey(baseName)

  return SRD_FEATS.find(
    (feat) => normalizedCatalogKey(feat.name) === normalizedName,
  ) ?? null
}

export function normalSpellLevelCap(
  className: string,
  characterLevel: number,
): number {
  const classKey = normalizedClass(className)
  const level = Math.max(1, Math.min(20, Math.round(characterLevel)))

  if (FULL_CASTERS.has(classKey)) {
    return Math.min(9, Math.floor((level + 1) / 2))
  }

  if (HALF_CASTERS.has(classKey)) {
    return Math.min(5, Math.floor((level + 3) / 4))
  }

  if (classKey === 'warlock') {
    return Math.min(5, Math.floor((level + 1) / 2))
  }

  return 0
}

export function warlockMysticArcanumCap(
  characterLevel: number,
): number {
  if (characterLevel >= 17) return 9
  if (characterLevel >= 15) return 8
  if (characterLevel >= 13) return 7
  if (characterLevel >= 11) return 6
  return 0
}

export function spellIsAvailableToCharacter(
  spell: Pick<SrdSpellRecord, 'classes' | 'level'>,
  className: string,
  characterLevel: number,
): boolean {
  const classKey = normalizedClass(className)
  if (!classKey) return false

  const onClassList = spell.classes.some(
    (entry) => normalizedCatalogKey(entry) === classKey,
  )
  if (!onClassList) return false

  if (spell.level === 0) return true

  const normalCap = normalSpellLevelCap(className, characterLevel)
  if (spell.level <= normalCap) return true

  if (classKey === 'warlock') {
    return spell.level <= warlockMysticArcanumCap(characterLevel)
  }

  return false
}

export function classSpellCatalog(
  className: string,
  characterLevel: number,
): SrdSpellRecord[] {
  return SRD_SPELLS
    .filter((spell) => spellIsAvailableToCharacter(spell, className, characterLevel))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
}

export function selectedSpells(
  spellIds: string[],
): SrdSpellRecord[] {
  return spellIds
    .map((spellId) => spellById(spellId))
    .filter((spell): spell is SrdSpellRecord => Boolean(spell))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
}

interface GrantedSpellRule {
  className: string
  subclassName?: string
  level: number
  spells: string[]
}

const FEATURE_GRANTED_SPELL_RULES: GrantedSpellRule[] = [
  { className: 'Bard', level: 20, spells: ['Power Word Heal', 'Power Word Kill'] },
  { className: 'Druid', level: 1, spells: ['Speak with Animals'] },
  { className: 'Paladin', level: 2, spells: ['Divine Smite'] },
  { className: 'Paladin', level: 5, spells: ['Find Steed'] },
  { className: 'Ranger', level: 1, spells: ["Hunter's Mark"] },
  { className: 'Warlock', level: 9, spells: ['Contact Other Plane'] },
  { className: 'Cleric', subclassName: 'Life Domain', level: 3, spells: ['Aid', 'Bless', 'Cure Wounds', 'Lesser Restoration'] },
  { className: 'Cleric', subclassName: 'Life Domain', level: 5, spells: ['Mass Healing Word', 'Revivify'] },
  { className: 'Cleric', subclassName: 'Life Domain', level: 7, spells: ['Aura of Life', 'Death Ward'] },
  { className: 'Cleric', subclassName: 'Life Domain', level: 9, spells: ['Greater Restoration', 'Mass Cure Wounds'] },
  { className: 'Paladin', subclassName: 'Oath of Devotion', level: 3, spells: ['Protection from Evil and Good', 'Shield of Faith'] },
  { className: 'Paladin', subclassName: 'Oath of Devotion', level: 5, spells: ['Aid', 'Zone of Truth'] },
  { className: 'Paladin', subclassName: 'Oath of Devotion', level: 9, spells: ['Beacon of Hope', 'Dispel Magic'] },
  { className: 'Paladin', subclassName: 'Oath of Devotion', level: 13, spells: ['Freedom of Movement', 'Guardian of Faith'] },
  { className: 'Paladin', subclassName: 'Oath of Devotion', level: 17, spells: ['Commune', 'Flame Strike'] },
  { className: 'Sorcerer', subclassName: 'Draconic Sorcery', level: 3, spells: ['Alter Self', 'Chromatic Orb', 'Command', "Dragon's Breath"] },
  { className: 'Sorcerer', subclassName: 'Draconic Sorcery', level: 5, spells: ['Fear', 'Fly'] },
  { className: 'Sorcerer', subclassName: 'Draconic Sorcery', level: 7, spells: ['Arcane Eye', 'Charm Monster'] },
  { className: 'Sorcerer', subclassName: 'Draconic Sorcery', level: 9, spells: ['Legend Lore', 'Summon Dragon'] },
  { className: 'Warlock', subclassName: 'Fiend Patron', level: 3, spells: ['Burning Hands', 'Command', 'Scorching Ray', 'Suggestion'] },
  { className: 'Warlock', subclassName: 'Fiend Patron', level: 5, spells: ['Fireball', 'Stinking Cloud'] },
  { className: 'Warlock', subclassName: 'Fiend Patron', level: 7, spells: ['Fire Shield', 'Wall of Fire'] },
  { className: 'Warlock', subclassName: 'Fiend Patron', level: 9, spells: ['Geas', 'Insect Plague'] },
]

/** Spells that the open 2024 class/subclass features explicitly keep prepared. */
export function featureGrantedSpells(
  className: string,
  subclassName: string,
  characterLevel: number,
): SrdSpellRecord[] {
  const classKey = normalizedCatalogKey(className)
  const subclassKey = normalizedCatalogKey(subclassName)
  const names = FEATURE_GRANTED_SPELL_RULES
    .filter((rule) =>
      normalizedCatalogKey(rule.className) === classKey &&
      rule.level <= characterLevel &&
      (!rule.subclassName || normalizedCatalogKey(rule.subclassName) === subclassKey),
    )
    .flatMap((rule) => rule.spells)
  const nameKeys = new Set(names.map(normalizedCatalogKey))

  return SRD_SPELLS
    .filter((spell) => nameKeys.has(normalizedCatalogKey(spell.name)))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
}

export function selectedFeats(
  featIds: string[],
): Array<{ feat: SrdFeatRecord; selectionIndex: number }> {
  return featIds
    .map((featId, selectionIndex) => ({
      feat: featById(featId),
      selectionIndex,
    }))
    .filter(
      (entry): entry is { feat: SrdFeatRecord; selectionIndex: number } =>
        Boolean(entry.feat),
    )
}

export function spellLevelLabel(level: number): string {
  return level === 0 ? 'Cantrip' : `Level ${level}`
}

export function spellMechanicSummary(spell: SrdSpellRecord): string[] {
  const result = [
    spellLevelLabel(spell.level),
    spell.school,
    spell.castingTime,
    spell.range,
  ]

  if (spell.concentration) result.push('Concentration')
  if (spell.ritual) result.push('Ritual')
  if (spell.damageType) result.push(`${spell.damageType} damage`)
  if (Object.keys(spell.healAtSlotLevel).length) result.push('Healing')

  return result.filter(Boolean)
}

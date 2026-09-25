import { normalizedCatalogKey } from './characterCatalog'
import type { CharacterSheetData } from '../types/actor'
import { spellById } from './characterRulesCatalog'

export type SpellChangeTiming = 'level-up' | 'long-rest' | 'long-rest-any' | 'never'

export interface SpellSelectionRules {
  maxKnownSpells: number
  maxPreparedSpells: number
  maxCantrips: number
  /** How a player can replace a spell already chosen for the class. */
  replacementTiming: SpellChangeTiming
  cantripReplacementTiming: SpellChangeTiming
  /** When new choices may be added to the class list. */
  newSpellTiming: 'level-up' | 'long-rest' | 'never'
  /** Maximum replacements during one Long Rest; null means any number. */
  longRestReplacementLimit: number | null
  wizardSpellbook: boolean
}

// Class-table counts from the 2024 SRD. Cantrips are tracked separately from
// level 1+ spells. Class-granted always-prepared spells do not use these slots.
const PREPARED_2024: Record<string, number[]> = {
  bard: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  cleric: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  druid: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  paladin: [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15],
  ranger: [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15],
  sorcerer: [2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  wizard: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25],
}

const CANTRIPS_2024: Record<string, number[]> = {
  bard: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  cleric: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  druid: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  paladin: Array(20).fill(0),
  ranger: Array(20).fill(0),
  sorcerer: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  warlock: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  wizard: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
}

const KNOWN_2014: Record<string, number[]> = {
  bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  ranger: [0, 2, 3, 3, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 12],
  sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
}

const CANTRIPS_2014: Record<string, number[]> = {
  bard: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  cleric: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  druid: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  sorcerer: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  warlock: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  wizard: [3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
}

function atLevel(values: number[], level: number): number {
  const index = Math.max(1, Math.min(20, Math.round(level))) - 1
  return values[index] ?? 0
}

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

export function spellSelectionRules(
  className: string,
  characterLevel: number,
  rulesVersion = '2024',
  spellcastingAbilityScore = 10,
): SpellSelectionRules {
  const key = normalizedCatalogKey(className)
  const level = Math.max(1, Math.min(20, Math.round(characterLevel)))
  const is2024 = rulesVersion !== '2014'
  const wizardSpellbook = key === 'wizard'

  if (is2024) {
    const maxPreparedSpells = atLevel(PREPARED_2024[key] ?? [], level)
    const maxKnownSpells = wizardSpellbook ? 6 + 2 * (level - 1) : maxPreparedSpells
    const maxCantrips = atLevel(CANTRIPS_2024[key] ?? [], level)
    const replacementTiming: SpellChangeTiming =
      ['bard', 'sorcerer', 'warlock'].includes(key) ? 'level-up'
        : ['cleric', 'druid', 'wizard'].includes(key) ? 'long-rest-any'
          : ['paladin', 'ranger'].includes(key) ? 'long-rest'
            : 'never'
    const cantripReplacementTiming: SpellChangeTiming =
      ['bard', 'cleric', 'druid', 'sorcerer', 'warlock'].includes(key) ? 'level-up'
        : key === 'wizard' ? 'long-rest'
          : 'never'
    const newSpellTiming = wizardSpellbook || ['bard', 'sorcerer', 'warlock'].includes(key)
      ? 'level-up'
      : maxPreparedSpells > 0 ? 'long-rest' : 'never'
    return {
      maxKnownSpells,
      maxPreparedSpells: wizardSpellbook ? maxPreparedSpells : maxKnownSpells,
      maxCantrips,
      replacementTiming,
      cantripReplacementTiming,
      newSpellTiming,
      longRestReplacementLimit: replacementTiming === 'long-rest-any' ? null : replacementTiming === 'long-rest' ? 1 : 0,
      wizardSpellbook,
    }
  }

  const replacementTiming: SpellChangeTiming =
    ['bard', 'ranger', 'sorcerer', 'warlock'].includes(key) ? 'level-up'
      : ['cleric', 'druid', 'paladin', 'wizard'].includes(key) ? 'long-rest-any'
        : 'never'
  let maxKnownSpells = atLevel(KNOWN_2014[key] ?? [], level)
  let maxPreparedSpells = maxKnownSpells
  if (['cleric', 'druid'].includes(key)) {
    maxPreparedSpells = Math.max(1, level + abilityModifier(spellcastingAbilityScore))
    maxKnownSpells = maxPreparedSpells
  } else if (key === 'paladin') {
    maxPreparedSpells = Math.max(1, Math.floor(level / 2) + abilityModifier(spellcastingAbilityScore))
    maxKnownSpells = maxPreparedSpells
  } else if (wizardSpellbook) {
    maxKnownSpells = 6 + 2 * (level - 1)
    maxPreparedSpells = Math.max(1, level + abilityModifier(spellcastingAbilityScore))
  }
  if (key === 'artificer') {
    maxPreparedSpells = Math.max(1, Math.ceil(level / 2) + abilityModifier(spellcastingAbilityScore))
    maxKnownSpells = maxPreparedSpells
  }

  const maxCantrips = atLevel(CANTRIPS_2014[key] ?? [], level)
  return {
    maxKnownSpells,
    maxPreparedSpells,
    maxCantrips,
    replacementTiming,
    cantripReplacementTiming: 'never',
    newSpellTiming: wizardSpellbook || ['bard', 'ranger', 'sorcerer', 'warlock'].includes(key)
      ? 'level-up'
      : maxPreparedSpells > 0 ? 'long-rest' : 'never',
    longRestReplacementLimit: replacementTiming === 'long-rest-any' ? null : 0,
    wizardSpellbook,
  }
}

export interface SpellSelectionAvailability {
  rules: SpellSelectionRules
  levelUpLevelsAvailable: number[]
  canAddLevelSpell: boolean
  canAddCantrip: boolean
  canRemoveLevelSpell: boolean
  canRemoveCantrip: boolean
  canPrepareLevelSpell: boolean
  canUnprepareLevelSpell: boolean
  longRestReplacementAvailable: boolean
  levelUpReplacementAvailable: boolean
  levelUpCantripReplacementAvailable: boolean
  remainingLevelUpSpellPicks: number
  remainingLevelUpCantripPicks: number
  knownLevelSpellCount: number
  knownCantripCount: number
  preparedLevelSpellCount: number
  summary: string
}

function canUseRestReplacement(
  rules: SpellSelectionRules,
  sheet: CharacterSheetData,
): boolean {
  if (!sheet.spellLongRestActive || !['long-rest', 'long-rest-any'].includes(rules.replacementTiming)) {
    return false
  }
  return rules.longRestReplacementLimit === null ||
    sheet.spellLongRestChangesUsed < rules.longRestReplacementLimit ||
    sheet.spellLongRestPendingReplacements > 0
}

export function spellSelectionAvailability(
  sheet: CharacterSheetData,
  characterLevel: number,
  spellcastingAbilityScore = 10,
): SpellSelectionAvailability {
  const rulesVersion = sheet.classRulesVersion === '2014' ? '2014' : '2024'
  const rules = spellSelectionRules(sheet.className, characterLevel, rulesVersion, spellcastingAbilityScore)
  const baseline = Math.max(1, Math.min(20, sheet.spellSelectionLevel || characterLevel))
  const currentLevel = Math.max(1, Math.min(20, Math.round(characterLevel)))
  const levelUpLevelsAvailable = Array.from(
    { length: Math.max(0, currentLevel - baseline) },
    (_, index) => baseline + index + 1,
  )
    .filter((level) => !(sheet.spellLevelUpReplacementsUsed ?? []).includes(level))
  const levelUpCantripLevelsAvailable = Array.from(
    { length: Math.max(0, currentLevel - baseline) },
    (_, index) => baseline + index + 1,
  )
    .filter((level) => !(sheet.spellLevelUpCantripReplacementsUsed ?? []).includes(level))
  const knownSpells = (sheet.knownSpellIds ?? [])
    .map((id) => spellById(id))
    .filter((spell) => spell !== null)
  const knownCantripCount = knownSpells.filter((spell) => spell!.level === 0).length
  const knownLevelSpellCount = knownSpells.filter((spell) => spell!.level > 0).length
  const preparedLevelSpellCount = (sheet.preparedSpellIds ?? [])
    .map((id) => spellById(id))
    .filter((spell) => spell && spell.level > 0).length
  const initialSelectionOpen = !sheet.spellSelectionInitialized
  const baselineRules = spellSelectionRules(sheet.className, baseline, rulesVersion, spellcastingAbilityScore)
  const levelUpNewSpellPicks = Math.max(
    0,
    rules.maxKnownSpells - baselineRules.maxKnownSpells - sheet.spellLevelUpNewPicksUsed,
  )
  const wizardNewSpellPicks = Math.max(
    0,
    2 * Math.max(0, currentLevel - baseline) - sheet.spellLevelUpNewPicksUsed,
  )
  const levelUpNewCantripPicks = Math.max(
    0,
    rules.maxCantrips - baselineRules.maxCantrips - sheet.spellLevelUpCantripPicksUsed,
  )
  const levelUpReplacementAvailable =
    rules.replacementTiming === 'level-up' && levelUpLevelsAvailable.length > 0
  const longRestReplacementAvailable = canUseRestReplacement(rules, sheet)
  const levelUpCantripReplacementAvailable =
    rules.cantripReplacementTiming === 'level-up' && levelUpCantripLevelsAvailable.length > 0
  const canRemoveLevelSpell = !rules.wizardSpellbook && (
    initialSelectionOpen || levelUpReplacementAvailable || (
      sheet.spellLongRestActive &&
      ['long-rest', 'long-rest-any'].includes(rules.replacementTiming) &&
      (rules.longRestReplacementLimit === null || sheet.spellLongRestChangesUsed < rules.longRestReplacementLimit)
    )
  )
  const canRemoveCantrip = initialSelectionOpen || levelUpCantripReplacementAvailable || (
    rules.cantripReplacementTiming === 'long-rest' &&
    sheet.spellLongRestActive && sheet.spellLongRestCantripChangesUsed < 1
  )
  const canAddLevelSpell = knownLevelSpellCount < rules.maxKnownSpells && (
    initialSelectionOpen ||
    (rules.wizardSpellbook && currentLevel > baseline && wizardNewSpellPicks > 0) ||
    (currentLevel > baseline && rules.newSpellTiming === 'level-up' && levelUpNewSpellPicks > 0) ||
    (sheet.spellLongRestActive && rules.newSpellTiming === 'long-rest' && (
      rules.longRestReplacementLimit === null ||
      sheet.spellLongRestChangesUsed < rules.longRestReplacementLimit ||
      sheet.spellLongRestPendingReplacements > 0
    )) ||
    (sheet.spellLevelUpPendingReplacements > 0 && currentLevel > baseline) ||
    (sheet.spellLongRestActive && sheet.spellLongRestPendingReplacements > 0)
  )
  const canAddCantrip = knownCantripCount < rules.maxCantrips && (
    initialSelectionOpen ||
    (currentLevel > baseline && levelUpNewCantripPicks > 0) ||
    (sheet.spellLevelUpPendingCantripReplacements > 0 && currentLevel > baseline) ||
    (sheet.spellLongRestActive && sheet.spellLongRestPendingCantripReplacements > 0)
  )
  const canPrepareLevelSpell = rules.wizardSpellbook && (
    initialSelectionOpen || (sheet.spellLongRestActive && preparedLevelSpellCount < rules.maxPreparedSpells)
  )
  const canUnprepareLevelSpell = rules.wizardSpellbook && (initialSelectionOpen || sheet.spellLongRestActive)
  const timingLabel = rules.replacementTiming === 'level-up' && levelUpReplacementAvailable
    ? `Level-up spell replacements: ${levelUpLevelsAvailable.length}`
    : rules.replacementTiming.startsWith('long-rest')
      ? sheet.spellLongRestActive
        ? rules.longRestReplacementLimit === null
          ? 'Long Rest active · any number of spell changes allowed'
          : `Long Rest active · ${Math.max(0, rules.longRestReplacementLimit - sheet.spellLongRestChangesUsed)} spell change(s) remaining`
        : `Spell changes allowed ${spellChangeTimingLabel(rules.replacementTiming)}`
      : `Spell changes allowed ${spellChangeTimingLabel(rules.replacementTiming)}`

  return {
    rules,
    levelUpLevelsAvailable,
    canAddLevelSpell,
    canAddCantrip,
    canRemoveLevelSpell,
    canRemoveCantrip,
    canPrepareLevelSpell,
    canUnprepareLevelSpell,
    longRestReplacementAvailable,
    levelUpReplacementAvailable,
    levelUpCantripReplacementAvailable,
    remainingLevelUpSpellPicks: rules.wizardSpellbook ? wizardNewSpellPicks : levelUpNewSpellPicks,
    remainingLevelUpCantripPicks: levelUpNewCantripPicks,
    knownLevelSpellCount,
    knownCantripCount,
    preparedLevelSpellCount,
    summary: timingLabel,
  }
}

export function spellChangeTimingLabel(timing: SpellChangeTiming): string {
  switch (timing) {
    case 'level-up': return 'when you gain a class level'
    case 'long-rest': return 'during a Long Rest (one spell)'
    case 'long-rest-any': return 'during a Long Rest (any number)'
    default: return 'not available for this class'
  }
}

function initialChoicesAreComplete(
  rules: SpellSelectionRules,
  knownSpellIds: string[],
  preparedSpellIds: string[],
): boolean {
  const records = knownSpellIds.map((id) => spellById(id)).filter((spell) => spell !== null)
  const cantrips = records.filter((spell) => spell!.level === 0).length
  const levelSpells = records.filter((spell) => spell!.level > 0).length
  const prepared = preparedSpellIds
    .map((id) => spellById(id))
    .filter((spell) => spell && spell.level > 0).length
  return cantrips >= rules.maxCantrips &&
    levelSpells >= rules.maxKnownSpells &&
    (!rules.wizardSpellbook || prepared >= rules.maxPreparedSpells)
}

export function addSelectedSpellPatch(
  sheet: CharacterSheetData,
  characterLevel: number,
  spellId: string,
  spellcastingAbilityScore = 10,
): Partial<CharacterSheetData> | null {
  const spell = spellById(spellId)
  if (!spell || (sheet.knownSpellIds ?? []).includes(spellId)) return null
  const access = spellSelectionAvailability(sheet, characterLevel, spellcastingAbilityScore)
  if (spell.level === 0 ? !access.canAddCantrip : !access.canAddLevelSpell) return null

  const knownSpellIds = [...(sheet.knownSpellIds ?? []), spellId]
  const preparedSpellIds = spell.level > 0 && !access.rules.wizardSpellbook
    ? [...new Set([...(sheet.preparedSpellIds ?? []), spellId])]
    : [...(sheet.preparedSpellIds ?? [])]
  const patch: Partial<CharacterSheetData> = { knownSpellIds, preparedSpellIds }

  if (spell.level === 0) {
    if (sheet.spellLevelUpPendingCantripReplacements > 0) {
      patch.spellLevelUpPendingCantripReplacements = sheet.spellLevelUpPendingCantripReplacements - 1
    } else if (sheet.spellLongRestPendingCantripReplacements > 0) {
      patch.spellLongRestPendingCantripReplacements = sheet.spellLongRestPendingCantripReplacements - 1
    } else if (access.remainingLevelUpCantripPicks > 0 && characterLevel > sheet.spellSelectionLevel) {
      patch.spellLevelUpCantripPicksUsed = sheet.spellLevelUpCantripPicksUsed + 1
    }
  } else if (sheet.spellLevelUpPendingReplacements > 0) {
    patch.spellLevelUpPendingReplacements = sheet.spellLevelUpPendingReplacements - 1
  } else if (sheet.spellLongRestPendingReplacements > 0) {
    patch.spellLongRestPendingReplacements = sheet.spellLongRestPendingReplacements - 1
  } else if (access.remainingLevelUpSpellPicks > 0 && characterLevel > sheet.spellSelectionLevel) {
    patch.spellLevelUpNewPicksUsed = sheet.spellLevelUpNewPicksUsed + 1
  } else if (
    sheet.spellLongRestActive && access.rules.newSpellTiming === 'long-rest' &&
    access.rules.longRestReplacementLimit !== null
  ) {
    patch.spellLongRestChangesUsed = sheet.spellLongRestChangesUsed + 1
  }

  patch.spellSelectionInitialized = sheet.spellSelectionInitialized || initialChoicesAreComplete(
    access.rules,
    knownSpellIds,
    preparedSpellIds,
  )
  return patch
}

export function removeSelectedSpellPatch(
  sheet: CharacterSheetData,
  characterLevel: number,
  spellId: string,
  spellcastingAbilityScore = 10,
): Partial<CharacterSheetData> | null {
  if (!(sheet.knownSpellIds ?? []).includes(spellId)) return null
  const spell = spellById(spellId)
  if (!spell) return null
  const access = spellSelectionAvailability(sheet, characterLevel, spellcastingAbilityScore)
  if (spell.level === 0 ? !access.canRemoveCantrip : !access.canRemoveLevelSpell) return null

  const patch: Partial<CharacterSheetData> = {
    knownSpellIds: (sheet.knownSpellIds ?? []).filter((id) => id !== spellId),
    preparedSpellIds: (sheet.preparedSpellIds ?? []).filter((id) => id !== spellId),
    concentratingSpellId: sheet.concentratingSpellId === spellId ? '' : sheet.concentratingSpellId,
  }
  const baseline = sheet.spellSelectionLevel || characterLevel
  if (spell.level === 0) {
    const replacementLevel = access.rules.cantripReplacementTiming === 'level-up'
      ? access.levelUpLevelsAvailable.find((level) => !(sheet.spellLevelUpCantripReplacementsUsed ?? []).includes(level))
      : undefined
    if (replacementLevel) {
      patch.spellLevelUpCantripReplacementsUsed = [...(sheet.spellLevelUpCantripReplacementsUsed ?? []), replacementLevel]
      patch.spellLevelUpPendingCantripReplacements = sheet.spellLevelUpPendingCantripReplacements + 1
    } else if (access.rules.cantripReplacementTiming === 'long-rest' && sheet.spellLongRestActive) {
      patch.spellLongRestCantripChangesUsed = sheet.spellLongRestCantripChangesUsed + 1
      patch.spellLongRestPendingCantripReplacements = sheet.spellLongRestPendingCantripReplacements + 1
    }
  } else {
    const replacementLevel = access.rules.replacementTiming === 'level-up'
      ? Array.from({ length: Math.max(0, characterLevel - baseline) }, (_, index) => baseline + index + 1)
        .find((level) => !(sheet.spellLevelUpReplacementsUsed ?? []).includes(level))
      : undefined
    if (replacementLevel) {
      patch.spellLevelUpReplacementsUsed = [...(sheet.spellLevelUpReplacementsUsed ?? []), replacementLevel]
      patch.spellLevelUpPendingReplacements = sheet.spellLevelUpPendingReplacements + 1
    } else if (sheet.spellLongRestActive && ['long-rest', 'long-rest-any'].includes(access.rules.replacementTiming)) {
      const used = sheet.spellLongRestChangesUsed
      if (access.rules.longRestReplacementLimit === null || used < access.rules.longRestReplacementLimit) {
        patch.spellLongRestChangesUsed = used + 1
        patch.spellLongRestPendingReplacements = sheet.spellLongRestPendingReplacements + 1
      }
    }
  }
  return patch
}

export function togglePreparedSpellPatch(
  sheet: CharacterSheetData,
  characterLevel: number,
  spellId: string,
  prepared: boolean,
  spellcastingAbilityScore = 10,
): Partial<CharacterSheetData> | null {
  const spell = spellById(spellId)
  if (!spell || spell.level === 0 || !(sheet.knownSpellIds ?? []).includes(spellId)) return null
  const access = spellSelectionAvailability(sheet, characterLevel, spellcastingAbilityScore)
  const preparedSpellIds = sheet.preparedSpellIds ?? []
  const currentlyPrepared = preparedSpellIds.includes(spellId)
  if (prepared === currentlyPrepared) return null

  if (prepared) {
    if (!access.canPrepareLevelSpell || access.preparedLevelSpellCount >= access.rules.maxPreparedSpells) return null
    const nextPreparedSpellIds = [...new Set([...preparedSpellIds, spellId])]
    return {
      preparedSpellIds: nextPreparedSpellIds,
      spellSelectionInitialized: sheet.spellSelectionInitialized || initialChoicesAreComplete(
        access.rules,
        sheet.knownSpellIds ?? [],
        nextPreparedSpellIds,
      ),
    }
  }

  if (!access.canUnprepareLevelSpell) return null
  const nextPreparedSpellIds = preparedSpellIds.filter((id) => id !== spellId)
  return {
    preparedSpellIds: nextPreparedSpellIds,
    spellSelectionInitialized: sheet.spellSelectionInitialized || initialChoicesAreComplete(
      access.rules,
      sheet.knownSpellIds ?? [],
      nextPreparedSpellIds,
    ),
  }
}

export function endLongRestPatch(): Partial<CharacterSheetData> {
  return {
    spellLongRestActive: false,
    spellLongRestPendingReplacements: 0,
    spellLongRestPendingCantripReplacements: 0,
  }
}

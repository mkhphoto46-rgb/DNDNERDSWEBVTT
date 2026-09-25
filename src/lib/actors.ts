import {
  abilityModifier,
  proficiencyBonus,
} from '../rules/dnd2024'

import {
  DEFAULT_ACTOR_ABILITIES,
  DEFAULT_CHARACTER_SHEET,
  DAMAGE_TYPES,
  type Actor,
  type ActorAbility,
  type ActorAbilityScores,
  type ActorKind,
  type ActorLifeState,
  type DeathRulesMode,
  type CharacterSheetData,
  type CharacterSkill,
  type DamageType,
} from '../types/actor'

import {
  type SceneToken,
  type TokenAsset,
} from '../types/scene'

import {
  normalizeGridIndex,
} from './mapGridBounds'

import {
  extractSimpleDamageTypes,
} from './damage'

import {
  normalizeActorEffects,
} from './effects'
import { normalizeAttackProfiles } from './combatActions'

export const DEFAULT_ACTOR_LEVEL = 1
export const DEFAULT_ACTOR_HP = 10
export const DEFAULT_ACTOR_AC = 10
export const DEFAULT_ACTOR_SPEED_FEET = 30
export const DEFAULT_ACTOR_VISION_RANGE_FEET = 60

type ActorInput = Omit<
  Actor,
  | 'lifeState'
  | 'deathSaveSuccesses'
  | 'deathSaveFailures'
  | 'deathRules'
  | 'lastDeathSaveRound'
> & Partial<Pick<
  Actor,
  | 'lifeState'
  | 'deathSaveSuccesses'
  | 'deathSaveFailures'
  | 'deathRules'
  | 'lastDeathSaveRound'
>>


const ABILITIES: ReadonlySet<string> = new Set([
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
])

const DAMAGE_TYPE_SET: ReadonlySet<string> = new Set(DAMAGE_TYPES)

function safeDeathRules(
  value: unknown,
  kind: ActorKind,
): DeathRulesMode {
  if (kind === 'player') return 'character'
  return value === 'character' ? 'character' : 'monster'
}

function nullableRound(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.round(parsed)
    : null
}

function safeLifeState(
  value: unknown,
  currentHp: number,
  deathRules: DeathRulesMode,
): ActorLifeState {
  if (currentHp > 0) return 'conscious'
  if (deathRules === 'monster') return 'dead'
  return value === 'unconscious' || value === 'stable' || value === 'dead'
    ? value
    : 'unconscious'
}

const SKILLS: ReadonlySet<string> = new Set([
  'acrobatics',
  'animalHandling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleightOfHand',
  'stealth',
  'survival',
])

function finiteNumber(
  value: unknown,
  fallback: number,
): number {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? parsed
    : fallback
}

function integerInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(
      max,
      Math.round(
        finiteNumber(
          value,
          fallback,
        ),
      ),
    ),
  )
}

function nonNegativeInteger(
  value: unknown,
  fallback: number,
): number {
  return Math.max(
    0,
    Math.round(
      finiteNumber(
        value,
        fallback,
      ),
    ),
  )
}

function positiveSpeed(
  value: unknown,
): number {
  const parsed =
    nonNegativeInteger(
      value,
      DEFAULT_ACTOR_SPEED_FEET,
    )

  return parsed > 0
    ? parsed
    : DEFAULT_ACTOR_SPEED_FEET
}

function safeActorKind(
  value: unknown,
): ActorKind {
  return value === 'player' ||
    value === 'npc' ||
    value === 'enemy'
    ? value
    : 'enemy'
}

export function isPlayerControlledActor(
  actor: Pick<Actor, 'kind' | 'ownerId'>,
): boolean {
  return actor.kind === 'player' || Boolean(actor.ownerId)
}

function safeString(
  value: unknown,
  fallback: string,
): string {
  const candidate =
    typeof value === 'string'
      ? value.trim()
      : ''

  return candidate || fallback
}

function optionalString(
  value: unknown,
): string | null {
  const candidate =
    typeof value === 'string'
      ? value.trim()
      : ''

  return candidate || null
}

function normalizeAbilities(
  value: unknown,
): ActorAbilityScores {
  const input =
    value &&
    typeof value === 'object'
      ? value as Partial<ActorAbilityScores>
      : {}

  return {
    strength: integerInRange(input.strength, 10, 1, 30),
    dexterity: integerInRange(input.dexterity, 10, 1, 30),
    constitution: integerInRange(input.constitution, 10, 1, 30),
    intelligence: integerInRange(input.intelligence, 10, 1, 30),
    wisdom: integerInRange(input.wisdom, 10, 1, 30),
    charisma: integerInRange(input.charisma, 10, 1, 30),
  }
}

function normalizeAbilityList(value: unknown): ActorAbility[] {
  if (!Array.isArray(value)) return []

  return [...new Set(
    value.filter(
      (entry): entry is ActorAbility =>
        typeof entry === 'string' &&
        ABILITIES.has(entry as ActorAbility),
    ),
  )]
}

function normalizeSkillList(value: unknown): CharacterSkill[] {
  if (!Array.isArray(value)) return []

  return [...new Set(
    value.filter(
      (entry): entry is CharacterSkill =>
        typeof entry === 'string' &&
        SKILLS.has(entry as CharacterSkill),
    ),
  )]
}

function normalizeDefenseSelections(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 24)
      .map(([rawKey, rawValue]) => [
        rawKey.trim().slice(0, 80),
        typeof rawValue === 'string' ? rawValue.trim().slice(0, 80) : '',
      ])
      .filter(([entryKey, entryValue]) => Boolean(entryKey && entryValue)),
  )
}

function normalizeActiveDefenseFeatures(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return [...new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim().slice(0, 80))
      .filter(Boolean),
  )].slice(0, 24)
}

function normalizeStringIdList(
  value: unknown,
  limit: number,
  dedupe = true,
): string[] {
  if (!Array.isArray(value)) return []

  const cleaned = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().slice(0, 120))
    .filter(Boolean)

  return (dedupe ? [...new Set(cleaned)] : cleaned).slice(0, limit)
}

function normalizeDamageTypes(value: unknown): DamageType[] {
  if (!Array.isArray(value)) return []

  return [...new Set(
    value
      .map((entry) => String(entry ?? '').trim().toLowerCase())
      .filter((entry): entry is DamageType => DAMAGE_TYPE_SET.has(entry)),
  )]
}

export function normalizeCharacterSheet(
  value: unknown,
  fallbackSpellSelectionLevel = 1,
): CharacterSheetData {
  const input =
    value && typeof value === 'object'
      ? value as Partial<CharacterSheetData>
      : {}

  const proficiencies = normalizeSkillList(input.skillProficiencies)
  const expertise = normalizeSkillList(input.skillExpertise)
  const knownSpellIds = normalizeStringIdList(input.knownSpellIds, 300)
  const preparedSpellIds = normalizeStringIdList(input.preparedSpellIds, 150)
    .filter((spellId) => knownSpellIds.includes(spellId))
  const spentSpellSlots = Array.isArray(input.spentSpellSlots)
    ? input.spentSpellSlots
        .slice(0, 9)
        .map((entry) => nonNegativeInteger(entry, 0))
    : []
  const spellLevelUpReplacementsUsed = Array.isArray(input.spellLevelUpReplacementsUsed)
    ? [...new Set(input.spellLevelUpReplacementsUsed.map((entry) => nonNegativeInteger(entry, 0)).filter((entry) => entry > 0))].slice(0, 20)
    : []
  const spellLevelUpCantripReplacementsUsed = Array.isArray(input.spellLevelUpCantripReplacementsUsed)
    ? [...new Set(input.spellLevelUpCantripReplacementsUsed.map((entry) => nonNegativeInteger(entry, 0)).filter((entry) => entry > 0))].slice(0, 20)
    : []
  const concentratingSpellId =
    typeof input.concentratingSpellId === 'string' &&
    knownSpellIds.includes(input.concentratingSpellId)
      ? input.concentratingSpellId
      : ''

  return {
    className: safeString(input.className, ''),
    classOptionId: safeString(input.classOptionId, ''),
    classRulesVersion: safeString(input.classRulesVersion, ''),
    subclassName: safeString(input.subclassName, ''),
    subclassOptionId: safeString(input.subclassOptionId, ''),
    species: safeString(input.species, ''),
    speciesOptionId: safeString(input.speciesOptionId, ''),
    background: safeString(input.background, ''),
    backgroundOptionId: safeString(input.backgroundOptionId, ''),
    alignment: safeString(input.alignment, ''),
    experiencePoints: nonNegativeInteger(input.experiencePoints, 0),
    savingThrowProficiencies: normalizeAbilityList(input.savingThrowProficiencies),
    skillProficiencies: [...new Set([...proficiencies, ...expertise])],
    skillExpertise: expertise,
    defenseSelections: normalizeDefenseSelections(input.defenseSelections),
    activeDefenseFeatures: normalizeActiveDefenseFeatures(input.activeDefenseFeatures),
    selectedFeatIds: normalizeStringIdList(input.selectedFeatIds, 48, false),
    knownSpellIds,
    preparedSpellIds,
    spentSpellSlots,
    hitDiceSpent: integerInRange(input.hitDiceSpent, 0, 0, Math.min(20, fallbackSpellSelectionLevel)),
    shortRestActive: input.shortRestActive === true,
    shortRestHitDiceDone: input.shortRestHitDiceDone === true,
    spellSelectionLevel: integerInRange(input.spellSelectionLevel, fallbackSpellSelectionLevel, 1, 20),
    spellLevelUpReplacementsUsed,
    spellLevelUpPendingReplacements: nonNegativeInteger(input.spellLevelUpPendingReplacements, 0),
    spellLevelUpPendingCantripReplacements: nonNegativeInteger(input.spellLevelUpPendingCantripReplacements, 0),
    spellLevelUpNewPicksUsed: nonNegativeInteger(input.spellLevelUpNewPicksUsed, 0),
    spellLevelUpCantripPicksUsed: nonNegativeInteger(input.spellLevelUpCantripPicksUsed, 0),
    spellLevelUpCantripReplacementsUsed,
    spellLongRestActive: input.spellLongRestActive === true,
    spellLongRestChangesUsed: nonNegativeInteger(input.spellLongRestChangesUsed, 0),
    spellLongRestPendingReplacements: nonNegativeInteger(input.spellLongRestPendingReplacements, 0),
    spellLongRestPendingCantripReplacements: nonNegativeInteger(input.spellLongRestPendingCantripReplacements, 0),
    spellLongRestCantripChangesUsed: nonNegativeInteger(input.spellLongRestCantripChangesUsed, 0),
    spellSelectionInitialized: typeof input.spellSelectionInitialized === 'boolean'
      ? input.spellSelectionInitialized
      : knownSpellIds.length > 0,
    concentratingSpellId,
    notes:
      typeof input.notes === 'string'
        ? input.notes.slice(0, 8000)
        : '',
  }
}

export function monsterProficiencyBonus(
  challengeRating: number | null,
): number {
  if (challengeRating === null) return 2

  const cr = Math.max(0, Math.min(30, challengeRating))

  if (cr <= 4) return 2
  if (cr <= 8) return 3
  if (cr <= 12) return 4
  if (cr <= 16) return 5
  if (cr <= 20) return 6
  if (cr <= 24) return 7
  if (cr <= 28) return 8
  return 9
}

export function normalizeActor(
  actor: ActorInput,
): Actor {
  const level =
    integerInRange(
      actor.level,
      DEFAULT_ACTOR_LEVEL,
      1,
      30,
    )

  const maxHp =
    Math.max(
      1,
      nonNegativeInteger(
        actor.maxHp,
        DEFAULT_ACTOR_HP,
      ),
    )

  const currentHp =
    Math.min(
      maxHp,
      nonNegativeInteger(
        actor.currentHp,
        maxHp,
      ),
    )

  const rawCr =
    actor.challengeRating === null || actor.challengeRating === undefined
      ? null
      : finiteNumber(
          actor.challengeRating,
          0,
        )

  const challengeRating =
    rawCr === null
      ? null
      : Math.max(
          0,
          Math.min(
            30,
            rawCr,
          ),
        )

  const ownerId = optionalString(actor.ownerId)
  const kind: ActorKind = ownerId
    ? 'player'
    : safeActorKind(actor.kind)
  const deathRules = safeDeathRules(actor.deathRules, kind)
  let lifeState = safeLifeState(actor.lifeState, currentHp, deathRules)
  let deathSaveSuccesses = integerInRange(actor.deathSaveSuccesses, 0, 0, 3)
  let deathSaveFailures = integerInRange(actor.deathSaveFailures, 0, 0, 3)
  let lastDeathSaveRound = nullableRound(actor.lastDeathSaveRound)

  if (lifeState === 'conscious') {
    deathSaveSuccesses = 0
    deathSaveFailures = 0
    lastDeathSaveRound = null
  } else if (lifeState === 'stable') {
    deathSaveSuccesses = 0
    deathSaveFailures = 0
    lastDeathSaveRound = null
  } else if (lifeState === 'unconscious') {
    if (deathSaveFailures >= 3) {
      lifeState = 'dead'
      lastDeathSaveRound = null
    } else if (deathSaveSuccesses >= 3) {
      lifeState = 'stable'
      deathSaveSuccesses = 0
      deathSaveFailures = 0
      lastDeathSaveRound = null
    }
  } else if (lifeState === 'dead') {
    lastDeathSaveRound = null
  }

  const derivedProficiency =
    kind === 'player'
      ? proficiencyBonus(Math.min(20, level))
      : monsterProficiencyBonus(challengeRating)

  const characterSheet =
      kind === 'player'
        ? normalizeCharacterSheet(
          actor.characterSheet ?? {
            ...DEFAULT_CHARACTER_SHEET,
            spellSelectionLevel: level,
          },
          level,
        )
      : actor.characterSheet
        ? normalizeCharacterSheet(actor.characterSheet, level)
        : null

  const sourceTemplateId = optionalString(actor.sourceTemplateId)
  const importedMonsterStatBlock =
    actor.monsterStatBlock && typeof actor.monsterStatBlock === 'object'
      ? actor.monsterStatBlock
      : null

  const importedPortraitUrl = sourceTemplateId
    ? `/api/compendium/monsters/${encodeURIComponent(sourceTemplateId)}/portrait`
    : ''

  const portraitUrl = safeString(actor.portraitUrl, importedPortraitUrl)
  const portraitAssetId = safeString(
    actor.portraitAssetId,
    sourceTemplateId ? `compendium:${sourceTemplateId}` : '',
  )

  const damageResistances = Array.isArray(actor.damageResistances)
    ? normalizeDamageTypes(actor.damageResistances)
    : extractSimpleDamageTypes(importedMonsterStatBlock?.damage_resistances)

  const damageImmunities = Array.isArray(actor.damageImmunities)
    ? normalizeDamageTypes(actor.damageImmunities)
    : extractSimpleDamageTypes(importedMonsterStatBlock?.damage_immunities)

  const damageVulnerabilities = Array.isArray(actor.damageVulnerabilities)
    ? normalizeDamageTypes(actor.damageVulnerabilities)
    : extractSimpleDamageTypes(importedMonsterStatBlock?.damage_vulnerabilities)

  return {
    id: safeString(actor.id, 'actor'),
    name: safeString(actor.name, 'Unnamed Actor'),
    kind,
    ownerId,
    portraitAssetId,
    portraitUrl,
    level,
    challengeRating,
    currentHp,
    maxHp,
    tempHp: nonNegativeInteger(actor.tempHp, 0),
    lifeState,
    deathSaveSuccesses,
    deathSaveFailures,
    deathRules,
    lastDeathSaveRound,
    ac: integerInRange(actor.ac, DEFAULT_ACTOR_AC, 0, 40),
    speedFeet: positiveSpeed(actor.speedFeet),
    visionRangeFeet: integerInRange(actor.visionRangeFeet, DEFAULT_ACTOR_VISION_RANGE_FEET, 5, 1000),
    initiativeBonus:
      kind === 'player'
        ? abilityModifier(normalizeAbilities(actor.abilities).dexterity)
        : integerInRange(actor.initiativeBonus, 0, -20, 20),
    proficiencyBonus: derivedProficiency,
    abilities: normalizeAbilities(actor.abilities),
    conditions:
      Array.isArray(actor.conditions)
        ? actor.conditions
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [],
    effects: normalizeActorEffects(actor.effects),
    resources:
      Array.isArray(actor.resources)
        ? actor.resources
            .filter((resource) => Boolean(resource && typeof resource === 'object'))
            .map((resource) => ({
              id: safeString(resource.id, 'resource'),
              name: safeString(resource.name, 'Resource'),
              current: nonNegativeInteger(resource.current, 0),
              max: nonNegativeInteger(resource.max, 0),
              recharge:
                resource.recharge === 'short-rest' ||
                resource.recharge === 'long-rest'
                  ? resource.recharge
                  : 'manual' as const,
            }))
        : [],
    combatActions: normalizeAttackProfiles(actor.combatActions),
    damageResistances,
    damageImmunities,
    damageVulnerabilities,
    sourceTemplateId,
    source: optionalString(actor.source),
    creatureSize: safeString(actor.creatureSize, ''),
    creatureType: safeString(actor.creatureType, ''),
    hitPointFormula: safeString(actor.hitPointFormula, ''),
    monsterStatBlock: importedMonsterStatBlock,
    characterSheet,
    gmNotes:
      typeof actor.gmNotes === 'string'
        ? actor.gmNotes
        : '',
  }
}

export function nextActorName(
  baseName: string,
  actors: Actor[],
): string {
  const cleanBase =
    baseName
      .replace(/\.[^.]+$/, '')
      .trim() || 'Token'

  const used =
    new Set(
      actors.map(
        (actor) =>
          actor.name
            .trim()
            .toLowerCase(),
      ),
    )

  if (!used.has(cleanBase.toLowerCase())) {
    return cleanBase
  }

  for (
    let suffix = 2;
    suffix < 10000;
    suffix += 1
  ) {
    const candidate = `${cleanBase} ${suffix}`

    if (!used.has(candidate.toLowerCase())) {
      return candidate
    }
  }

  return `${cleanBase} ${Date.now()}`
}


export function createBlankPlayerActor(
  options: {
    id: string
    name: string
    ownerId: string
  },
): Actor {
  return normalizeActor({
    id: options.id,
    name: options.name,
    kind: 'player',
    ownerId: options.ownerId,
    portraitAssetId: 'builtin:adventurer-token',
    portraitUrl: '/assets/tokens/adventurer-token.svg',
    level: DEFAULT_ACTOR_LEVEL,
    challengeRating: null,
    currentHp: DEFAULT_ACTOR_HP,
    maxHp: DEFAULT_ACTOR_HP,
    tempHp: 0,
    lifeState: 'conscious',
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    deathRules: 'character',
    lastDeathSaveRound: null,
    ac: DEFAULT_ACTOR_AC,
    speedFeet: DEFAULT_ACTOR_SPEED_FEET,
    initiativeBonus: 0,
    proficiencyBonus: proficiencyBonus(DEFAULT_ACTOR_LEVEL),
    abilities: { ...DEFAULT_ACTOR_ABILITIES },
    conditions: [],
    effects: [],
    resources: [],
    sourceTemplateId: null,
    source: null,
    creatureSize: 'Medium',
    creatureType: 'player character',
    hitPointFormula: '',
    monsterStatBlock: null,
    characterSheet: { ...DEFAULT_CHARACTER_SHEET },
    gmNotes: '',
  })
}

export function createFreshActorFromAsset(
  asset: TokenAsset,
  options: {
    id: string
    name: string
    kind?: ActorKind
    ownerId?: string | null
  },
): Actor {
  const kind = options.kind ?? 'enemy'

  return normalizeActor({
    id: options.id,
    name: options.name,
    kind,
    ownerId: options.ownerId ?? null,
    portraitAssetId: asset.id,
    portraitUrl: asset.url,
    level: DEFAULT_ACTOR_LEVEL,
    challengeRating: null,
    currentHp: DEFAULT_ACTOR_HP,
    maxHp: DEFAULT_ACTOR_HP,
    tempHp: 0,
    lifeState: 'conscious',
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    deathRules: kind === 'player' ? 'character' : 'monster',
    lastDeathSaveRound: null,
    ac: DEFAULT_ACTOR_AC,
    speedFeet: DEFAULT_ACTOR_SPEED_FEET,
    initiativeBonus: 0,
    proficiencyBonus: proficiencyBonus(DEFAULT_ACTOR_LEVEL),
    abilities: { ...DEFAULT_ACTOR_ABILITIES },
    conditions: [],
    effects: [],
    resources: [],
    sourceTemplateId: null,
    source: null,
    creatureSize: '',
    creatureType: '',
    hitPointFormula: '',
    monsterStatBlock: null,
    characterSheet:
      kind === 'player'
        ? { ...DEFAULT_CHARACTER_SHEET }
        : null,
    gmNotes: '',
  })
}

function actorFromLegacyToken(
  token: SceneToken,
): Actor {
  const level =
    integerInRange(
      token.level,
      DEFAULT_ACTOR_LEVEL,
      1,
      30,
    )

  const kind: ActorKind = token.ownerId ? 'player' : 'enemy'

  return normalizeActor({
    id:
      typeof token.actorId === 'string' && token.actorId
        ? token.actorId
        : `actor-${token.id}`,
    name: safeString(token.name, 'Token'),
    kind,
    ownerId:
      typeof token.ownerId === 'string' && token.ownerId
        ? token.ownerId
        : null,
    portraitAssetId: token.assetId,
    portraitUrl: token.imageUrl,
    level,
    challengeRating: null,
    currentHp: DEFAULT_ACTOR_HP,
    maxHp: DEFAULT_ACTOR_HP,
    tempHp: 0,
    lifeState: 'conscious',
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    deathRules: kind === 'player' ? 'character' : 'monster',
    lastDeathSaveRound: null,
    ac: DEFAULT_ACTOR_AC,
    speedFeet: positiveSpeed(token.speedFeet),
    initiativeBonus: 0,
    proficiencyBonus: proficiencyBonus(Math.min(20, level)),
    abilities: { ...DEFAULT_ACTOR_ABILITIES },
    conditions: [],
    effects: [],
    resources: [],
    sourceTemplateId: null,
    source: null,
    creatureSize: '',
    creatureType: '',
    hitPointFormula: '',
    monsterStatBlock: null,
    characterSheet:
      kind === 'player'
        ? { ...DEFAULT_CHARACTER_SHEET }
        : null,
    gmNotes: '',
  })
}

export function migrateActorState(
  actorsInput: Actor[] | undefined,
  tokensInput: SceneToken[] | undefined,
): {
  actors: Actor[]
  tokens: SceneToken[]
} {
  const actors =
    Array.isArray(actorsInput)
      ? actorsInput.map(normalizeActor)
      : []

  const actorMap =
    new Map(
      actors.map(
        (actor) => [actor.id, actor],
      ),
    )

  const tokens =
    Array.isArray(tokensInput)
      ? tokensInput.map((token) => {
          const actorId =
            typeof token.actorId === 'string' && token.actorId
              ? token.actorId
              : `actor-${token.id}`

          if (!actorMap.has(actorId)) {
            const legacyActor =
              actorFromLegacyToken({
                ...token,
                actorId,
              })

            actorMap.set(
              legacyActor.id,
              legacyActor,
            )
          }

          return {
            id: String(token.id ?? ''),
            actorId,
            assetId: String(token.assetId ?? ''),
            imageUrl: String(token.imageUrl ?? ''),
            mapId: String(token.mapId ?? ''),
            gridX: normalizeGridIndex(token.gridX),
            gridY: normalizeGridIndex(token.gridY),
            size: Math.max(0.5, finiteNumber(token.size, 1)),
            visible: token.visible !== false,
            color: safeString(token.color, '#C9954B'),
            movementUsedFeet: nonNegativeInteger(token.movementUsedFeet, 0),
          }
        })
      : []

  return {
    actors: [...actorMap.values()],
    tokens,
  }
}

export function actorForToken(
  actors: Actor[] | undefined,
  token: Pick<SceneToken, 'actorId'>,
): Actor | null {
  if (!Array.isArray(actors)) {
    return null
  }

  return (
    actors.find(
      (actor) =>
        actor.id === token.actorId,
    ) ?? null
  )
}

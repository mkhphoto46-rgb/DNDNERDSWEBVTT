export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const

export type DamageType = typeof DAMAGE_TYPES[number]

export type ActorKind =
  | 'player'
  | 'npc'
  | 'enemy'

export type ActorLifeState =
  | 'conscious'
  | 'unconscious'
  | 'stable'
  | 'dead'

export type DeathRulesMode =
  | 'character'
  | 'monster'

export interface ActorAbilityScores {
  strength: number
  dexterity: number
  constitution: number
  intelligence: number
  wisdom: number
  charisma: number
}

export type ActorAbility = keyof ActorAbilityScores

export type CharacterSkill =
  | 'acrobatics'
  | 'animalHandling'
  | 'arcana'
  | 'athletics'
  | 'deception'
  | 'history'
  | 'insight'
  | 'intimidation'
  | 'investigation'
  | 'medicine'
  | 'nature'
  | 'perception'
  | 'performance'
  | 'persuasion'
  | 'religion'
  | 'sleightOfHand'
  | 'stealth'
  | 'survival'

export interface CharacterSheetData {
  className: string
  classOptionId: string
  classRulesVersion: string
  subclassName: string
  subclassOptionId: string
  species: string
  speciesOptionId: string
  background: string
  backgroundOptionId: string
  alignment: string
  experiencePoints: number
  savingThrowProficiencies: ActorAbility[]
  skillProficiencies: CharacterSkill[]
  skillExpertise: CharacterSkill[]
  defenseSelections: Record<string, string>
  activeDefenseFeatures: string[]
  selectedFeatIds: string[]
  knownSpellIds: string[]
  preparedSpellIds: string[]
  spentSpellSlots: number[]
  hitDiceSpent: number
  shortRestActive: boolean
  shortRestHitDiceDone: boolean
  spellSelectionLevel: number
  spellLevelUpReplacementsUsed: number[]
  spellLevelUpPendingReplacements: number
  spellLevelUpPendingCantripReplacements: number
  spellLevelUpNewPicksUsed: number
  spellLevelUpCantripPicksUsed: number
  spellLevelUpCantripReplacementsUsed: number[]
  spellLongRestActive: boolean
  spellLongRestChangesUsed: number
  spellLongRestPendingReplacements: number
  spellLongRestPendingCantripReplacements: number
  spellLongRestCantripChangesUsed: number
  spellSelectionInitialized: boolean
  concentratingSpellId: string
  notes: string
}


export type ActorEffectScope =
  | 'all-d20'
  | 'attack'
  | 'saving-throw'
  | 'attack-save'
  | 'ability-check'
  | 'skill-check'
  | 'spell'

export type ActorEffectKind =
  | 'advantage'
  | 'disadvantage'
  | 'roll-modifier'
  | 'dice-bonus'
  | 'speed-modifier'
  | 'condition'

export interface ActorEffect {
  id: string
  name: string
  kind: ActorEffectKind
  scope: ActorEffectScope
  value: number
  diceCount?: number
  dieSides?: number
  sourceRuleId?: string
  concentration?: boolean
  expiresAtRound?: number | null
  sourceActorId: string | null
  sourceActorName: string
  sourceRole: 'player' | 'dm'
  createdAt: string
}

export interface ActorResource {
  id: string
  name: string
  current: number
  max: number
  recharge: 'manual' | 'short-rest' | 'long-rest'
}

export interface Actor {
  id: string
  name: string
  kind: ActorKind
  ownerId: string | null

  portraitAssetId: string
  portraitUrl: string

  level: number
  challengeRating: number | null

  currentHp: number
  maxHp: number
  tempHp: number
  lifeState: ActorLifeState
  deathSaveSuccesses: number
  deathSaveFailures: number
  deathRules: DeathRulesMode
  lastDeathSaveRound: number | null
  ac: number
  speedFeet: number
  /** Current geometric sight radius used by the VTT visibility engine. */
  visionRangeFeet?: number
  initiativeBonus: number
  proficiencyBonus: number

  abilities: ActorAbilityScores
  conditions: string[]
  effects?: ActorEffect[]
  resources: ActorResource[]
  combatActions?: import('./combatActions').ActorAttackProfile[]

  damageResistances?: DamageType[]
  damageImmunities?: DamageType[]
  damageVulnerabilities?: DamageType[]

  sourceTemplateId: string | null
  source: string | null
  creatureSize: string
  creatureType: string
  hitPointFormula: string
  monsterStatBlock: Record<string, unknown> | null
  characterSheet: CharacterSheetData | null

  gmNotes: string
}

export interface PlayerSafeActor {
  id: string
  name: string
  kind: ActorKind
  ownerId: string | null
  level: number
  speedFeet: number
  tempHp: number
  conditions: string[]
  effects: ActorEffect[]
}

export const DEFAULT_ACTOR_ABILITIES: ActorAbilityScores = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
}

export const DEFAULT_CHARACTER_SHEET: CharacterSheetData = {
  className: '',
  classOptionId: '',
  classRulesVersion: '',
  subclassName: '',
  subclassOptionId: '',
  species: '',
  speciesOptionId: '',
  background: '',
  backgroundOptionId: '',
  alignment: '',
  experiencePoints: 0,
  savingThrowProficiencies: [],
  skillProficiencies: [],
  skillExpertise: [],
  defenseSelections: {},
  activeDefenseFeatures: [],
  selectedFeatIds: [],
  knownSpellIds: [],
  preparedSpellIds: [],
  spentSpellSlots: [],
  hitDiceSpent: 0,
  shortRestActive: false,
  shortRestHitDiceDone: false,
  spellSelectionLevel: 1,
  spellLevelUpReplacementsUsed: [],
  spellLevelUpPendingReplacements: 0,
  spellLevelUpPendingCantripReplacements: 0,
  spellLevelUpNewPicksUsed: 0,
  spellLevelUpCantripPicksUsed: 0,
  spellLevelUpCantripReplacementsUsed: [],
  spellLongRestActive: false,
  spellLongRestChangesUsed: 0,
  spellLongRestPendingReplacements: 0,
  spellLongRestPendingCantripReplacements: 0,
  spellLongRestCantripChangesUsed: 0,
  spellSelectionInitialized: false,
  concentratingSpellId: '',
  notes: '',
}

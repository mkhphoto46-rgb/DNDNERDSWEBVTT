import type {
  Actor,
  ActorAbility,
  CharacterSkill,
} from '../types/actor'
import type { GenericDiceMode } from './dice'

export type CoreUtilityAction =
  | 'help'
  | 'hide'
  | 'influence'
  | 'search'
  | 'study'
  | 'utilize'

export type HelpUtilityMode =
  | 'ability-check'
  | 'attack-roll'

export interface HelpBenefit {
  id: string
  kind: HelpUtilityMode
  sourceActorId: string
  targetActorId: string
  attackTargetActorId: string | null
  skill: CharacterSkill | null
  eligibleAllyActorIds: string[]
  sourceTurnStartedAt: string
  createdAt: string
}

export const SEARCH_SKILLS = [
  'insight',
  'medicine',
  'perception',
  'survival',
] as const satisfies readonly CharacterSkill[]

export const STUDY_SKILLS = [
  'arcana',
  'history',
  'investigation',
  'nature',
  'religion',
] as const satisfies readonly CharacterSkill[]

export const INFLUENCE_SKILLS = [
  'animalHandling',
  'deception',
  'intimidation',
  'performance',
  'persuasion',
] as const satisfies readonly CharacterSkill[]

export const HIDE_SKILLS = [
  'stealth',
] as const satisfies readonly CharacterSkill[]

export const ALL_CHARACTER_SKILLS = [
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
] as const satisfies readonly CharacterSkill[]

const SKILL_SET = new Set<CharacterSkill>(ALL_CHARACTER_SKILLS)

const SKILL_ABILITIES: Record<CharacterSkill, ActorAbility> = {
  acrobatics: 'dexterity',
  animalHandling: 'wisdom',
  arcana: 'intelligence',
  athletics: 'strength',
  deception: 'charisma',
  history: 'intelligence',
  insight: 'wisdom',
  intimidation: 'charisma',
  investigation: 'intelligence',
  medicine: 'wisdom',
  nature: 'intelligence',
  perception: 'wisdom',
  performance: 'charisma',
  persuasion: 'charisma',
  religion: 'intelligence',
  sleightOfHand: 'dexterity',
  stealth: 'dexterity',
  survival: 'wisdom',
}

const UTILITY_ACTION_SET = new Set<CoreUtilityAction>([
  'help',
  'hide',
  'influence',
  'search',
  'study',
  'utilize',
])

export function normalizeCoreUtilityAction(value: unknown): CoreUtilityAction | null {
  const action = String(value ?? '').trim().toLowerCase() as CoreUtilityAction
  return UTILITY_ACTION_SET.has(action) ? action : null
}

export function normalizeCharacterSkill(value: unknown): CharacterSkill | null {
  const skill = String(value ?? '').trim() as CharacterSkill
  return SKILL_SET.has(skill) ? skill : null
}

export function utilitySkillsForAction(
  action: CoreUtilityAction,
): readonly CharacterSkill[] {
  if (action === 'hide') return HIDE_SKILLS
  if (action === 'influence') return INFLUENCE_SKILLS
  if (action === 'search') return SEARCH_SKILLS
  if (action === 'study') return STUDY_SKILLS
  return []
}

export function normalizeUtilityActionSkill(
  action: CoreUtilityAction,
  value: unknown,
): CharacterSkill | null {
  const skill = normalizeCharacterSkill(value)
  if (!skill) return null
  return utilitySkillsForAction(action).includes(skill) ? skill : null
}

export function skillAbility(skill: CharacterSkill): ActorAbility {
  return SKILL_ABILITIES[skill]
}

export function actorHasSkillProficiency(
  actor: Actor,
  skill: CharacterSkill,
): boolean {
  const sheet = actor.characterSheet
  if (!sheet) return false
  return (
    sheet.skillProficiencies.includes(skill) ||
    sheet.skillExpertise.includes(skill)
  )
}

export function influenceSkillAllowedForTarget(
  skill: CharacterSkill,
  target: Actor,
): boolean {
  if (skill !== 'animalHandling') return true
  const creatureType = String(target.creatureType ?? '').trim().toLowerCase()
  return creatureType === 'beast' || creatureType === 'monstrosity'
}

export function actorSkillModifier(
  actor: Actor,
  skill: CharacterSkill,
): number {
  const ability = skillAbility(skill)
  const score = Number(actor.abilities?.[ability] ?? 10)
  const abilityModifier = Math.floor((score - 10) / 2)
  const sheet = actor.characterSheet
  if (!sheet) return abilityModifier

  const expertise = sheet.skillExpertise.includes(skill)
  const proficient = expertise || sheet.skillProficiencies.includes(skill)
  const proficiencyBonus = Math.max(0, Math.round(Number(actor.proficiencyBonus) || 0))
  return abilityModifier + (expertise ? proficiencyBonus * 2 : proficient ? proficiencyBonus : 0)
}

export function addAdvantageMode(mode: GenericDiceMode): GenericDiceMode {
  if (mode === 'disadvantage') return 'normal'
  return 'advantage'
}

export function normalizeHelpBenefits(value: unknown): HelpBenefit[] {
  if (!Array.isArray(value)) return []

  return value
    .map((entry): HelpBenefit | null => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const id = String(raw.id ?? '').trim()
      const kind = raw.kind === 'attack-roll' ? 'attack-roll'
        : raw.kind === 'ability-check' ? 'ability-check'
          : null
      const sourceActorId = String(raw.sourceActorId ?? '').trim()
      const targetActorId = String(raw.targetActorId ?? '').trim()
      const attackTargetActorId =
        typeof raw.attackTargetActorId === 'string' && raw.attackTargetActorId.trim()
          ? raw.attackTargetActorId.trim()
          : null
      const skill = normalizeCharacterSkill(raw.skill)
      const eligibleAllyActorIds = Array.isArray(raw.eligibleAllyActorIds)
        ? raw.eligibleAllyActorIds
            .map((actorId) => String(actorId ?? '').trim())
            .filter(Boolean)
            .filter((actorId, index, entries) => entries.indexOf(actorId) === index)
            .slice(0, 50)
        : []
      const sourceTurnStartedAt = String(raw.sourceTurnStartedAt ?? '').trim()
      const createdAt = String(raw.createdAt ?? '').trim()

      if (
        !id ||
        !kind ||
        !sourceActorId ||
        !targetActorId ||
        !sourceTurnStartedAt ||
        !createdAt
      ) {
        return null
      }
      if (kind === 'attack-roll' && !attackTargetActorId) return null
      if (kind === 'ability-check' && !skill) return null

      return {
        id,
        kind,
        sourceActorId,
        targetActorId,
        attackTargetActorId,
        skill,
        eligibleAllyActorIds,
        sourceTurnStartedAt,
        createdAt,
      }
    })
    .filter((entry): entry is HelpBenefit => entry !== null)
    .slice(-100)
}

export function clearHelpBenefitsAtSourceTurnStart(
  benefits: HelpBenefit[],
  sourceActorId: string,
): HelpBenefit[] {
  return normalizeHelpBenefits(benefits)
    .filter((benefit) => benefit.sourceActorId !== sourceActorId)
}

export function matchingHelpAbilityBenefit(
  benefits: HelpBenefit[],
  actorId: string,
  skill: CharacterSkill,
): HelpBenefit | null {
  return normalizeHelpBenefits(benefits).find(
    (benefit) =>
      benefit.kind === 'ability-check' &&
      benefit.targetActorId === actorId &&
      benefit.skill === skill,
  ) ?? null
}

export function matchingHelpAttackBenefit(
  benefits: HelpBenefit[],
  attackerActorId: string,
  targetActorId: string,
): HelpBenefit | null {
  return normalizeHelpBenefits(benefits).find(
    (benefit) =>
      benefit.kind === 'attack-roll' &&
      benefit.attackTargetActorId === targetActorId &&
      benefit.eligibleAllyActorIds.includes(attackerActorId),
  ) ?? null
}

export function consumeHelpBenefit(
  benefits: HelpBenefit[],
  benefitId: string | null | undefined,
): HelpBenefit[] {
  if (!benefitId) return normalizeHelpBenefits(benefits)
  return normalizeHelpBenefits(benefits)
    .filter((benefit) => benefit.id !== benefitId)
}

export function sameDefaultCombatSide(
  first: Actor,
  second: Actor,
): boolean {
  // The current Actor schema has no faction/team field. Player Characters are
  // one side; DM-controlled NPC/enemy Actors are treated as the other side
  // until the dedicated faction system is implemented.
  const firstPlayerSide = first.kind === 'player'
  const secondPlayerSide = second.kind === 'player'
  return firstPlayerSide === secondPlayerSide
}

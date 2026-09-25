import {
  abilityModifier,
  proficiencyBonus,
} from '../rules/dnd2024'

import {
  type Actor,
  type ActorAbility,
  type CharacterSkill,
} from '../types/actor'

import {
  automaticSavingThrows,
} from './characterAutomation'

export const SKILL_ABILITY: Record<CharacterSkill, ActorAbility> = {
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

export const SKILL_LABELS: Record<CharacterSkill, string> = {
  acrobatics: 'Acrobatics',
  animalHandling: 'Animal Handling',
  arcana: 'Arcana',
  athletics: 'Athletics',
  deception: 'Deception',
  history: 'History',
  insight: 'Insight',
  intimidation: 'Intimidation',
  investigation: 'Investigation',
  medicine: 'Medicine',
  nature: 'Nature',
  perception: 'Perception',
  performance: 'Performance',
  persuasion: 'Persuasion',
  religion: 'Religion',
  sleightOfHand: 'Sleight of Hand',
  stealth: 'Stealth',
  survival: 'Survival',
}

export function signed(value: number): string {
  return value >= 0
    ? `+${value}`
    : String(value)
}

export function actorProficiencyBonus(actor: Pick<Actor, 'level'>): number {
  return proficiencyBonus(actor.level)
}

export function savingThrowModifier(
  actor: Actor,
  ability: ActorAbility,
): number {
  const base = abilityModifier(actor.abilities[ability])
  const selected = actor.characterSheet?.savingThrowProficiencies ?? []
  const proficient =
    selected.includes(ability) ||
    automaticSavingThrows(actor.characterSheet?.className ?? '').includes(ability)
  return base + (proficient ? actorProficiencyBonus(actor) : 0)
}

export function skillModifier(
  actor: Actor,
  skill: CharacterSkill,
): number {
  const ability = SKILL_ABILITY[skill]
  const base = abilityModifier(actor.abilities[ability])
  const sheet = actor.characterSheet

  if (!sheet) return base

  const pb = actorProficiencyBonus(actor)
  const expertise = sheet.skillExpertise.includes(skill)
  const proficient = expertise || sheet.skillProficiencies.includes(skill)

  return base + (expertise ? pb * 2 : proficient ? pb : 0)
}

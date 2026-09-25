import type { ActorAbility, CharacterSkill } from '../types/actor'

export interface ClassAutomation {
  label: string
  savingThrows: ActorAbility[]
  spellcastingAbility?: ActorAbility
}

const CLASS_RULES: Record<string, ClassAutomation> = {
  artificer: { label: 'Artificer', savingThrows: ['constitution', 'intelligence'], spellcastingAbility: 'intelligence' },
  barbarian: { label: 'Barbarian', savingThrows: ['strength', 'constitution'] },
  bard: { label: 'Bard', savingThrows: ['dexterity', 'charisma'], spellcastingAbility: 'charisma' },
  cleric: { label: 'Cleric', savingThrows: ['wisdom', 'charisma'], spellcastingAbility: 'wisdom' },
  druid: { label: 'Druid', savingThrows: ['intelligence', 'wisdom'], spellcastingAbility: 'wisdom' },
  fighter: { label: 'Fighter', savingThrows: ['strength', 'constitution'] },
  monk: { label: 'Monk', savingThrows: ['strength', 'dexterity'] },
  paladin: { label: 'Paladin', savingThrows: ['wisdom', 'charisma'], spellcastingAbility: 'charisma' },
  ranger: { label: 'Ranger', savingThrows: ['strength', 'dexterity'], spellcastingAbility: 'wisdom' },
  rogue: { label: 'Rogue', savingThrows: ['dexterity', 'intelligence'] },
  sorcerer: { label: 'Sorcerer', savingThrows: ['constitution', 'charisma'], spellcastingAbility: 'charisma' },
  warlock: { label: 'Warlock', savingThrows: ['wisdom', 'charisma'], spellcastingAbility: 'charisma' },
  wizard: { label: 'Wizard', savingThrows: ['intelligence', 'wisdom'], spellcastingAbility: 'intelligence' },
}

export const CLASS_OPTIONS = Object.values(CLASS_RULES).map(({ label }) => label)

function classKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z]/g, '')
}

export function classAutomation(className: string): ClassAutomation | null {
  return CLASS_RULES[classKey(className)] ?? null
}

export function automaticSavingThrows(className: string): ActorAbility[] {
  return classAutomation(className)?.savingThrows ?? []
}

export function automaticSpellcastingAbility(className: string): ActorAbility | null {
  return classAutomation(className)?.spellcastingAbility ?? null
}

export function mergeCharacterSkills(
  selected: CharacterSkill[],
  expertise: CharacterSkill[],
): CharacterSkill[] {
  return [...new Set([...selected, ...expertise])]
}

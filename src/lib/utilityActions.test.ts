import assert from 'node:assert/strict'
import test from 'node:test'

import { createBlankPlayerActor } from './actors'
import {
  actorHasSkillProficiency,
  actorSkillModifier,
  addAdvantageMode,
  clearHelpBenefitsAtSourceTurnStart,
  consumeHelpBenefit,
  matchingHelpAbilityBenefit,
  matchingHelpAttackBenefit,
  influenceSkillAllowedForTarget,
  normalizeCoreUtilityAction,
  normalizeUtilityActionSkill,
  sameDefaultCombatSide,
  type HelpBenefit,
} from './utilityActions'

function actor(id: string, kind: 'player' | 'enemy' | 'npc' = 'player') {
  const value = createBlankPlayerActor({ id, name: id, ownerId: kind === 'player' ? `${id}-owner` : null })
  value.kind = kind
  return value
}

test('utility action and skill inputs are constrained to the 2024 core action tables', () => {
  assert.equal(normalizeCoreUtilityAction('SEARCH'), 'search')
  assert.equal(normalizeCoreUtilityAction('ready'), null)
  assert.equal(normalizeUtilityActionSkill('search', 'perception'), 'perception')
  assert.equal(normalizeUtilityActionSkill('search', 'arcana'), null)
  assert.equal(normalizeUtilityActionSkill('study', 'arcana'), 'arcana')
  assert.equal(normalizeUtilityActionSkill('influence', 'persuasion'), 'persuasion')
  assert.equal(normalizeUtilityActionSkill('hide', 'stealth'), 'stealth')
})

test('skill modifiers are derived from ability, proficiency, and expertise on the actor', () => {
  const hero = actor('hero')
  hero.abilities.wisdom = 16
  hero.proficiencyBonus = 3
  hero.characterSheet!.skillProficiencies = ['perception']
  assert.equal(actorHasSkillProficiency(hero, 'perception'), true)
  assert.equal(actorSkillModifier(hero, 'perception'), 6)

  hero.characterSheet!.skillExpertise = ['perception']
  assert.equal(actorSkillModifier(hero, 'perception'), 9)

  hero.characterSheet!.skillProficiencies = []
  hero.characterSheet!.skillExpertise = []
  assert.equal(actorSkillModifier(hero, 'perception'), 3)
})

test('Help ability benefits match one ally and one chosen skill and are consumed once', () => {
  const benefit: HelpBenefit = {
    id: 'help-1',
    kind: 'ability-check',
    sourceActorId: 'helper',
    targetActorId: 'ally',
    attackTargetActorId: null,
    skill: 'perception',
    eligibleAllyActorIds: [],
    sourceTurnStartedAt: 'turn-1',
    createdAt: '2026-09-21T00:00:00.000Z',
  }
  assert.equal(matchingHelpAbilityBenefit([benefit], 'ally', 'perception')?.id, 'help-1')
  assert.equal(matchingHelpAbilityBenefit([benefit], 'ally', 'insight'), null)
  assert.equal(consumeHelpBenefit([benefit], 'help-1').length, 0)
})

test('Help attack benefits match the enemy and an eligible allied attacker', () => {
  const benefit: HelpBenefit = {
    id: 'help-attack',
    kind: 'attack-roll',
    sourceActorId: 'helper',
    targetActorId: 'enemy',
    attackTargetActorId: 'enemy',
    skill: null,
    eligibleAllyActorIds: ['ally-a', 'ally-b'],
    sourceTurnStartedAt: 'turn-1',
    createdAt: '2026-09-21T00:00:00.000Z',
  }
  assert.equal(matchingHelpAttackBenefit([benefit], 'ally-a', 'enemy')?.id, 'help-attack')
  assert.equal(matchingHelpAttackBenefit([benefit], 'stranger', 'enemy'), null)
  assert.equal(matchingHelpAttackBenefit([benefit], 'ally-a', 'other-enemy'), null)
})

test('Help expires when the helper next starts a turn and advantage cancels disadvantage', () => {
  const benefit: HelpBenefit = {
    id: 'help-1',
    kind: 'ability-check',
    sourceActorId: 'helper',
    targetActorId: 'ally',
    attackTargetActorId: null,
    skill: 'perception',
    eligibleAllyActorIds: [],
    sourceTurnStartedAt: 'turn-1',
    createdAt: '2026-09-21T00:00:00.000Z',
  }
  assert.equal(clearHelpBenefitsAtSourceTurnStart([benefit], 'helper').length, 0)
  assert.equal(addAdvantageMode('normal'), 'advantage')
  assert.equal(addAdvantageMode('disadvantage'), 'normal')
})

test('default combat-side inference keeps players together and DM-controlled actors together', () => {
  assert.equal(sameDefaultCombatSide(actor('p1'), actor('p2')), true)
  assert.equal(sameDefaultCombatSide(actor('p1'), actor('e1', 'enemy')), false)
  assert.equal(sameDefaultCombatSide(actor('n1', 'npc'), actor('e1', 'enemy')), true)
})


test('Influence Animal Handling is constrained to Beasts and Monstrosities', () => {
  const beast = actor('beast', 'enemy')
  beast.creatureType = 'Beast'
  const monstrosity = actor('monster', 'enemy')
  monstrosity.creatureType = 'Monstrosity'
  const humanoid = actor('humanoid', 'enemy')
  humanoid.creatureType = 'Humanoid'

  assert.equal(influenceSkillAllowedForTarget('animalHandling', beast), true)
  assert.equal(influenceSkillAllowedForTarget('animalHandling', monstrosity), true)
  assert.equal(influenceSkillAllowedForTarget('animalHandling', humanoid), false)
  assert.equal(influenceSkillAllowedForTarget('persuasion', humanoid), true)
})

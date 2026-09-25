import {
  DEFAULT_ACTOR_ABILITIES,
  type Actor,
  type ActorAbilityScores,
} from '../types/actor'

import {
  type MonsterTemplate,
} from '../types/compendium'

import {
  nextActorName,
  normalizeActor,
} from './actors'

import {
  extractSimpleDamageTypes,
} from './damage'

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function abilityScoresFromMonster(
  statBlock: Record<string, unknown>,
): ActorAbilityScores {
  const raw =
    statBlock.ability_scores &&
    typeof statBlock.ability_scores === 'object'
      ? statBlock.ability_scores as Record<string, unknown>
      : {}

  return {
    strength: numberValue(raw.str, DEFAULT_ACTOR_ABILITIES.strength),
    dexterity: numberValue(raw.dex, DEFAULT_ACTOR_ABILITIES.dexterity),
    constitution: numberValue(raw.con, DEFAULT_ACTOR_ABILITIES.constitution),
    intelligence: numberValue(raw.int, DEFAULT_ACTOR_ABILITIES.intelligence),
    wisdom: numberValue(raw.wis, DEFAULT_ACTOR_ABILITIES.wisdom),
    charisma: numberValue(raw.cha, DEFAULT_ACTOR_ABILITIES.charisma),
  }
}

function walkingSpeed(statBlock: Record<string, unknown>): number {
  const speed =
    statBlock.speed &&
    typeof statBlock.speed === 'object'
      ? statBlock.speed as Record<string, unknown>
      : {}

  const preferred = numberValue(speed.walk, 0)
  if (preferred > 0) return preferred

  for (const value of Object.values(speed)) {
    const parsed = numberValue(value, 0)
    if (parsed > 0) return parsed
  }

  return 30
}

export function createActorFromMonsterTemplate(
  template: MonsterTemplate,
  existingActors: Actor[],
  actorId: string,
): Actor {
  const statBlock = template.statBlock ?? {}

  return normalizeActor({
    id: actorId,
    name: nextActorName(template.name, existingActors),
    kind: 'enemy',
    ownerId: null,
    portraitAssetId: `compendium:${template.id}`,
    portraitUrl:
      template.portraitUrl ??
      `/api/compendium/monsters/${encodeURIComponent(template.id)}/portrait`,
    level: 1,
    challengeRating: template.crNumeric,
    currentHp: template.hitPoints,
    maxHp: template.hitPoints,
    tempHp: 0,
    ac: template.armorClass,
    speedFeet: walkingSpeed(statBlock),
    initiativeBonus: template.initiativeModifier,
    proficiencyBonus: 2,
    abilities: abilityScoresFromMonster(statBlock),
    conditions: [],
    resources: [],
    damageResistances: extractSimpleDamageTypes(statBlock.damage_resistances),
    damageImmunities: extractSimpleDamageTypes(statBlock.damage_immunities),
    damageVulnerabilities: extractSimpleDamageTypes(statBlock.damage_vulnerabilities),
    sourceTemplateId: template.id,
    source: template.source,
    creatureSize: template.size,
    creatureType: template.type,
    hitPointFormula: template.hitPointFormula,
    monsterStatBlock: structuredClone(statBlock),
    characterSheet: null,
    gmNotes: '',
  })
}

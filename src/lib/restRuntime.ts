import { normalizeActor } from './actors'
import { normalizedCatalogKey } from './characterCatalog'
import { spellSlotPool } from './spellRuntime'
import type { Actor } from '../types/actor'

const CLASS_HIT_DICE: Record<string, number> = {
  barbarian: 12,
  fighter: 10,
  paladin: 10,
  ranger: 10,
  artificer: 8,
  bard: 8,
  cleric: 8,
  druid: 8,
  monk: 8,
  rogue: 8,
  warlock: 8,
  sorcerer: 6,
  wizard: 6,
}

export function hitDieSidesForClass(className: string): number | null {
  return CLASS_HIT_DICE[normalizedCatalogKey(className)] ?? null
}

export function startActorShortRest(actor: Actor): Actor {
  const sheet = actor.characterSheet
  if (actor.kind !== 'player' || !sheet || actor.currentHp < 1) return actor
  if (sheet.shortRestActive) return actor

  return normalizeActor({
    ...actor,
    characterSheet: { ...sheet, shortRestActive: true, shortRestHitDiceDone: false },
  })
}

export function finishActorShortRest(actor: Actor): Actor {
  const sheet = actor.characterSheet
  if (actor.kind !== 'player' || !sheet || !sheet.shortRestActive) return actor

  const resources = actor.resources.map((resource) =>
    resource.recharge === 'short-rest'
      ? { ...resource, current: resource.max }
      : resource,
  )
  const slotPool = spellSlotPool(sheet.className, actor.level, sheet.classRulesVersion)

  return normalizeActor({
    ...actor,
    resources,
    characterSheet: {
      ...sheet,
      shortRestActive: false,
      shortRestHitDiceDone: false,
      spentSpellSlots: slotPool.kind === 'pact' ? [] : sheet.spentSpellSlots,
    },
  })
}

export function cancelActorShortRest(actor: Actor): Actor {
  const sheet = actor.characterSheet
  if (actor.kind !== 'player' || !sheet || !sheet.shortRestActive) return actor

  return normalizeActor({
    ...actor,
    characterSheet: { ...sheet, shortRestActive: false, shortRestHitDiceDone: false },
  })
}

export function completeActorLongRest(actor: Actor): Actor {
  const sheet = actor.characterSheet
  if (actor.kind !== 'player' || !sheet || actor.currentHp < 1) return actor

  const totalHitDice = Math.max(1, Math.min(20, actor.level))
  const restoredHitDice = sheet.classRulesVersion === '2014'
    ? Math.max(1, Math.floor(totalHitDice / 2))
    : totalHitDice
  const remainingSpentHitDice = Math.max(0, sheet.hitDiceSpent - restoredHitDice)
  const resources = actor.resources.map((resource) =>
    resource.recharge === 'manual'
      ? resource
      : { ...resource, current: resource.max },
  )

  return normalizeActor({
    ...actor,
    currentHp: actor.maxHp,
    resources,
    characterSheet: {
      ...sheet,
      hitDiceSpent: remainingSpentHitDice,
      spentSpellSlots: [],
      shortRestActive: false,
      shortRestHitDiceDone: false,
      spellLongRestActive: true,
      spellLongRestChangesUsed: 0,
      spellLongRestPendingReplacements: 0,
      spellLongRestCantripChangesUsed: 0,
      spellLongRestPendingCantripReplacements: 0,
      concentratingSpellId: '',
    },
  })
}

export function closeActorLongRestChanges(actor: Actor): Actor {
  const sheet = actor.characterSheet
  if (actor.kind !== 'player' || !sheet || !sheet.spellLongRestActive) return actor

  return normalizeActor({
    ...actor,
    characterSheet: {
      ...sheet,
      spellLongRestActive: false,
      spellLongRestPendingReplacements: 0,
      spellLongRestPendingCantripReplacements: 0,
    },
  })
}

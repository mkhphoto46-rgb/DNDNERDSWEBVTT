import type {
  DiceRollPresentation,
  DiceSides,
  DiceThemeCatalog,
  DiceThemeDefinition,
  DiceVisualResult,
} from '../types/diceVisuals'

const DICE_SIDES = new Set<number>([4, 6, 8, 10, 12, 20, 100])

export const DEFAULT_DICE_THEME: DiceThemeDefinition = {
  id: 'silver',
  name: 'Silver',
  models: {
    4: '/assets/dice/sets/silver/d4.glb',
    6: '/assets/dice/sets/silver/d6.glb',
    8: '/assets/dice/sets/silver/d8.glb',
    10: '/assets/dice/sets/silver/d10.glb',
    12: '/assets/dice/sets/silver/d12.glb',
    20: '/assets/dice/sets/silver/d20.glb',
    100: '/assets/dice/sets/silver/d10.glb',
  },
  material: {
    color: '#ffffff',
    emissive: '#000000',
    emissiveIntensity: 0,
    roughness: 0.34,
    metalness: 0.26,
  },
  lighting: {
    ambient: 1.4,
    key: 3.8,
    fill: 1.8,
    rim: 4.2,
  },
  stage: {
    color: '#12181d',
    glow: '#c7d5de',
    fallHeight: 3,
    gravity: 20,
    bounce: 0.34,
    spin: 10,
    durationMs: 1400,
    revealDelayMs: 1000,
    holdMs: 2600,
  },
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function integer(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback
}

function diceSides(value: unknown): DiceSides | null {
  const parsed = integer(value)
  return DICE_SIDES.has(parsed) ? parsed as DiceSides : null
}

function purposeLabel(value: unknown): string {
  switch (value) {
    case 'attack': return 'Attack Roll'
    case 'damage': return 'Damage Roll'
    case 'saving-throw': return 'Saving Throw'
    case 'ability-check': return 'Ability Check'
    case 'skill-check': return 'Skill Check'
    case 'spell': return 'Spell Roll'
    default: return 'Dice Roll'
  }
}

function diceNotation(dice: DiceVisualResult[]): string {
  const counts = new Map<DiceSides, number>()
  for (const die of dice) counts.set(die.sides, (counts.get(die.sides) ?? 0) + 1)
  return [...counts]
    .map(([sides, count]) => `${count}d${sides === 100 ? '%' : sides}`)
    .join(' + ')
}

export function normalizeDiceThemeCatalog(value: unknown): DiceThemeCatalog {
  const raw = record(value)
  const rawThemes = Array.isArray(raw?.themes) ? raw.themes : []
  const themes = rawThemes.flatMap((entry): DiceThemeDefinition[] => {
    const theme = record(entry)
    const id = String(theme?.id ?? '').trim()
    const name = String(theme?.name ?? '').trim()
    const material = record(theme?.material)
    const lighting = record(theme?.lighting)
    const stage = record(theme?.stage)
    const models = record(theme?.models)
    if (!id || !name || !material || !lighting || !stage || !models) return []

    const modelUrls: Partial<Record<DiceSides, string>> = {}
    for (const sides of DICE_SIDES) {
      const url = models[String(sides)]
      if (typeof url === 'string' && url.trim()) {
        modelUrls[sides as DiceSides] = url.trim()
      }
    }

    return [{
      id,
      name,
      models: modelUrls,
      material: {
        color: String(material.color ?? DEFAULT_DICE_THEME.material.color),
        emissive: String(material.emissive ?? DEFAULT_DICE_THEME.material.emissive),
        emissiveIntensity: Number(material.emissiveIntensity) || 0,
        roughness: Number(material.roughness) || DEFAULT_DICE_THEME.material.roughness,
        metalness: Number(material.metalness) || 0,
      },
      lighting: {
        ambient: Number(lighting.ambient) || DEFAULT_DICE_THEME.lighting.ambient,
        key: Number(lighting.key) || DEFAULT_DICE_THEME.lighting.key,
        fill: Number(lighting.fill) || DEFAULT_DICE_THEME.lighting.fill,
        rim: Number(lighting.rim) || DEFAULT_DICE_THEME.lighting.rim,
      },
      stage: {
        color: String(stage.color ?? DEFAULT_DICE_THEME.stage.color),
        glow: String(stage.glow ?? DEFAULT_DICE_THEME.stage.glow),
        fallHeight: Number(stage.fallHeight) || DEFAULT_DICE_THEME.stage.fallHeight,
        gravity: Number(stage.gravity) || DEFAULT_DICE_THEME.stage.gravity,
        bounce: Number(stage.bounce) || DEFAULT_DICE_THEME.stage.bounce,
        spin: Number(stage.spin) || DEFAULT_DICE_THEME.stage.spin,
        durationMs: Number(stage.durationMs) || DEFAULT_DICE_THEME.stage.durationMs,
        revealDelayMs: Number(stage.revealDelayMs) || DEFAULT_DICE_THEME.stage.revealDelayMs,
        holdMs: Number(stage.holdMs) || DEFAULT_DICE_THEME.stage.holdMs,
      },
    }]
  })

  const availableThemes = themes.length > 0 ? themes : [DEFAULT_DICE_THEME]
  const requestedDefault = String(raw?.defaultThemeId ?? '')
  const defaultThemeId = availableThemes.some((theme) => theme.id === requestedDefault)
    ? requestedDefault
    : availableThemes[0].id

  return { defaultThemeId, themes: availableThemes }
}

export function genericDicePresentation(value: unknown): DiceRollPresentation | null {
  const raw = record(value)
  if (!raw) return null

  const id = String(raw.id ?? '').trim()
  const rollerName = String(raw.rollerName ?? 'A player').trim()
  const sides = diceSides(raw.sides)
  const total = integer(raw.total, Number.NaN)
  const rawSets = Array.isArray(raw.rolls)
    ? raw.rolls.filter((set): set is unknown[] => Array.isArray(set))
    : []
  if (!id || !sides || !Number.isFinite(total) || rawSets.length === 0) return null

  const sets = rawSets.slice(0, 2).map((set) =>
    set.map((roll) => Math.max(1, Math.min(sides, integer(roll, 1)))),
  )
  const mode = raw.mode === 'advantage' || raw.mode === 'disadvantage'
    ? raw.mode
    : 'normal'
  const sum = (set: number[]) => set.reduce((value, roll) => value + roll, 0)
  const keptSetIndex = sets.length < 2 || mode === 'normal'
    ? 0
    : mode === 'advantage'
      ? (sum(sets[1]) > sum(sets[0]) ? 1 : 0)
      : (sum(sets[1]) < sum(sets[0]) ? 1 : 0)
  const dice: DiceVisualResult[] = sets.flatMap((set, setIndex) =>
    set.map((roll) => ({ sides, value: roll, discarded: sets.length > 1 && setIndex !== keptSetIndex })),
  )
  const bonusDice = Array.isArray(raw.bonusDiceResults) ? raw.bonusDiceResults : []
  for (const bonusValue of bonusDice) {
    const bonus = record(bonusValue)
    const bonusSides = diceSides(bonus?.sides)
    if (!bonusSides) continue
    const count = Array.isArray(bonus?.rolls) ? bonus.rolls : [bonus?.roll]
    for (const roll of count) {
      dice.push({ sides: bonusSides, value: Math.max(1, Math.min(bonusSides, integer(roll, 1))) })
    }
  }

  const modifier = integer(raw.modifier)
  const keptDiceTotal = dice.reduce(
    (sum, die) => sum + (die.discarded ? 0 : die.value),
    0,
  )
  const arithmetic = modifier === 0
    ? `${keptDiceTotal} = ${total}`
    : `${keptDiceTotal} ${modifier < 0 ? '−' : '+'} ${Math.abs(modifier)} = ${total}`
  const detail = [
    mode === 'advantage' ? 'Advantage' : mode === 'disadvantage' ? 'Disadvantage' : '',
    arithmetic,
  ].filter(Boolean).join(' · ')

  return {
    id,
    rollerName,
    title: `${purposeLabel(raw.purpose)} · ${diceNotation(dice)}`,
    total,
    dice,
    detail: detail || undefined,
  }
}

export function tableDicePresentation(value: unknown): DiceRollPresentation | null {
  const raw = record(value)
  if (!raw) return null
  const id = String(raw.id ?? '').trim()
  const rollerName = String(raw.rollerName ?? 'A player').trim()
  const title = String(raw.title ?? 'Dice Roll').trim()
  const total = integer(raw.total, Number.NaN)
  const rawDice = Array.isArray(raw.dice) ? raw.dice : []
  if (!id || !Number.isFinite(total)) return null
  const dice = rawDice.flatMap((entry): DiceVisualResult[] => {
    const die = record(entry)
    const sides = diceSides(die?.sides)
    const value = integer(die?.value, Number.NaN)
    return sides && Number.isFinite(value)
      ? [{ sides, value: Math.max(1, Math.min(sides, value)), discarded: die?.discarded === true }]
      : []
  })
  if (dice.length === 0) return null

  return {
    id,
    rollerName,
    title,
    total,
    dice,
    detail: typeof raw.detail === 'string' ? raw.detail : undefined,
  }
}

export function attackDicePresentation(value: unknown): DiceRollPresentation | null {
  const raw = record(value)
  if (!raw) return null
  const id = String(raw.id ?? '').trim()
  const rollerName = String(raw.sourceActorName ?? 'A player').trim()
  const total = integer(raw.attackTotal, Number.NaN)
  const natural = integer(raw.natural, Number.NaN)
  const rawRolls = Array.isArray(raw.d20Rolls) ? raw.d20Rolls : []
  if (!id || !Number.isFinite(total) || rawRolls.length === 0) return null

  const keptIndex = rawRolls.findIndex((roll) => integer(roll) === natural)
  const dice: DiceVisualResult[] = rawRolls.flatMap((roll, index) => {
    const value = integer(roll, Number.NaN)
    return Number.isFinite(value)
      ? [{ sides: 20, value: Math.max(1, Math.min(20, value)), discarded: rawRolls.length > 1 && index !== Math.max(0, keptIndex) }]
      : []
  })
  const damage = record(raw.damage)
  const damageTerms = Array.isArray(damage?.dice) ? damage.dice : []
  for (const termValue of damageTerms) {
    const term = record(termValue)
    const sides = diceSides(term?.sides)
    const rolls = Array.isArray(term?.rolls) ? term.rolls : []
    if (!sides) continue
    for (const roll of rolls) {
      const value = integer(roll, Number.NaN)
      if (Number.isFinite(value)) dice.push({ sides, value: Math.max(1, Math.min(sides, value)) })
    }
  }

  const bonusDice = Array.isArray(raw.bonusDiceResults) ? raw.bonusDiceResults : []
  for (const entry of bonusDice) {
    const die = record(entry)
    const sides = diceSides(die?.sides)
    const value = integer(die?.value, Number.NaN)
    if (sides && Number.isFinite(value)) {
      dice.push({ sides, value: Math.max(1, Math.min(sides, value)) })
    }
  }

  const damageTotal = integer(damage?.total, Number.NaN)
  const attackModifier = Number.isFinite(natural) ? total - natural : Number.NaN
  const attackCalculation = Number.isFinite(attackModifier)
    ? `D20 ${natural} ${attackModifier < 0 ? '−' : '+'} ${Math.abs(attackModifier)} = ${total}`
    : ''
  const outcome = String(raw.outcome ?? '').toUpperCase()
  const mode = raw.mode === 'advantage' || raw.mode === 'disadvantage'
    ? raw.mode
    : 'normal'
  const detail = [
    attackCalculation,
    mode === 'advantage' ? 'Advantage' : mode === 'disadvantage' ? 'Disadvantage' : '',
    outcome,
    Number.isFinite(damageTotal) ? `Damage ${damageTotal} ${String(raw.damageType ?? '')}`.trim() : '',
  ].filter(Boolean).join(' · ')

  return {
    id,
    rollerName,
    title: `${String(raw.attackName ?? 'Attack')} · ${diceNotation(dice)}`,
    total,
    dice,
    detail: detail || undefined,
  }
}

export function spellDicePresentation(value: unknown): DiceRollPresentation | null {
  const raw = record(value)
  if (!raw) return null
  const id = String(raw.id ?? '').trim()
  const rollerName = String(raw.sourceActorName ?? 'A player').trim()
  const spellName = String(raw.spellName ?? 'Spell').trim()
  const castLevel = integer(raw.castLevel)
  const rawResults = Array.isArray(raw.effectResults) ? raw.effectResults : []
  if (!id || rawResults.length === 0) return null

  const dice: DiceVisualResult[] = []
  const details: string[] = []
  let damageTotal = 0
  let healingTotal = 0
  for (const rawResult of rawResults.slice(0, 12)) {
    const result = record(rawResult)
    if (!result) continue
    const actorName = String(result.actorName ?? 'Target')
    const kind = String(result.kind ?? 'effect')
    const natural = Number(result.roll)
    const hasNatural = result.roll !== undefined && Number.isFinite(natural)
    if (hasNatural) dice.push({ sides: 20, value: Math.max(1, Math.min(20, natural)) })
    const rawDice = Array.isArray(result.dice) ? result.dice : []
    for (const rawDie of rawDice) {
      const die = record(rawDie)
      const sides = diceSides(die?.sides)
      const value = integer(die?.value, Number.NaN)
      if (sides && Number.isFinite(value)) dice.push({ sides, value: Math.max(1, Math.min(sides, value)) })
    }
    const damage = integer(result.damage, 0)
    const healed = integer(result.healed, 0)
    damageTotal += damage
    healingTotal += healed
    const outcome = damage > 0
      ? `${damage} damage`
      : healed > 0
        ? `${healed} HP restored`
        : hasNatural
          ? `${kind} · ${natural}${Number.isFinite(Number(result.total)) ? ` (${integer(result.total)})` : ''}`
          : kind
    details.push(`${actorName}: ${outcome}`)
  }
  if (!dice.length) return null
  const detail = details.slice(0, 4).join(' · ')
  const omitted = Math.max(0, details.length - 4)
  const total = damageTotal || healingTotal || dice.reduce((sum, die) => sum + die.value, 0)
  return {
    id,
    rollerName,
    title: `${spellName}${castLevel > 0 ? ` · Level ${castLevel}` : ''}`,
    total,
    dice: dice.slice(0, 32),
    detail: `${detail}${omitted ? ` · +${omitted} more target(s)` : ''}`,
  }
}

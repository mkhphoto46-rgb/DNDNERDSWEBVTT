import { SRD_CLASS_FEATURES } from '../data/srdClassFeatures.generated'
import {
  canonicalSubclassName,
  hasBundledSubclassRules,
  normalizedCatalogKey,
  OPEN_SRD_SUBCLASS_BY_CLASS,
} from './characterCatalog'

// D&D 2024 uses the familiar 1–20 character tier thresholds for XP play.
const XP_BY_LEVEL = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000]

export interface CharacterFeatureView {
  id: string
  level: number
  name: string
  description: string
  source: 'class' | 'subclass'
}

const OPEN_SUBCLASS_FEATURE_PREFIX: Record<string, string> = {
  barbarian: 'berserker-',
  bard: 'lore-',
  cleric: 'life-',
  druid: 'land-',
  fighter: 'champion-',
  monk: 'open-hand-',
  paladin: 'devotion-',
  ranger: 'hunter-',
  rogue: 'thief-',
  sorcerer: 'draconic-sorcery-',
  warlock: 'fiend-patron-',
  wizard: 'evoker-',
}

export function xpForLevel(level: number): number {
  return XP_BY_LEVEL[Math.max(1, Math.min(20, Math.round(level))) - 1]
}

export function levelForXp(experiencePoints: number): number {
  const xp = Math.max(0, Math.round(Number(experiencePoints) || 0))
  let level = 1

  for (let index = 0; index < XP_BY_LEVEL.length; index += 1) {
    if (xp < XP_BY_LEVEL[index]) break
    level = index + 1
  }

  return Math.max(1, Math.min(20, level))
}

export function xpProgress(level: number, experiencePoints: number): { current: number; next: number | null; percent: number } {
  const current = xpForLevel(level)
  const next = level >= 20 ? null : xpForLevel(level + 1)
  const span = next === null ? 1 : Math.max(1, next - current)
  return { current, next, percent: next === null ? 100 : Math.max(0, Math.min(100, ((experiencePoints - current) / span) * 100)) }
}

function featureSource(
  featureId: string,
  classKey: string,
  subclassPrefix: string | null,
): 'class' | 'subclass' | null {
  if (featureId.startsWith(`${classKey}-`)) return 'class'
  if (subclassPrefix && featureId.startsWith(subclassPrefix)) return 'subclass'
  return null
}

export function characterFeaturesAtLevel(
  className: string,
  subclassName: string,
  level: number,
): CharacterFeatureView[] {
  const classKey = normalizedCatalogKey(className)
  if (!classKey) return []

  const canonicalSubclass = canonicalSubclassName(className, subclassName)
  const includeOpenSubclass = hasBundledSubclassRules(className, canonicalSubclass)
  const subclassPrefix = includeOpenSubclass
    ? OPEN_SUBCLASS_FEATURE_PREFIX[classKey] ?? null
    : null

  const result: CharacterFeatureView[] = []

  for (const feature of SRD_CLASS_FEATURES) {
    if (normalizedCatalogKey(feature.className) !== classKey) continue
    if (feature.level > level) continue

    const source = featureSource(feature.id, classKey, subclassPrefix)
    if (!source) continue

    result.push({
      id: feature.id,
      level: feature.level,
      name: feature.name,
      description: feature.description,
      source,
    })
  }

  return result.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
}

export function nextCharacterFeatures(
  className: string,
  subclassName: string,
  level: number,
): CharacterFeatureView[] {
  if (level >= 20) return []

  const allFuture = characterFeaturesAtLevel(className, subclassName, 20)
    .filter((feature) => feature.level > level)

  const nextLevel = allFuture[0]?.level
  if (!nextLevel) return []

  return allFuture.filter((feature) => feature.level === nextLevel)
}

export function bundledSubclassRulesLabel(className: string): string | null {
  return OPEN_SRD_SUBCLASS_BY_CLASS[normalizedCatalogKey(className)] ?? null
}

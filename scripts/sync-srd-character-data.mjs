import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DATASETS = {
  features: {
    url: 'https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2024/en/5e-SRD-Features.json',
    output: resolve(process.cwd(), 'src/data/srdClassFeatures.generated.ts'),
  },
  feats: {
    url: 'https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2024/en/5e-SRD-Feats.json',
    output: resolve(process.cwd(), 'src/data/srdFeats.generated.ts'),
  },
  spells: {
    url: 'https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2024/en/5e-SRD-Spells.json',
    output: resolve(process.cwd(), 'src/data/srdSpells.generated.ts'),
  },
  equipment: {
    url: 'https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2024/en/5e-SRD-Equipment.json',
    output: resolve(process.cwd(), 'src/data/srdEquipment.generated.ts'),
  },
  magicItems: {
    url: 'https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2024/en/5e-SRD-Magic-Items.json',
    output: resolve(process.cwd(), 'src/data/srdMagicItems.generated.ts'),
  },
  backgrounds: {
    url: 'https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2024/en/5e-SRD-Backgrounds.json',
    output: resolve(process.cwd(), 'src/data/srdBackgrounds.generated.ts'),
  },
  poisons: {
    url: 'https://raw.githubusercontent.com/5e-bits/5e-database/main/src/2024/en/5e-SRD-Poisons.json',
    output: resolve(process.cwd(), 'src/data/srdPoisons.generated.ts'),
  },
}

function cleanDescription(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/([A-Za-z]+)-\s+([a-z])/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

async function fetchJson(url, minimumCount, label) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'DND-Web-VTT-SRD-Sync/1.1' },
  })

  if (!response.ok) {
    throw new Error(`${label} sync failed: HTTP ${response.status} ${response.statusText}`)
  }

  const source = await response.json()
  if (!Array.isArray(source) || source.length < minimumCount) {
    throw new Error(`${label} sync failed: unexpected source payload.`)
  }

  return source
}

function prereqText(feat) {
  const parts = []
  const minimumLevel = Number(feat?.prerequisites?.minimum_level ?? 0)
  if (minimumLevel > 0) parts.push(`Level ${minimumLevel}+`)

  const featureNamed = String(feat?.prerequisites?.feature_named ?? '').trim()
  if (featureNamed) parts.push(featureNamed)

  const optionDesc = String(feat?.prerequisite_options?.desc ?? '').trim()
  if (optionDesc) parts.push(optionDesc)

  return [...new Set(parts)].join('; ')
}

function spellArea(spell) {
  const area = spell?.area_of_effect
  if (!area || typeof area !== 'object') return ''

  const size = Number(area.size)
  const type = String(area.type ?? '').trim()
  if (!Number.isFinite(size) || !type) return type
  return `${size}-foot ${type}`
}

function recordMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [String(key), String(entry ?? '')])
      .filter(([, entry]) => Boolean(entry)),
  )
}

const [featureSource, featSource, spellSource, equipmentSource, magicItemSource, backgroundSource, poisonSource] = await Promise.all([
  fetchJson(DATASETS.features.url, 100, 'SRD feature'),
  fetchJson(DATASETS.feats.url, 10, 'SRD feat'),
  fetchJson(DATASETS.spells.url, 250, 'SRD spell'),
  fetchJson(DATASETS.equipment.url, 150, 'SRD equipment'),
  fetchJson(DATASETS.magicItems.url, 200, 'SRD magic item'),
  fetchJson(DATASETS.backgrounds.url, 4, 'SRD background'),
  fetchJson(DATASETS.poisons.url, 10, 'SRD poison'),
])

const featureRecords = featureSource
  .map((feature) => {
    const levelMatch = String(feature?.level?.name ?? '').match(/(\d+)$/)
    return {
      id: String(feature?.index ?? ''),
      className: String(feature?.class?.name ?? ''),
      level: levelMatch ? Number(levelMatch[1]) : 0,
      name: String(feature?.name ?? ''),
      description: cleanDescription(feature?.description),
    }
  })
  .filter((feature) => feature.id && feature.className && feature.level >= 1 && feature.name)

const featRecords = featSource
  .map((feat) => {
    const minimumLevelRaw = Number(feat?.prerequisites?.minimum_level)
    return {
      id: String(feat?.index ?? ''),
      name: String(feat?.name ?? ''),
      type: String(feat?.type ?? ''),
      minimumLevel: Number.isFinite(minimumLevelRaw) && minimumLevelRaw > 0
        ? Math.round(minimumLevelRaw)
        : null,
      prerequisite: prereqText(feat),
      description: cleanDescription(feat?.description),
      repeatable: cleanDescription(feat?.repeatable),
    }
  })
  .filter((feat) => feat.id && feat.name && feat.type)
  .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))

const spellRecords = spellSource
  .map((spell) => ({
    id: String(spell?.index ?? ''),
    name: String(spell?.name ?? ''),
    level: Math.max(0, Math.min(9, Math.round(Number(spell?.level ?? 0)))),
    school: String(spell?.school?.name ?? ''),
    classes: Array.isArray(spell?.classes)
      ? spell.classes.map((entry) => String(entry?.name ?? '')).filter(Boolean)
      : [],
    castingTime: String(spell?.casting_time ?? ''),
    ritual: Boolean(spell?.ritual),
    range: String(spell?.range ?? ''),
    components: Array.isArray(spell?.components)
      ? spell.components.map((entry) => String(entry ?? '')).filter(Boolean)
      : [],
    material: String(spell?.material ?? ''),
    duration: String(spell?.duration ?? ''),
    concentration: Boolean(spell?.concentration),
    attackType: String(spell?.attack_type ?? ''),
    saveAbility: String(spell?.dc?.dc_type?.name ?? ''),
    saveEffect: String(spell?.dc?.dc_success ?? ''),
    area: spellArea(spell),
    damageType: String(spell?.damage?.damage_type?.name ?? ''),
    damageAtSlotLevel: recordMap(spell?.damage?.damage_at_slot_level),
    damageAtCharacterLevel: recordMap(spell?.damage?.damage_at_character_level),
    healAtSlotLevel: recordMap(spell?.heal_at_slot_level),
    description: cleanDescription(spell?.description),
    higherLevel: cleanDescription(spell?.higher_level),
  }))
  .filter((spell) => spell.id && spell.name && spell.school && spell.classes.length)
  .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))

const referenceNames = (value) => Array.isArray(value)
  ? value.map((entry) => String(entry?.name ?? '')).filter(Boolean)
  : []

const equipmentRecords = equipmentSource.map((item) => ({
  id: String(item?.index ?? ''),
  name: String(item?.name ?? ''),
  categories: referenceNames(item?.equipment_categories),
  cost: item?.cost ? `${item.cost.quantity ?? ''} ${item.cost.unit ?? ''}`.trim() : '',
  weight: Number.isFinite(Number(item?.weight)) ? Number(item.weight) : null,
  description: cleanDescription(item?.description),
  damageDice: String(item?.damage?.damage_dice ?? ''),
  damageType: String(item?.damage?.damage_type?.name ?? ''),
  versatileDamage: String(item?.two_handed_damage?.damage_dice ?? ''),
  rangeNormal: Number.isFinite(Number(item?.range?.normal)) ? Number(item.range.normal) : null,
  rangeLong: Number.isFinite(Number(item?.range?.long)) ? Number(item.range.long) : null,
  properties: referenceNames(item?.properties),
  mastery: String(item?.mastery?.name ?? ''),
  armorClass: Number.isFinite(Number(item?.armor_class?.base)) ? Number(item.armor_class.base) : null,
  dexBonus: item?.armor_class?.dex_bonus === true,
  maxDexBonus: Number.isFinite(Number(item?.armor_class?.max_bonus)) ? Number(item.armor_class.max_bonus) : null,
  strengthMinimum: Number.isFinite(Number(item?.str_minimum)) ? Number(item.str_minimum) : null,
  stealthDisadvantage: item?.stealth_disadvantage === true,
  contents: Array.isArray(item?.contents) ? item.contents.map((entry) => ({ name: String(entry?.item?.name ?? ''), quantity: Number(entry?.quantity ?? 1) })).filter((entry) => entry.name) : [],
})).filter((item) => item.id && item.name).sort((a, b) => a.name.localeCompare(b.name))

const magicItemRecords = magicItemSource.map((item) => ({
  id: String(item?.index ?? ''),
  name: String(item?.name ?? ''),
  category: String(item?.equipment_category?.name ?? 'Magic Item'),
  rarity: String(item?.rarity?.name ?? 'Unknown'),
  attunement: item?.attunement === true,
  description: cleanDescription(item?.desc),
  image: String(item?.image ?? ''),
})).filter((item) => item.id && item.name).sort((a, b) => a.name.localeCompare(b.name))

const backgroundRecords = backgroundSource.map((background) => ({
  id: String(background?.index ?? ''),
  name: String(background?.name ?? ''),
  abilityScores: referenceNames(background?.ability_scores),
  feat: String(background?.feat?.name ?? ''),
  featNote: String(background?.feat?.note ?? ''),
  proficiencies: referenceNames(background?.proficiencies),
  equipment: Array.isArray(background?.equipment_options) ? background.equipment_options.map((entry) => cleanDescription(entry?.desc)).filter(Boolean) : [],
})).filter((entry) => entry.id && entry.name).sort((a, b) => a.name.localeCompare(b.name))

const poisonRecords = poisonSource.map((poison) => ({
  id: String(poison?.index ?? ''),
  name: String(poison?.name ?? ''),
  type: String(poison?.type ?? ''),
  costGp: Number.isFinite(Number(poison?.cost)) ? Number(poison.cost) : null,
  description: cleanDescription(poison?.description),
})).filter((entry) => entry.id && entry.name).sort((a, b) => a.name.localeCompare(b.name))

const featureOutput = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: 5e-bits/5e-database 2024 SRD feature dataset.
// Underlying SRD content: Wizards of the Coast SRD 5.2.x, CC-BY-4.0.
export interface SrdClassFeatureRecord {
  id: string
  className: string
  level: number
  name: string
  description: string
}

export const SRD_CLASS_FEATURES: SrdClassFeatureRecord[] = ${JSON.stringify(featureRecords, null, 2)}
`

const featOutput = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: 5e-bits/5e-database 2024 SRD feat dataset.
// Underlying SRD content: Wizards of the Coast SRD 5.2.x, CC-BY-4.0.
export interface SrdFeatRecord {
  id: string
  name: string
  type: string
  minimumLevel: number | null
  prerequisite: string
  description: string
  repeatable: string
}

export const SRD_FEATS: SrdFeatRecord[] = ${JSON.stringify(featRecords, null, 2)}
`

const spellOutput = `// GENERATED FILE — DO NOT EDIT BY HAND.
// Source: 5e-bits/5e-database 2024 SRD spell dataset.
// Underlying SRD content: Wizards of the Coast SRD 5.2.x, CC-BY-4.0.
export interface SrdSpellRecord {
  id: string
  name: string
  level: number
  school: string
  classes: string[]
  castingTime: string
  ritual: boolean
  range: string
  components: string[]
  material: string
  duration: string
  concentration: boolean
  attackType: string
  saveAbility: string
  saveEffect: string
  area: string
  damageType: string
  damageAtSlotLevel: Record<string, string>
  damageAtCharacterLevel: Record<string, string>
  healAtSlotLevel: Record<string, string>
  description: string
  higherLevel: string
}

export const SRD_SPELLS: SrdSpellRecord[] = ${JSON.stringify(spellRecords, null, 2)}
`

const generatedHeader = (kind) => `// GENERATED FILE — DO NOT EDIT BY HAND.\n// Source: 5e-bits/5e-database 2024 SRD ${kind} dataset.\n// Underlying content: Wizards of the Coast SRD 5.2.1, CC-BY-4.0.\n`
const equipmentOutput = `${generatedHeader('equipment')}export const SRD_EQUIPMENT = ${JSON.stringify(equipmentRecords, null, 2)} as const\n`
const magicItemOutput = `${generatedHeader('magic item')}export const SRD_MAGIC_ITEMS = ${JSON.stringify(magicItemRecords, null, 2)} as const\n`
const backgroundOutput = `${generatedHeader('background')}export const SRD_BACKGROUNDS = ${JSON.stringify(backgroundRecords, null, 2)} as const\n`
const poisonOutput = `${generatedHeader('poison')}export const SRD_POISONS = ${JSON.stringify(poisonRecords, null, 2)} as const\n`

await Promise.all([
  writeFile(DATASETS.features.output, featureOutput, 'utf8'),
  writeFile(DATASETS.feats.output, featOutput, 'utf8'),
  writeFile(DATASETS.spells.output, spellOutput, 'utf8'),
  writeFile(DATASETS.equipment.output, equipmentOutput, 'utf8'),
  writeFile(DATASETS.magicItems.output, magicItemOutput, 'utf8'),
  writeFile(DATASETS.backgrounds.output, backgroundOutput, 'utf8'),
  writeFile(DATASETS.poisons.output, poisonOutput, 'utf8'),
])

console.log(`SRD class feature data synced: ${featureRecords.length} records -> ${DATASETS.features.output}`)
console.log(`SRD feat data synced: ${featRecords.length} records -> ${DATASETS.feats.output}`)
console.log(`SRD spell data synced: ${spellRecords.length} records -> ${DATASETS.spells.output}`)
console.log(`SRD equipment data synced: ${equipmentRecords.length} records -> ${DATASETS.equipment.output}`)
console.log(`SRD magic item data synced: ${magicItemRecords.length} records -> ${DATASETS.magicItems.output}`)
console.log(`SRD background data synced: ${backgroundRecords.length} records -> ${DATASETS.backgrounds.output}`)
console.log(`SRD poison data synced: ${poisonRecords.length} records -> ${DATASETS.poisons.output}`)

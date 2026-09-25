import { SRD_BACKGROUNDS } from '../data/srdBackgrounds.generated'
import { SRD_CLASS_FEATURES } from '../data/srdClassFeatures.generated'
import { SRD_EQUIPMENT } from '../data/srdEquipment.generated'
import { SRD_FEATS } from '../data/srdFeats.generated'
import { SRD_MAGIC_ITEMS } from '../data/srdMagicItems.generated'
import { SRD_POISONS } from '../data/srdPoisons.generated'
import { SRD_SPELLS } from '../data/srdSpells.generated'
import type { ContentEntryType, ContentLibraryEntry } from '../types/contentLibrary'

const SOURCE_ID = 'srd-5.2.1'
const SOURCE_LABEL = 'SRD 5.2.1 (2024)'

function entry(
  value: Omit<ContentLibraryEntry, 'sourceId' | 'sourceLabel' | 'rulesVersion' | 'rarity' | 'tags' | 'facts'> &
    Partial<Pick<ContentLibraryEntry, 'rarity' | 'tags' | 'facts'>>,
): ContentLibraryEntry {
  return {
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    rulesVersion: '2024',
    rarity: '',
    tags: [],
    facts: [],
    ...value,
  }
}

function equipmentType(categories: readonly string[], contents: readonly unknown[]): ContentEntryType {
  const joined = categories.join(' ').toLowerCase()
  if (contents.length || joined.includes('pack')) return 'pack'
  if (joined.includes('armor') || joined.includes('shield')) return 'armor'
  if (joined.includes('weapon')) return 'weapon'
  return 'equipment'
}

function cleanDescription(value: string): string {
  return value.replace(/\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim()
}

export const OPEN_RULES_LIBRARY: ContentLibraryEntry[] = [
  ...SRD_SPELLS.map((spell) => entry({
    id: `spell:${spell.id}`,
    name: spell.name,
    type: spell.level === 0 ? 'cantrip' as const : 'spell' as const,
    category: spell.school,
    summary: spell.level === 0 ? `${spell.school} cantrip` : `Level ${spell.level} ${spell.school}`,
    description: cleanDescription([spell.description, spell.higherLevel].filter(Boolean).join('\n\nAt Higher Levels\n')),
    tags: [...spell.classes, spell.school, spell.concentration ? 'Concentration' : '', spell.ritual ? 'Ritual' : ''].filter(Boolean),
    facts: [
      { label: 'Casting', value: spell.castingTime },
      { label: 'Range', value: spell.range },
      { label: 'Duration', value: spell.duration },
      { label: 'Components', value: spell.components.join(', ') || '—' },
      { label: 'Classes', value: spell.classes.join(', ') || '—' },
    ],
  })),
  ...SRD_EQUIPMENT.map((item) => {
    const type = equipmentType(item.categories, item.contents)
    return entry({
      id: `equipment:${item.id}`,
      name: item.name,
      type,
      category: item.categories.join(' · ') || 'Equipment',
      summary: [item.cost, item.weight ? `${item.weight} lb.` : ''].filter(Boolean).join(' · '),
      description: cleanDescription(item.description),
      tags: [...item.categories, ...item.properties, item.mastery].filter(Boolean),
      facts: [
        { label: 'Cost', value: item.cost || '—' },
        { label: 'Weight', value: item.weight ? `${item.weight} lb.` : '—' },
        ...(item.damageDice ? [{ label: 'Damage', value: `${item.damageDice} ${item.damageType}`.trim() }] : []),
        ...(item.armorClass ? [{ label: 'Armor Class', value: String(item.armorClass) }] : []),
        ...(item.mastery ? [{ label: 'Mastery', value: item.mastery }] : []),
        ...(item.contents.length ? [{ label: 'Contents', value: item.contents.map((content) => `${content.quantity}× ${content.name}`).join(', ') }] : []),
      ],
    })
  }),
  ...SRD_MAGIC_ITEMS.map((item) => entry({
    id: `magic-item:${item.id}`,
    name: item.name,
    type: 'magic-item',
    category: item.category || 'Magic Item',
    rarity: item.rarity,
    summary: [item.rarity, item.attunement ? 'Attunement' : ''].filter(Boolean).join(' · '),
    description: cleanDescription(item.description),
    tags: [item.category, item.rarity, item.attunement ? 'Attunement' : ''].filter(Boolean),
    facts: [
      { label: 'Rarity', value: item.rarity || '—' },
      { label: 'Attunement', value: item.attunement ? 'Required' : 'Not required' },
    ],
  })),
  ...SRD_BACKGROUNDS.map((background) => entry({
    id: `background:${background.id}`,
    name: background.name,
    type: 'background',
    category: 'Background',
    summary: `${background.feat}${background.featNote ? ` (${background.featNote})` : ''}`,
    description: background.equipment.join('\n'),
    tags: [...background.abilityScores, ...background.proficiencies, background.feat],
    facts: [
      { label: 'Abilities', value: background.abilityScores.join(', ') },
      { label: 'Origin Feat', value: `${background.feat}${background.featNote ? ` (${background.featNote})` : ''}` },
      { label: 'Proficiencies', value: background.proficiencies.join(', ') },
    ],
  })),
  ...SRD_POISONS.map((poison) => entry({
    id: `poison:${poison.id}`,
    name: poison.name,
    type: 'poison',
    category: `${poison.type} poison`,
    summary: `${poison.costGp} gp · ${poison.type}`,
    description: cleanDescription(poison.description),
    tags: [poison.type, 'Poison'],
    facts: [
      { label: 'Type', value: poison.type },
      { label: 'Cost', value: `${poison.costGp} gp` },
    ],
  })),
  ...SRD_FEATS.map((feat) => entry({
    id: `feat:${feat.id}`,
    name: feat.name,
    type: 'feat',
    category: feat.type || 'Feat',
    summary: feat.prerequisite || feat.type,
    description: cleanDescription(feat.description),
    tags: [feat.type, feat.prerequisite].filter(Boolean),
    facts: [
      { label: 'Type', value: feat.type || 'Feat' },
      { label: 'Prerequisite', value: feat.prerequisite || 'None' },
      { label: 'Repeatable', value: feat.repeatable || 'No' },
    ],
  })),
  ...SRD_CLASS_FEATURES.map((feature) => entry({
    id: `class-feature:${feature.id}`,
    name: feature.name,
    type: 'class-feature',
    category: feature.className,
    summary: `${feature.className} · Level ${feature.level}`,
    description: cleanDescription(feature.description),
    tags: [feature.className, `Level ${feature.level}`],
    facts: [
      { label: 'Class', value: feature.className },
      { label: 'Level', value: String(feature.level) },
    ],
  })),
].sort((left, right) => left.name.localeCompare(right.name))

export function searchRulesLibrary(
  entries: ContentLibraryEntry[],
  query: string,
  type: ContentEntryType | 'all',
  rarity: string,
): ContentLibraryEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  return entries.filter((item) => {
    if (type !== 'all' && item.type !== type) return false
    if (rarity && item.rarity !== rarity) return false
    if (!needle) return true
    return [item.name, item.category, item.sourceLabel, item.summary, ...item.tags]
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle)
  })
}

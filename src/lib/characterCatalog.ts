export const CHARACTER_SPECIES_OPTIONS = [
  'Aasimar',
  'Dragonborn',
  'Dwarf',
  'Elf',
  'Gnome',
  'Goliath',
  'Halfling',
  'Human',
  'Orc',
  'Tiefling',
] as const

export const CHARACTER_BACKGROUND_OPTIONS = [
  'Acolyte',
  'Artisan',
  'Charlatan',
  'Criminal',
  'Entertainer',
  'Farmer',
  'Guard',
  'Guide',
  'Hermit',
  'Merchant',
  'Noble',
  'Sage',
  'Sailor',
  'Scribe',
  'Soldier',
  'Wayfarer',
] as const

export const CHARACTER_SUBCLASS_OPTIONS: Record<string, readonly string[]> = {
  barbarian: [
    'Path of the Berserker',
    'Path of the Wild Heart',
    'Path of the World Tree',
    'Path of the Zealot',
  ],
  bard: [
    'College of Dance',
    'College of Glamour',
    'College of Lore',
    'College of Valor',
  ],
  cleric: [
    'Life Domain',
    'Light Domain',
    'Trickery Domain',
    'War Domain',
  ],
  druid: [
    'Circle of the Land',
    'Circle of the Moon',
    'Circle of the Sea',
    'Circle of the Stars',
  ],
  fighter: [
    'Battle Master',
    'Champion',
    'Eldritch Knight',
    'Psi Warrior',
  ],
  monk: [
    'Warrior of Mercy',
    'Warrior of Shadow',
    'Warrior of the Elements',
    'Warrior of the Open Hand',
  ],
  paladin: [
    'Oath of Devotion',
    'Oath of Glory',
    'Oath of the Ancients',
    'Oath of Vengeance',
  ],
  ranger: [
    'Beast Master',
    'Fey Wanderer',
    'Gloom Stalker',
    'Hunter',
  ],
  rogue: [
    'Arcane Trickster',
    'Assassin',
    'Soulknife',
    'Thief',
  ],
  sorcerer: [
    'Aberrant Sorcery',
    'Clockwork Sorcery',
    'Draconic Sorcery',
    'Wild Magic Sorcery',
  ],
  warlock: [
    'Archfey Patron',
    'Celestial Patron',
    'Fiend Patron',
    'Great Old One Patron',
  ],
  wizard: [
    'Abjurer',
    'Diviner',
    'Evoker',
    'Illusionist',
  ],
}

export const OPEN_SRD_SUBCLASS_BY_CLASS: Record<string, string> = {
  barbarian: 'Path of the Berserker',
  bard: 'College of Lore',
  cleric: 'Life Domain',
  druid: 'Circle of the Land',
  fighter: 'Champion',
  monk: 'Warrior of the Open Hand',
  paladin: 'Oath of Devotion',
  ranger: 'Hunter',
  rogue: 'Thief',
  sorcerer: 'Draconic Sorcery',
  warlock: 'Fiend Patron',
  wizard: 'Evoker',
}

export interface OpenBackgroundRules {
  abilityScores: string[]
  feat: string
  skills: string[]
  tool: string
}

export const OPEN_BACKGROUND_RULES: Record<string, OpenBackgroundRules> = {
  Acolyte: {
    abilityScores: ['Intelligence', 'Wisdom', 'Charisma'],
    feat: 'Magic Initiate (Cleric)',
    skills: ['Insight', 'Religion'],
    tool: "Calligrapher's Supplies",
  },
  Criminal: {
    abilityScores: ['Dexterity', 'Constitution', 'Intelligence'],
    feat: 'Alert',
    skills: ['Sleight of Hand', 'Stealth'],
    tool: "Thieves' Tools",
  },
  Sage: {
    abilityScores: ['Constitution', 'Intelligence', 'Wisdom'],
    feat: 'Magic Initiate (Wizard)',
    skills: ['Arcana', 'History'],
    tool: "Calligrapher's Supplies",
  },
  Soldier: {
    abilityScores: ['Strength', 'Dexterity', 'Constitution'],
    feat: 'Savage Attacker',
    skills: ['Athletics', 'Intimidation'],
    tool: 'Gaming Set (choose one)',
  },
}

export function normalizedCatalogKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function subclassesForClass(className: string): readonly string[] {
  return CHARACTER_SUBCLASS_OPTIONS[normalizedCatalogKey(className)] ?? []
}

export function canonicalSubclassName(className: string, subclassName: string): string {
  const classKey = normalizedCatalogKey(className)
  const subclassKey = normalizedCatalogKey(subclassName)

  if (classKey === 'warlock' && ['fiend', 'thefiend', 'fiendpatron'].includes(subclassKey)) {
    return 'Fiend Patron'
  }

  const exact = subclassesForClass(className).find(
    (entry) => normalizedCatalogKey(entry) === subclassKey,
  )

  return exact ?? subclassName
}

export function hasBundledSubclassRules(className: string, subclassName: string): boolean {
  const classKey = normalizedCatalogKey(className)
  const openSubclass = OPEN_SRD_SUBCLASS_BY_CLASS[classKey]
  if (!openSubclass) return false

  return normalizedCatalogKey(openSubclass) === normalizedCatalogKey(canonicalSubclassName(className, subclassName))
}

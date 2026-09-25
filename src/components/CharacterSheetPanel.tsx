import {
  useEffect,
  useState,
} from 'react'

import {
  abilityModifier,
} from '../rules/dnd2024'

import {
  SKILL_ABILITY,
  SKILL_LABELS,
  savingThrowModifier,
  signed,
  skillModifier,
} from '../lib/characterSheet'

import {
  DEFAULT_CHARACTER_SHEET,
  DAMAGE_TYPES,
  type Actor,
  type ActorAbility,
  type CharacterSheetData,
  type CharacterSkill,
} from '../types/actor'
import type { ActorAttackProfile } from '../types/combatActions'
import { SRD_EQUIPMENT } from '../data/srdEquipment.generated'

import {
  automaticSavingThrows,
  automaticSpellcastingAbility,
} from '../lib/characterAutomation'

import {
  automaticCharacterDefenseSources,
  effectiveDamageDefenses,
  DEFENSE_FEATURE_MONK_SUPERIOR_DEFENSE,
  DEFENSE_FEATURE_RAGE,
  DRAGONBORN_ANCESTRIES,
  FIENDISH_RESILIENCE_OPTIONS,
  TIEFLING_LEGACIES,
} from '../lib/characterDefenseAutomation'

import {
  spellAttackBonus,
  spellSaveDc,
} from '../rules/dnd2024'

import {
  bundledSubclassRulesLabel,
  characterFeaturesAtLevel,
  nextCharacterFeatures,
  xpProgress,
} from '../lib/progression'

import {
  canonicalSubclassName,
  hasBundledSubclassRules,
} from '../lib/characterCatalog'

import {
  PLAYABLE_BACKGROUNDS,
  PLAYABLE_CATALOG_COUNTS,
  PLAYABLE_CLASSES,
  PLAYABLE_SPECIES,
  playableOptionById,
  playableSubclassesForClass,
  preferredPlayableOptionId,
  type PlayableCatalogOption,
} from '../data/playableCatalog.generated'
import { SRD_BACKGROUNDS } from '../data/srdBackgrounds.generated'

import {
  backgroundGrantedFeatRecord,
  classSpellCatalog,
  featureGrantedSpells,
  featMeetsMinimumLevel,
  openFeatCatalog,
  selectedFeats,
  selectedSpells,
  spellLevelLabel,
  spellMechanicSummary,
} from '../lib/characterRulesCatalog'
import {
  addSelectedSpellPatch,
  removeSelectedSpellPatch,
  spellSelectionAvailability,
  togglePreparedSpellPatch,
} from '../lib/spellSelectionRules'

import {
  canSpendSpellSlot,
  normalizeSpentSlots,
  spellSlotPool,
  spendSpellSlot,
} from '../lib/spellRuntime'

import {
  playSpellSfx,
} from '../lib/audioManager'

interface CharacterSheetPanelProps {
  actor: Actor | null
  canEdit: boolean
  title?: string
  onClose?: () => void
  onCreate?: () => Promise<void>
  onUpdate: (
    patch: Partial<Actor>,
  ) => Promise<void>
  onMessage: (message: string) => void
  onUploadTokenImage?: (file: File) => Promise<void>
  onPlaceToken?: () => void
  tokenPlacedOnActiveMap?: boolean
  tokenColor?: string
  onTokenColorChange?: (color: string) => Promise<void>
  advancementMode?: 'xp' | 'milestone'
  canEditProgression?: boolean
  spellView?: 'hidden' | 'summary' | 'manage'
  onOpenSpell?: (spellId: string) => void
}

const ABILITIES: Array<{
  key: ActorAbility
  label: string
}> = [
  { key: 'strength', label: 'Strength' },
  { key: 'dexterity', label: 'Dexterity' },
  { key: 'constitution', label: 'Constitution' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'wisdom', label: 'Wisdom' },
  { key: 'charisma', label: 'Charisma' },
]

const SKILLS = Object.keys(SKILL_LABELS) as CharacterSkill[]

type SrdEquipmentItem = (typeof SRD_EQUIPMENT)[number]

// SRD_EQUIPMENT is `as const`, so each item's `categories` is a different literal tuple type.
// Widen to readonly string[] so .includes() accepts any category name.
function hasCategory(item: SrdEquipmentItem, category: string): boolean {
  return (item.categories as readonly string[]).includes(category)
}

const SRD_WEAPONS = SRD_EQUIPMENT.filter((item) =>
  hasCategory(item, 'Weapons') && Boolean(item.damageDice),
)

function profilesForSrdWeapon(actor: Actor, weaponId: string): ActorAttackProfile[] {
  const weapon = SRD_WEAPONS.find((item) => item.id === weaponId)
  if (!weapon) return []
  const properties = weapon.properties.map((property) => property.toLowerCase())
  const finesse = properties.includes('finesse')
  const rangedWeapon = hasCategory(weapon, 'Ranged Weapons')
  const chosenAbility: ActorAbility = finesse && actor.abilities.dexterity > actor.abilities.strength ? 'dexterity' : rangedWeapon ? 'dexterity' : 'strength'
  const damageType = weapon.damageType.toLowerCase() as ActorAttackProfile['damageType']
  const base = {
    name: weapon.name,
    ability: chosenAbility,
    proficient: true,
    attackBonus: null,
    damageFormula: weapon.damageDice,
    damageType,
    resource: 'action' as const,
  }
  if (rangedWeapon) {
    return [{
      id: `srd-weapon-${weapon.id}`,
      ...base,
      attackType: 'ranged',
      rangeFeet: weapon.rangeNormal ?? 60,
      longRangeFeet: weapon.rangeLong,
    }]
  }
  const profiles: ActorAttackProfile[] = [{
    id: `srd-weapon-${weapon.id}`,
    ...base,
    attackType: 'melee',
    ability: chosenAbility,
    rangeFeet: 5,
    longRangeFeet: null,
  }]
  if (properties.includes('thrown') && weapon.rangeNormal) {
    profiles.push({
      id: `srd-weapon-${weapon.id}-thrown`,
      ...base,
      name: `${weapon.name} (Thrown)`,
      attackType: 'ranged',
      rangeFeet: weapon.rangeNormal,
      longRangeFeet: weapon.rangeLong,
    })
  }
  return profiles
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function titleDamageType(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value)
  const safe = Number.isFinite(parsed) ? parsed : fallback
  return Math.max(min, Math.min(max, Math.round(safe)))
}

function toggleValue<T extends string>(
  values: T[],
  value: T,
  checked: boolean,
): T[] {
  if (checked) {
    return [...new Set([...values, value])]
  }

  return values.filter((entry) => entry !== value)
}

export function CharacterSheetPanel({
  actor,
  canEdit,
  title = 'Character Sheet',
  onClose,
  onCreate,
  onUpdate,
  onMessage,
  onUploadTokenImage,
  onPlaceToken,
  tokenPlacedOnActiveMap = false,
  tokenColor = '#C9954B',
  onTokenColorChange,
  advancementMode = 'xp',
  canEditProgression = canEdit,
  spellView = 'summary',
  onOpenSpell,
}: CharacterSheetPanelProps) {
  const [tokenColorDraft, setTokenColorDraft] = useState(tokenColor)

  useEffect(() => {
    setTokenColorDraft(tokenColor)
  }, [tokenColor])

  if (!actor) {
    return (
      <section className="character-sheet-empty">
        <div className="panel-heading">
          <span>PLAYER CHARACTER</span>
          <h2>{title}</h2>
        </div>
        <p className="empty-note">
          No Player Character is currently linked to this campaign seat. Restore your
          saved Character Vault sheet, create a new one if no vault exists, or let the
          DM assign an existing Player Actor to you.
        </p>
        <div className="character-sheet-empty-actions">
          {onCreate ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void onCreate().catch((error) => {
                  onMessage(
                    error instanceof Error
                      ? error.message
                      : 'Character sheet could not be created.',
                  )
                })
              }}
            >
              Restore / Create My Character
            </button>
          ) : null}
          {onClose ? (
            <button type="button" className="secondary-button" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      </section>
    )
  }

  const sheet = actor.characterSheet ?? { ...DEFAULT_CHARACTER_SHEET }
  const selectedClassOptionId = preferredPlayableOptionId(
    PLAYABLE_CLASSES,
    sheet.classOptionId,
    sheet.className,
    sheet.classRulesVersion === '2014' ? '2014' : '2024',
  )
  const selectedClassOption = playableOptionById(PLAYABLE_CLASSES, selectedClassOptionId)
  const selectedClassRulesVersion = selectedClassOption?.rulesVersion ?? (sheet.classRulesVersion === '2014' ? '2014' : '2024')
  const subclassCatalog = playableSubclassesForClass(sheet.className, selectedClassRulesVersion)
  const selectedSubclassOptionId = preferredPlayableOptionId(
    subclassCatalog as PlayableCatalogOption[],
    sheet.subclassOptionId,
    sheet.subclassName,
    selectedClassRulesVersion,
  )
  const selectedSpeciesOptionId = preferredPlayableOptionId(
    PLAYABLE_SPECIES,
    sheet.speciesOptionId,
    sheet.species,
    '2024',
  )
  const selectedSpeciesOption = playableOptionById(PLAYABLE_SPECIES, selectedSpeciesOptionId)
  const selectedBackgroundOptionId = preferredPlayableOptionId(
    PLAYABLE_BACKGROUNDS,
    sheet.backgroundOptionId,
    sheet.background,
    '2024',
  )
  const selectedBackgroundOption = playableOptionById(PLAYABLE_BACKGROUNDS, selectedBackgroundOptionId)
  const classSavingThrows = automaticSavingThrows(sheet.className)
  const spellcastingAbility = automaticSpellcastingAbility(sheet.className)
  const spellcastingAbilityScore = spellcastingAbility ? actor.abilities[spellcastingAbility] : 10
  const spellSelection = spellSelectionAvailability(sheet, actor.level, spellcastingAbilityScore)
  const backgroundRules = selectedBackgroundOption?.id.startsWith('phb2024:background:')
    ? SRD_BACKGROUNDS.find((background) => background.id === selectedBackgroundOption.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    : undefined
  const progression = xpProgress(actor.level, sheet.experiencePoints)
  const classFeatures = selectedClassRulesVersion === '2024' ? characterFeaturesAtLevel(sheet.className, sheet.subclassName, actor.level) : []
  const nextFeatures = selectedClassRulesVersion === '2024' ? nextCharacterFeatures(sheet.className, sheet.subclassName, actor.level) : []
  const featCatalog = openFeatCatalog()
  const chosenFeats = selectedFeats(sheet.selectedFeatIds ?? [])
  const grantedBackgroundFeatName = backgroundRules?.feat
    ? `${backgroundRules.feat}${backgroundRules.featNote ? ` (${backgroundRules.featNote})` : ''}`
    : null
  const grantedBackgroundFeat = backgroundRules ? backgroundGrantedFeatRecord(backgroundRules.name) : null
  const availableClassSpells = selectedClassRulesVersion === '2024' ? classSpellCatalog(sheet.className, actor.level) : []
  const manuallyKnownSpells = selectedSpells(sheet.knownSpellIds ?? [])
  const grantedSpells = selectedClassRulesVersion === '2024'
    ? featureGrantedSpells(
        sheet.className,
        sheet.subclassName,
        actor.level,
      )
    : []
  const grantedSpellIds = new Set(grantedSpells.map((spell) => spell.id))
  const chosenSpells = [...manuallyKnownSpells, ...grantedSpells]
    .filter((spell, index, spells) => spells.findIndex((entry) => entry.id === spell.id) === index)
    .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name))
  const preparedSpellIds = sheet.preparedSpellIds ?? []
  const preparedSpellCount = chosenSpells.filter(
    (spell) => spell.level === 0 || grantedSpellIds.has(spell.id) || (
      spellSelection.rules.wizardSpellbook
        ? preparedSpellIds.includes(spell.id)
        : manuallyKnownSpells.some((known) => known.id === spell.id)
    ),
  ).length
  const readySpells = chosenSpells.filter(
    (spell) => spell.level === 0 || grantedSpellIds.has(spell.id) || (
      spellSelection.rules.wizardSpellbook
        ? preparedSpellIds.includes(spell.id)
        : manuallyKnownSpells.some((known) => known.id === spell.id)
    ),
  )
  const slotPool = spellSlotPool(sheet.className, actor.level, selectedClassRulesVersion)
  const spentSlots = normalizeSpentSlots(slotPool.slots, sheet.spentSpellSlots)
  const concentratingSpell = chosenSpells.find(
    (spell) => spell.id === sheet.concentratingSpellId,
  ) ?? null
  const availableSpellLevels = [...new Set(
    availableClassSpells.map((spell) => spell.level),
  )]
  const defenseSources = automaticCharacterDefenseSources(actor)
  const effectiveDefenses = effectiveDamageDefenses(actor)
  const speciesKey = normalizedKey(sheet.species)
  const classKey = normalizedKey(sheet.className)
  const subclassKey = normalizedKey(sheet.subclassName)
  const displayedSubclass = canonicalSubclassName(sheet.className, sheet.subclassName)
  const bundledSubclass = bundledSubclassRulesLabel(sheet.className)
  const selectedSubclassHasBundledRules = hasBundledSubclassRules(sheet.className, displayedSubclass)
  const tokenInitials = actor.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?'
  const defenseSelections = sheet.defenseSelections ?? {}
  const activeDefenseFeatures = sheet.activeDefenseFeatures ?? []
  const combatActions = actor.combatActions ?? []

  const updateSheet = async (
    patch: Partial<CharacterSheetData>,
  ) => {
    if (!canEdit) return

    try {
      await onUpdate({
        characterSheet: {
          ...sheet,
          ...patch,
        },
      })
    } catch (error) {
      onMessage(
        error instanceof Error
          ? error.message
          : 'Character sheet could not be saved.',
      )
    }
  }

  const updateActor = async (
    patch: Partial<Actor>,
  ) => {
    if (!canEdit) return

    try {
      await onUpdate(patch)
    } catch (error) {
      onMessage(
        error instanceof Error
          ? error.message
          : 'Character could not be saved.',
      )
    }
  }

  const updateCombatAction = (id: string, patch: Partial<ActorAttackProfile>) => {
    void updateActor({ combatActions: combatActions.map((action) => action.id === id ? { ...action, ...patch } : action) })
  }

  const addFeat = (featId: string) => {
    if (!featId) return

    const feat = featCatalog.find((entry) => entry.id === featId)
    if (!feat) return

    const alreadyChosen = (sheet.selectedFeatIds ?? []).includes(featId)
    if (alreadyChosen && !feat.repeatable) return

    void updateSheet({
      selectedFeatIds: [...(sheet.selectedFeatIds ?? []), featId],
    })
  }

  const removeFeat = (selectionIndex: number) => {
    void updateSheet({
      selectedFeatIds: (sheet.selectedFeatIds ?? []).filter(
        (_, index) => index !== selectionIndex,
      ),
    })
  }

  const addSpell = (spellId: string) => {
    if (!spellId || (sheet.knownSpellIds ?? []).includes(spellId)) return
    const patch = addSelectedSpellPatch(sheet, actor.level, spellId, spellcastingAbilityScore)
    if (!patch) {
      onMessage(spellSelection.summary)
      return
    }
    void updateSheet(patch)
  }

  const removeSpell = (spellId: string) => {
    const patch = removeSelectedSpellPatch(sheet, actor.level, spellId, spellcastingAbilityScore)
    if (!patch) {
      onMessage(spellSelection.summary)
      return
    }
    void updateSheet(patch)
  }

  const togglePreparedSpell = (spellId: string, checked: boolean) => {
    const patch = togglePreparedSpellPatch(sheet, actor.level, spellId, checked, spellcastingAbilityScore)
    if (!patch) {
      onMessage('Wizard spell preparation changes are available during a Long Rest.')
      return
    }
    void updateSheet(patch)
  }

  const castSpell = (spellId: string, spellLevel: number, concentration: boolean) => {
    const slotLevel =
      spellLevel === 0
        ? 0
        : slotPool.kind === 'pact'
          ? slotPool.pactSlotLevel ?? spellLevel
          : spellLevel

    if (!canSpendSpellSlot(slotPool.slots, spentSlots, slotLevel)) {
      onMessage(`No level ${slotLevel} spell slot remains.`)
      return
    }

    void updateSheet({
      spentSpellSlots: spendSpellSlot(slotPool.slots, spentSlots, slotLevel),
      concentratingSpellId: concentration ? spellId : sheet.concentratingSpellId,
    })
    const spell = chosenSpells.find((entry) => entry.id === spellId)
    if (spell) void playSpellSfx(spell)
    onMessage(
      spellLevel === 0
        ? 'Cantrip cast. No spell slot spent.'
        : `Spell cast with a level ${slotLevel} slot.`,
    )
  }

  return (
    <section className="character-sheet">
      <div className="character-sheet-header">
        <div className="character-sheet-token">
          <span>TOKEN</span>
          <div
            className="character-sheet-token-frame"
            style={{ borderColor: tokenColor }}
          >
            {actor.portraitUrl ? (
              <img src={actor.portraitUrl} alt={`${actor.name} token`} />
            ) : (
              <b aria-label={`${actor.name} token placeholder`}>{tokenInitials}</b>
            )}
          </div>

          {canEdit && (onUploadTokenImage || onPlaceToken || onTokenColorChange) ? (
            <div className="character-token-controls">
              {onUploadTokenImage ? (
                <label className="character-token-upload">
                  <span>{actor.portraitUrl ? 'Change Image' : 'Add Image'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const input = event.currentTarget
                      const file = input.files?.[0]

                      if (!file) return

                      void onUploadTokenImage(file)
                        .catch((error) => {
                          onMessage(
                            error instanceof Error
                              ? error.message
                              : 'Token image could not be updated.',
                          )
                        })
                        .finally(() => {
                          input.value = ''
                        })
                    }}
                  />
                </label>
              ) : null}

              {onTokenColorChange ? (
                <div className="character-token-color" title="Token ring color">
                  <span>Ring</span>
                  <input
                    type="color"
                    value={tokenColorDraft}
                    aria-label="Token ring color"
                    onChange={(event) => setTokenColorDraft(event.target.value)}
                  />
                  <code>{tokenColorDraft}</code>
                  <button
                    type="button"
                    className="character-token-color-apply"
                    disabled={tokenColorDraft.toLowerCase() === tokenColor.toLowerCase()}
                    onClick={() => {
                      void onTokenColorChange(tokenColorDraft).catch((error) => {
                        setTokenColorDraft(tokenColor)
                        onMessage(
                          error instanceof Error
                            ? error.message
                            : 'Token color could not be updated.',
                        )
                      })
                    }}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className="character-token-color-cancel"
                    disabled={tokenColorDraft.toLowerCase() === tokenColor.toLowerCase()}
                    onClick={() => setTokenColorDraft(tokenColor)}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}

              {onPlaceToken ? (
                <button
                  type="button"
                  className="character-token-place"
                  disabled={!actor.portraitUrl || tokenPlacedOnActiveMap}
                  onClick={onPlaceToken}
                >
                  {tokenPlacedOnActiveMap ? 'On Map' : 'Place on Map'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="panel-heading">
          <span>PLAYER CHARACTER</span>
          <h2>{actor.name}</h2>
        </div>
        {onClose ? (
          <button type="button" className="character-sheet-close" onClick={onClose}>
            ×
          </button>
        ) : null}
      </div>

      <div className="character-identity-grid">
        <label>
          <span>Name</span>
          <input
            type="text"
            maxLength={80}
            value={actor.name}
            disabled={!canEdit}
            onChange={(event) => void updateActor({ name: event.target.value })}
          />
        </label>
        <label>
          <span>Class</span>
          <select
            value={selectedClassOptionId}
            disabled={!canEdit}
            onChange={(event) => {
              const nextClass = playableOptionById(PLAYABLE_CLASSES, event.target.value)
              if (!nextClass) {
                void updateSheet({
                  className: '',
                  classOptionId: '',
                  classRulesVersion: '',
                  subclassName: '',
                  subclassOptionId: '',
                  spellSelectionLevel: actor.level,
                  spellLevelUpReplacementsUsed: [],
                  spellLevelUpPendingReplacements: 0,
                  spellLevelUpPendingCantripReplacements: 0,
                  spellLevelUpNewPicksUsed: 0,
                  spellLevelUpCantripPicksUsed: 0,
                  spellLevelUpCantripReplacementsUsed: [],
                  spellLongRestActive: false,
                  spellLongRestChangesUsed: 0,
                  spellLongRestPendingReplacements: 0,
                  spellLongRestCantripChangesUsed: 0,
                  spellLongRestPendingCantripReplacements: 0,
                  spellSelectionInitialized: (sheet.knownSpellIds ?? []).length > 0,
                })
                return
              }

              const nextSubclasses = playableSubclassesForClass(nextClass.name, nextClass.rulesVersion)
              const sameSubclass = nextSubclasses.find((option) =>
                option.name.toLocaleLowerCase() === sheet.subclassName.trim().toLocaleLowerCase(),
              ) ?? null

              void updateSheet({
                className: nextClass.name,
                classOptionId: nextClass.id,
                classRulesVersion: nextClass.rulesVersion,
                subclassName: sameSubclass?.name ?? '',
                subclassOptionId: sameSubclass?.id ?? '',
                spellSelectionLevel: actor.level,
                spellLevelUpReplacementsUsed: [],
                spellLevelUpPendingReplacements: 0,
                spellLevelUpPendingCantripReplacements: 0,
                spellLevelUpNewPicksUsed: 0,
                spellLevelUpCantripPicksUsed: 0,
                spellLevelUpCantripReplacementsUsed: [],
                spellLongRestActive: false,
                spellLongRestChangesUsed: 0,
                spellLongRestPendingReplacements: 0,
                spellLongRestCantripChangesUsed: 0,
                spellLongRestPendingCantripReplacements: 0,
                spellSelectionInitialized: (sheet.knownSpellIds ?? []).length > 0,
              })
            }}
          >
            <option value="">Choose a class</option>
            {PLAYABLE_CLASSES.map((option) => (
              <option key={option.id} value={option.id}>{option.displayLabel}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Subclass</span>
          <select
            value={selectedSubclassOptionId}
            disabled={!canEdit || !sheet.className}
            onChange={(event) => {
              const option = playableOptionById(subclassCatalog, event.target.value)
              void updateSheet({
                subclassName: option?.name ?? '',
                subclassOptionId: option?.id ?? '',
              })
            }}
          >
            <option value="">{sheet.className ? 'Choose a subclass' : 'Choose a class first'}</option>
            {subclassCatalog.map((option) => (
              <option key={option.id} value={option.id}>{option.displayLabel}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Species / Race</span>
          <select
            value={selectedSpeciesOptionId}
            disabled={!canEdit}
            onChange={(event) => {
              const option = playableOptionById(PLAYABLE_SPECIES, event.target.value)
              void updateSheet({
                species: option?.name ?? '',
                speciesOptionId: option?.id ?? '',
              })
            }}
          >
            <option value="">Choose a species / race</option>
            {PLAYABLE_SPECIES.map((option) => (
              <option key={option.id} value={option.id}>{option.displayLabel}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Background</span>
          <select
            value={selectedBackgroundOptionId}
            disabled={!canEdit}
            onChange={(event) => {
              const option = playableOptionById(PLAYABLE_BACKGROUNDS, event.target.value)
              void updateSheet({
                background: option?.name ?? '',
                backgroundOptionId: option?.id ?? '',
              })
            }}
          >
            <option value="">Choose a background</option>
            {PLAYABLE_BACKGROUNDS.map((option) => (
              <option key={option.id} value={option.id}>{option.displayLabel}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Level</span>
          <input
            type="number"
            min="1"
            max="20"
            value={actor.level}
            disabled={!canEdit || !canEditProgression}
            title={canEditProgression ? 'DM-controlled character level' : 'Level is controlled by the DM / XP progression'}
            onChange={(event) => void updateActor({
              level: clampNumber(event.target.value, actor.level, 1, 20),
            })}
          />
        </label>
      </div>

      <p className="empty-note playable-catalog-note">
        Source-linked playable catalog · {PLAYABLE_CATALOG_COUNTS.classes} classes/editions · {PLAYABLE_CATALOG_COUNTS.subclasses} subclasses · {PLAYABLE_CATALOG_COUNTS.species} species/races · {PLAYABLE_CATALOG_COUNTS.backgrounds} backgrounds.
        {' '}2014 and 2024 options remain separate. Runtime automation is applied only where mechanics are implemented.
      </p>

      <div className="character-combat-strip">
        <label>
          <span>HP</span>
          <input
            type="number"
            min="0"
            max={actor.maxHp}
            value={actor.currentHp}
            disabled={!canEdit}
            onChange={(event) => void updateActor({
              currentHp: clampNumber(event.target.value, actor.currentHp, 0, actor.maxHp),
            })}
          />
        </label>
        <label>
          <span>Max HP</span>
          <input
            type="number"
            min="1"
            max="9999"
            value={actor.maxHp}
            disabled={!canEdit}
            onChange={(event) => void updateActor({
              maxHp: clampNumber(event.target.value, actor.maxHp, 1, 9999),
            })}
          />
        </label>
        <label>
          <span>Temp HP</span>
          <input
            type="number"
            min="0"
            max="9999"
            value={actor.tempHp}
            disabled={!canEdit}
            onChange={(event) => void updateActor({
              tempHp: clampNumber(event.target.value, actor.tempHp, 0, 9999),
            })}
          />
        </label>
        <label>
          <span>AC</span>
          <input
            type="number"
            min="0"
            max="40"
            value={actor.ac}
            disabled={!canEdit}
            onChange={(event) => void updateActor({
              ac: clampNumber(event.target.value, actor.ac, 0, 40),
            })}
          />
        </label>
        <label>
          <span>Speed</span>
          <input
            type="number"
            min="5"
            max="500"
            step="5"
            value={actor.speedFeet}
            disabled={!canEdit}
            onChange={(event) => void updateActor({
              speedFeet: clampNumber(event.target.value, actor.speedFeet, 5, 500),
            })}
          />
        </label>
        <div>
          <span>PB</span>
          <strong>{signed(actor.proficiencyBonus)}</strong>
        </div>
        <div>
          <span>Initiative</span>
          <strong>{signed(actor.initiativeBonus)}</strong>
        </div>
        {spellcastingAbility ? (
          <div>
            <span>Spell DC / Attack</span>
            <strong>
              {spellSaveDc(actor.level, actor.abilities[spellcastingAbility])}
              {' / '}
              {signed(spellAttackBonus(actor.level, actor.abilities[spellcastingAbility]))}
            </strong>
          </div>
        ) : null}
      </div>

      {actor.currentHp === 0 || actor.lifeState !== 'conscious' ? (
        <section className="character-death-status">
          <div>
            <span>LIFE STATUS</span>
            <strong>{actor.lifeState.toUpperCase()}</strong>
          </div>
          {actor.deathRules === 'character' ? (
            <div className="character-death-saves">
              <span>Death Saves</span>
              <b className="is-success">S {actor.deathSaveSuccesses}/3</b>
              <b className="is-failure">F {actor.deathSaveFailures}/3</b>
            </div>
          ) : (
            <small>Monster death rules: 0 HP means Dead unless the DM changes this Actor to Character Death Saves.</small>
          )}
        </section>
      ) : null}

      <section className="character-progression-card">
        <div className="character-progression-heading">
          <span>EXPERIENCE</span>
          <strong>Level {actor.level}</strong>
        </div>
        <div className="xp-track-wrap">
          <div className="xp-track" aria-label={`XP progress ${Math.round(progression.percent)} percent`}>
            <i style={{ width: `${progression.percent}%` }} />
          </div>
          <small>
            {progression.next === null
              ? 'Maximum level'
              : `${sheet.experiencePoints.toLocaleString()} / ${progression.next.toLocaleString()} XP`}
          </small>
        </div>
        <label className="xp-entry">
          <span>XP</span>
          <input
            type="number"
            min="0"
            value={sheet.experiencePoints}
            disabled={!canEdit || !canEditProgression}
            title={canEditProgression ? 'DM-controlled XP' : 'XP is controlled by the DM'}
            onChange={(event) => void updateSheet({
              experiencePoints: clampNumber(event.target.value, sheet.experiencePoints, 0, 999999),
            })}
          />
        </label>
        {advancementMode === 'milestone' ? (
          <small className="xp-mode-note">Milestone campaign · XP tracker remains available.</small>
        ) : null}
      </section>

      <div className="ability-score-grid">
        {ABILITIES.map(({ key, label }) => {
          const score = actor.abilities[key]
          const save = savingThrowModifier(actor, key)
          const classGrantedSave = classSavingThrows.includes(key)
          const saveProficient = classGrantedSave || sheet.savingThrowProficiencies.includes(key)
          const abilitySkills = SKILLS.filter((skill) => SKILL_ABILITY[skill] === key)

          return (
            <article className="ability-score-card" key={key}>
              <div className="ability-score-heading">
                <strong>{label}</strong>
                <label className="ability-score-value">
                  <span>Score</span>
                  <input
                    className="ability-score-input"
                    aria-label={`${label} score`}
                    type="number"
                    min="1"
                    max="30"
                    value={score}
                    disabled={!canEdit}
                    onChange={(event) => void updateActor({
                      abilities: {
                        ...actor.abilities,
                        [key]: clampNumber(event.target.value, score, 1, 30),
                      },
                    })}
                  />
                </label>
              </div>
              <div className="ability-modifier-line">
                <span>Modifier</span>
                <b>{signed(abilityModifier(score))}</b>
              </div>
              <label className="save-proficiency">
                <input
                  type="checkbox"
                  checked={saveProficient}
                  disabled={!canEdit || classGrantedSave}
                  onChange={(event) => void updateSheet({
                    savingThrowProficiencies: toggleValue(
                      sheet.savingThrowProficiencies,
                      key,
                      event.target.checked,
                    ),
                  })}
                />
                Saving Throw {signed(save)}{classGrantedSave ? ' · Class' : ''}
              </label>

              {abilitySkills.length ? (
                <div className="ability-skill-group">
                  {abilitySkills.map((skill) => {
                    const proficient = sheet.skillProficiencies.includes(skill)
                    const expertise = sheet.skillExpertise.includes(skill)

                    return (
                      <div className="ability-skill-row" key={skill}>
                        <span>
                          <b>{signed(skillModifier(actor, skill))}</b>
                          {SKILL_LABELS[skill]}
                        </span>
                        <label title="Proficiency">
                          <input
                            type="checkbox"
                            checked={proficient}
                            disabled={!canEdit || expertise}
                            onChange={(event) => void updateSheet({
                              skillProficiencies: toggleValue(
                                sheet.skillProficiencies,
                                skill,
                                event.target.checked,
                              ),
                            })}
                          />
                          P
                        </label>
                        <label title="Expertise">
                          <input
                            type="checkbox"
                            checked={expertise}
                            disabled={!canEdit}
                            onChange={(event) => {
                              const nextExpertise = toggleValue(
                                sheet.skillExpertise,
                                skill,
                                event.target.checked,
                              )

                              const nextProficiencies = event.target.checked
                                ? toggleValue(sheet.skillProficiencies, skill, true)
                                : sheet.skillProficiencies

                              void updateSheet({
                                skillExpertise: nextExpertise,
                                skillProficiencies: nextProficiencies,
                              })
                            }}
                          />
                          E
                        </label>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <small className="ability-no-skills">No associated skills</small>
              )}
            </article>
          )
        })}
      </div>

      <section className="character-feature-card character-feature-catalog">
        <div className="character-feature-heading">
          <div>
            <span>CLASS & SUBCLASS FEATURES</span>
            <h3>{sheet.className || 'Choose a class to reveal features'}</h3>
          </div>
          {sheet.subclassName ? <b>{displayedSubclass}</b> : null}
        </div>

        {classFeatures.length ? (
          <div className="character-feature-list">
            {classFeatures.map((feature) => (
              <details className="character-feature-entry" key={feature.id}>
                <summary>
                  <span>Level {feature.level}</span>
                  <strong>{feature.name}</strong>
                  <em>{feature.source === 'subclass' ? 'Subclass' : 'Class'}</em>
                </summary>
                <p>{feature.description}</p>
              </details>
            ))}
          </div>
        ) : sheet.className ? (
          <p className="character-rule-data-note">
            Open SRD feature data has not been synced yet. Run the SRD character-data sync once, then rebuild.
          </p>
        ) : null}

        {sheet.subclassName && !selectedSubclassHasBundledRules ? (
          <p className="character-rule-data-note is-external">
            <strong>{displayedSubclass}</strong> is selectable, but its detailed rules are not bundled in the free/open SRD core.
            {bundledSubclass ? ` The bundled open subclass for ${sheet.className} is ${bundledSubclass}.` : ''}
            {' '}This slot is ready for a local licensed/homebrew Rule Pack.
          </p>
        ) : null}

        {nextFeatures.length ? (
          <div className="character-next-features">
            <span>NEXT FEATURE UNLOCK</span>
            <div>
              {nextFeatures.map((feature) => (
                <b key={feature.id}>Level {feature.level} · {feature.name}</b>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="character-feature-card character-feat-catalog">
        <div className="character-feature-heading">
          <div>
            <span>FEATS</span>
            <h3>Open 2024 feat catalog</h3>
          </div>
          <b>{chosenFeats.length} selected</b>
        </div>

        {grantedBackgroundFeatName ? (
          <details className="character-feature-entry is-granted" open>
            <summary>
              <span>Background</span>
              <strong>{grantedBackgroundFeatName}</strong>
              <em>Granted</em>
            </summary>
            <p>
              {grantedBackgroundFeat
                ? grantedBackgroundFeat.description
                : 'This background grants an Origin Feat. Detailed rules for this exact background option are not bundled in the open core.'}
            </p>
          </details>
        ) : null}

        <label className="character-catalog-picker">
          <span>Add Feat</span>
          <select
            value=""
            disabled={!canEdit}
            onChange={(event) => {
              addFeat(event.target.value)
              event.currentTarget.value = ''
            }}
          >
            <option value="">Choose an open feat...</option>
            {featCatalog.map((feat) => {
              const levelLocked = !featMeetsMinimumLevel(feat, actor.level)
              const alreadyChosen = (sheet.selectedFeatIds ?? []).includes(feat.id)
              const duplicateLocked = alreadyChosen && !feat.repeatable

              return (
                <option
                  key={feat.id}
                  value={feat.id}
                  disabled={levelLocked || duplicateLocked}
                >
                  {feat.name} · {feat.type.replace(/-/g, ' ')}
                  {feat.minimumLevel ? ` · Lv ${feat.minimumLevel}+` : ''}
                  {duplicateLocked ? ' · selected' : ''}
                </option>
              )
            })}
          </select>
        </label>

        {chosenFeats.length ? (
          <div className="character-feature-list">
            {chosenFeats.map(({ feat, selectionIndex }) => (
              <details
                className="character-feature-entry"
                key={`${feat.id}-${selectionIndex}`}
              >
                <summary>
                  <span>{feat.type.replace(/-/g, ' ')}</span>
                  <strong>{feat.name}</strong>
                  <em>{feat.minimumLevel ? `Lv ${feat.minimumLevel}+` : 'Feat'}</em>
                </summary>
                <div className="character-rule-detail">
                  {feat.prerequisite ? (
                    <small><b>Prerequisite:</b> {feat.prerequisite}</small>
                  ) : null}
                  <p>{feat.description}</p>
                  {feat.repeatable ? <small>{feat.repeatable}</small> : null}
                  {canEdit ? (
                    <button
                      type="button"
                      className="character-inline-remove"
                      onClick={() => removeFeat(selectionIndex)}
                    >
                      Remove Feat
                    </button>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <p className="character-rule-data-note">
            No additional feats selected yet. Background-granted feats are shown separately above.
          </p>
        )}
      </section>

      {spellView === 'summary' ? (
        <section className="character-feature-card character-spell-summary">
          <div className="character-feature-heading">
            <div>
              <span>PLAYER SPELLBOOK</span>
              <h3>Prepared spells</h3>
            </div>
            <b>{preparedSpellCount} ready</b>
          </div>
          {readySpells.length ? (
            <div className="character-spell-summary-list">
              {readySpells.map((spell) => {
                const granted = grantedSpellIds.has(spell.id)
                return (
                  <button
                    type="button"
                    key={spell.id}
                    className="is-ready"
                    disabled={!onOpenSpell}
                    onClick={() => onOpenSpell?.(spell.id)}
                  >
                    <span>{spellLevelLabel(spell.level)}</span>
                    <strong>{spell.name}</strong>
                    <em>{granted ? 'Feature' : spell.level === 0 ? 'Cantrip' : 'Prepared'}</em>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="character-rule-data-note">This player has no prepared spells.</p>
          )}
        </section>
      ) : spellView === 'manage' ? (
      <section className="character-feature-card character-spell-catalog">
        <div className="character-feature-heading">
          <div>
            <span>SPELLS</span>
            <h3>{sheet.className ? `${sheet.className} spell list` : 'Choose a class to reveal spells'}</h3>
          </div>
          <b>{chosenSpells.length} known · {preparedSpellCount} ready</b>
        </div>

        {sheet.className && availableClassSpells.length ? (
          <label className="character-catalog-picker">
            <span>Add Cantrip / Spell</span>
            <select
              value=""
              disabled={!canEdit}
              onChange={(event) => {
                addSpell(event.target.value)
                event.currentTarget.value = ''
              }}
            >
              <option value="">Choose an available class spell...</option>
              {availableSpellLevels.map((level) => (
                <optgroup key={level} label={spellLevelLabel(level)}>
                  {availableClassSpells
                    .filter((spell) => spell.level === level)
                    .map((spell) => (
                      <option
                        key={spell.id}
                        value={spell.id}
                        disabled={(sheet.knownSpellIds ?? []).includes(spell.id) || grantedSpellIds.has(spell.id) || (
                          spell.level === 0 ? !spellSelection.canAddCantrip : !spellSelection.canAddLevelSpell
                        )}
                      >
                        {spell.name}{grantedSpellIds.has(spell.id) ? ' · feature' : (sheet.knownSpellIds ?? []).includes(spell.id) ? ' · added' : spell.level === 0 ? ' · cantrip' : ''}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        ) : sheet.className ? (
          <p className="character-rule-data-note">
            This class has no currently available open class spells at this level, or the spell catalog has not been synced yet.
          </p>
        ) : null}

        <div className="spell-selection-rules-status">
          <b>
            {spellSelection.knownCantripCount}/{spellSelection.rules.maxCantrips} cantrips
            {' · '}{spellSelection.knownLevelSpellCount}/{spellSelection.rules.maxKnownSpells} spells
            {spellSelection.rules.wizardSpellbook ? ` · ${spellSelection.preparedLevelSpellCount}/${spellSelection.rules.maxPreparedSpells} prepared` : ''}
          </b>
          <small>{spellSelection.summary}. Cantrips and level 1+ spells use separate class-level limits.</small>
          {spellSelection.remainingLevelUpSpellPicks || spellSelection.remainingLevelUpCantripPicks ? (
            <small>
              Level-up choices remaining: {spellSelection.remainingLevelUpCantripPicks} cantrip(s), {spellSelection.remainingLevelUpSpellPicks} spell(s).
            </small>
          ) : null}
        </div>

        {slotPool.slots.length ? (
          <div className="spell-slot-runtime">
            <div className="spell-slot-runtime-heading">
              <span>{slotPool.kind === 'pact' ? 'PACT MAGIC SLOTS' : 'SPELL SLOTS'}</span>
            </div>
            {sheet.spellLongRestActive ? <small className="spell-long-rest-active">DM has completed a Long Rest. Spell changes are open until the DM closes the window.</small> : null}
            <div className="spell-slot-pools">
              {slotPool.slots.map((maximum, index) => maximum > 0 ? (
                <div key={index + 1}>
                  <small>LEVEL {index + 1}</small>
                  <strong>{Math.max(0, maximum - (spentSlots[index] ?? 0))} / {maximum}</strong>
                </div>
              ) : null)}
            </div>
            {concentratingSpell ? (
              <div className="concentration-banner">
                <span>CONCENTRATING</span>
                <strong>{concentratingSpell.name}</strong>
                {canEdit ? (
                  <button type="button" onClick={() => void updateSheet({ concentratingSpellId: '' })}>
                    End
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {chosenSpells.length ? (
          <div className="character-spell-list">
            {chosenSpells.map((spell) => {
              const featureGranted = grantedSpellIds.has(spell.id)
              const prepared = spell.level === 0 || featureGranted || (
                spellSelection.rules.wizardSpellbook
                  ? preparedSpellIds.includes(spell.id)
                  : manuallyKnownSpells.some((known) => known.id === spell.id)
              )
              const slotDamage = Object.entries(spell.damageAtSlotLevel)
                .map(([level, dice]) => `slot ${level}: ${dice}`)
                .join(' · ')
              const characterDamage = Object.entries(spell.damageAtCharacterLevel)
                .map(([level, dice]) => `level ${level}: ${dice}`)
                .join(' · ')
              const healing = Object.entries(spell.healAtSlotLevel)
                .map(([level, amount]) => `slot ${level}: ${amount}`)
                .join(' · ')

              return (
                <details className="character-spell-entry" key={spell.id}>
                  <summary>
                    <span>{spellLevelLabel(spell.level)}</span>
                    <strong>{spell.name}</strong>
                    <em>{spell.school}</em>
                    <label
                      className="character-spell-prepared"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={prepared}
                        disabled={!canEdit || featureGranted || spell.level === 0 || !spellSelection.rules.wizardSpellbook || (
                          prepared ? !spellSelection.canUnprepareLevelSpell : !spellSelection.canPrepareLevelSpell
                        )}
                        onChange={(event) => togglePreparedSpell(spell.id, event.target.checked)}
                      />
                      {featureGranted ? 'Feature' : spell.level === 0 ? 'Cantrip' : spellSelection.rules.wizardSpellbook ? prepared ? 'Prepared' : 'In Spellbook' : 'Prepared'}
                    </label>
                  </summary>
                  <div className="character-spell-detail">
                    <div className="character-spell-tags">
                      {spellMechanicSummary(spell).map((tag) => (
                        <span key={`${spell.id}-${tag}`}>{tag}</span>
                      ))}
                    </div>
                    <dl>
                      <div><dt>Components</dt><dd>{spell.components.join(', ') || '—'}</dd></div>
                      <div><dt>Duration</dt><dd>{spell.duration || '—'}</dd></div>
                      {spell.saveAbility ? (
                        <div><dt>Save</dt><dd>{spell.saveAbility}{spell.saveEffect ? ` · ${spell.saveEffect}` : ''}</dd></div>
                      ) : null}
                      {spell.attackType ? (
                        <div><dt>Attack</dt><dd>{spell.attackType}</dd></div>
                      ) : null}
                      {spell.area ? (
                        <div><dt>Area</dt><dd>{spell.area}</dd></div>
                      ) : null}
                      {slotDamage || characterDamage ? (
                        <div>
                          <dt>Damage</dt>
                          <dd>{[slotDamage, characterDamage].filter(Boolean).join(' · ')}</dd>
                        </div>
                      ) : null}
                      {healing ? (
                        <div><dt>Healing</dt><dd>{healing}</dd></div>
                      ) : null}
                      {spell.material ? (
                        <div><dt>Material</dt><dd>{spell.material}</dd></div>
                      ) : null}
                    </dl>
                    <p>{spell.description}</p>
                    {spell.higherLevel ? (
                      <p className="character-spell-higher"><b>Higher Level:</b> {spell.higherLevel}</p>
                    ) : null}
                    {canEdit ? (
                      <div className="spell-runtime-actions">
                        <button
                          type="button"
                          className="spell-cast-button"
                          disabled={spell.level > 0 && !prepared}
                          onClick={() => castSpell(spell.id, spell.level, spell.concentration)}
                        >
                          {spell.level > 0 && !prepared ? 'Prepare to Cast' : 'Cast Spell'}
                        </button>
                        <button
                          type="button"
                          className="character-inline-remove"
                          disabled={featureGranted || (spell.level === 0 ? !spellSelection.canRemoveCantrip : !spellSelection.canRemoveLevelSpell)}
                          onClick={() => removeSpell(spell.id)}
                        >
                          {featureGranted ? 'Always Prepared' : spellSelection.rules.wizardSpellbook ? 'Spellbook Entry' : 'Remove Spell'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </details>
              )
            })}
          </div>
        ) : (
          <p className="character-rule-data-note">
            No spells added to this character yet. The spell catalog is local after the SRD sync.
          </p>
        )}

        <p className="character-rule-data-note">
          Casting now spends the correct standard or Pact Magic slot and tracks concentration. Attack/save resolution, target damage/healing, and VFX are connected in the next runtime step.
        </p>
      </section>
      ) : null}

      {sheet.background ? (
        <section className="character-background-card">
          <div>
            <span>BACKGROUND</span>
            <h3>{sheet.background}</h3>
          </div>
          {backgroundRules ? (
            <div className="character-background-rules">
              <p><b>Ability Scores</b>{backgroundRules.abilityScores.join(', ')}</p>
              <p><b>Origin Feat</b>{backgroundRules.feat}{backgroundRules.featNote ? ` (${backgroundRules.featNote})` : ''}</p>
              <p><b>Proficiencies</b>{backgroundRules.proficiencies.join(', ')}</p>
              <p><b>Equipment</b>{backgroundRules.equipment.join(' · ')}</p>
            </div>
          ) : (
            <p className="character-rule-data-note is-external">
              {selectedBackgroundOption
                ? `${selectedBackgroundOption.displayLabel} is saved from ${selectedBackgroundOption.sourceTitle}, but its detailed mechanics are not included in the local open rules catalog.`
                : 'This background is saved as a character choice, but its detailed mechanics are not included in the local open rules catalog.'}
            </p>
          )}
        </section>
      ) : null}

      <section className="character-defense-card">
        <div className="character-defense-heading">
          <div>
            <span>AUTOMATIC DAMAGE DEFENSES</span>
            <h3>Rule-driven resistances</h3>
          </div>
          <b>
            R {effectiveDefenses.resistances.length}
            {' · '}I {effectiveDefenses.immunities.length}
            {' · '}V {effectiveDefenses.vulnerabilities.length}
          </b>
        </div>

        {speciesKey === 'dragonborn' ? (
          <label className="character-defense-choice">
            <span>Draconic Ancestry</span>
            <select
              value={defenseSelections['dragonborn-ancestry'] ?? ''}
              disabled={!canEdit}
              onChange={(event) => void updateSheet({
                defenseSelections: {
                  ...defenseSelections,
                  'dragonborn-ancestry': event.target.value,
                },
              })}
            >
              <option value="">Choose ancestry</option>
              {DRAGONBORN_ANCESTRIES.map((ancestry) => (
                <option key={ancestry} value={ancestry}>{ancestry}</option>
              ))}
            </select>
          </label>
        ) : null}

        {speciesKey === 'tiefling' && selectedSpeciesOption?.rulesVersion === '2024' ? (
          <label className="character-defense-choice">
            <span>Fiendish Legacy</span>
            <select
              value={defenseSelections['tiefling-legacy'] ?? ''}
              disabled={!canEdit}
              onChange={(event) => void updateSheet({
                defenseSelections: {
                  ...defenseSelections,
                  'tiefling-legacy': event.target.value,
                },
              })}
            >
              <option value="">Choose legacy</option>
              {TIEFLING_LEGACIES.map((legacy) => (
                <option key={legacy} value={legacy}>{legacy}</option>
              ))}
            </select>
          </label>
        ) : null}

        {classKey === 'warlock' && ['fiend', 'fiendpatron', 'thefiend'].includes(subclassKey) && actor.level >= 10 ? (
          <label className="character-defense-choice">
            <span>Fiendish Resilience</span>
            <select
              value={defenseSelections['fiendish-resilience'] ?? ''}
              disabled={!canEdit}
              onChange={(event) => void updateSheet({
                defenseSelections: {
                  ...defenseSelections,
                  'fiendish-resilience': event.target.value,
                },
              })}
            >
              <option value="">Choose damage type</option>
              {FIENDISH_RESILIENCE_OPTIONS.map((damageType) => (
                <option key={damageType} value={damageType}>
                  {titleDamageType(damageType)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {classKey === 'barbarian' && actor.level >= 1 ? (
          <label className="character-defense-toggle">
            <input
              type="checkbox"
              checked={activeDefenseFeatures.includes(DEFENSE_FEATURE_RAGE)}
              disabled={!canEdit}
              onChange={(event) => void updateSheet({
                activeDefenseFeatures: toggleValue(
                  activeDefenseFeatures,
                  DEFENSE_FEATURE_RAGE,
                  event.target.checked,
                ),
              })}
            />
            <span>Rage active — B/P/S Resistance</span>
          </label>
        ) : null}

        {classKey === 'monk' && selectedClassRulesVersion === '2024' && actor.level >= 18 ? (
          <label className="character-defense-toggle">
            <input
              type="checkbox"
              checked={activeDefenseFeatures.includes(DEFENSE_FEATURE_MONK_SUPERIOR_DEFENSE)}
              disabled={!canEdit}
              onChange={(event) => void updateSheet({
                activeDefenseFeatures: toggleValue(
                  activeDefenseFeatures,
                  DEFENSE_FEATURE_MONK_SUPERIOR_DEFENSE,
                  event.target.checked,
                ),
              })}
            />
            <span>Superior Defense active — all damage except Force</span>
          </label>
        ) : null}

        {defenseSources.length > 0 ? (
          <div className="character-defense-source-list">
            {defenseSources.map((source) => (
              <article
                key={source.id}
                className={source.active ? 'is-active' : 'is-inactive'}
              >
                <div>
                  <strong>{source.label}</strong>
                  <small>{source.note}</small>
                </div>
                <span>
                  {source.mode.toUpperCase()}: {source.damageTypes.map(titleDamageType).join(', ')}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <p className="character-defense-empty">
            No automatic damage defense is currently active for this character.
          </p>
        )}

        <div className="character-defense-effective">
          <small>Effective Resistance</small>
          <strong>
            {effectiveDefenses.resistances.length
              ? effectiveDefenses.resistances.map(titleDamageType).join(', ')
              : 'None'}
          </strong>
        </div>
      </section>

      <details className="character-attack-editor" open={combatActions.length > 0}>
        <summary><span>Attacks & Weapons</span><b>{combatActions.length}</b></summary>
        <p>These attacks are saved on this Character. Attack bonus can be derived from the selected ability and Proficiency.</p>
        {combatActions.map((action) => (
          <article key={action.id}>
            <input aria-label="Attack name" value={action.name} disabled={!canEdit} onChange={(event) => updateCombatAction(action.id, { name: event.target.value })} />
            <select value={action.ability ?? ''} disabled={!canEdit} onChange={(event) => updateCombatAction(action.id, { ability: (event.target.value || null) as ActorAbility | null, attackBonus: null })}>
              <option value="">Fixed Bonus</option>
              {ABILITIES.map((ability) => <option value={ability.key} key={ability.key}>{ability.label}</option>)}
            </select>
            {action.ability ? <label><input type="checkbox" checked={action.proficient} disabled={!canEdit} onChange={(event) => updateCombatAction(action.id, { proficient: event.target.checked })} /> Proficient</label> : <input type="number" aria-label="Attack bonus" value={action.attackBonus ?? 0} disabled={!canEdit} onChange={(event) => updateCombatAction(action.id, { attackBonus: Number(event.target.value) })} />}
            <input aria-label="Damage formula" value={action.damageFormula} disabled={!canEdit} onChange={(event) => updateCombatAction(action.id, { damageFormula: event.target.value })} />
            <select value={action.damageType} disabled={!canEdit} onChange={(event) => updateCombatAction(action.id, { damageType: event.target.value as ActorAttackProfile['damageType'] })}>
              <option value="untyped">Untyped</option>{DAMAGE_TYPES.map((type) => <option value={type} key={type}>{type}</option>)}
            </select>
            <input type="number" aria-label="Range feet" value={action.rangeFeet} disabled={!canEdit} onChange={(event) => updateCombatAction(action.id, { rangeFeet: Number(event.target.value) })} />
            {canEdit ? <button type="button" onClick={() => void updateActor({ combatActions: combatActions.filter((candidate) => candidate.id !== action.id) })}>Remove</button> : null}
          </article>
        ))}
        {canEdit ? <label className="character-weapon-catalog"><span>Add a standard SRD weapon</span><select defaultValue="" onChange={(event) => {
          const profiles = profilesForSrdWeapon(actor, event.target.value)
          if (!profiles.length) return
          const existingIds = new Set(combatActions.map((action) => action.id))
          void updateActor({ combatActions: [...combatActions, ...profiles.filter((profile) => !existingIds.has(profile.id))] })
          event.currentTarget.value = ''
        }}><option value="">Choose weapon…</option>{SRD_WEAPONS.map((weapon) => <option value={weapon.id} key={weapon.id}>{weapon.name}{weapon.rangeNormal ? ` · ${weapon.rangeNormal}${weapon.rangeLong ? `/${weapon.rangeLong}` : ''} ft` : ' · melee'}</option>)}</select></label> : null}
        {canEdit ? <button type="button" className="secondary-button" onClick={() => void updateActor({ combatActions: [...combatActions, { id: `attack-${Date.now()}`, name: 'New Attack', attackType: 'melee', ability: 'strength', proficient: true, attackBonus: null, damageFormula: '1d8', damageType: 'slashing', rangeFeet: 5, longRangeFeet: null, resource: 'action' }] })}>Add Attack / Weapon</button> : null}
      </details>

      <label className="character-notes">
        <span>Notes</span>
        <textarea
          value={sheet.notes}
          maxLength={8000}
          disabled={!canEdit}
          onChange={(event) => void updateSheet({ notes: event.target.value })}
        />
      </label>

      <p className="character-derived-note">
        Class saving throws, ability modifiers, proficiency bonus, saving throws, skill modifiers, initiative, spell DC, and supported damage-defense features are calculated automatically. Open class features, feats, and spell data are stored locally after the SRD sync. Skill proficiency, expertise, feat choices, and prepared spells remain selectable character choices.
      </p>
    </section>
  )
}

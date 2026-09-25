import {
  MAGIC_SCHOOL_CHANTS,
  SPELL_AUDIO_PROFILES,
  type SpellSchool,
} from '../data/spellAudio'

export type SfxCue = string

interface AudioCueStatus {
  cue: string
  available: boolean
  format: string | null
  url: string | null
}

interface AudioManifest {
  cues: AudioCueStatus[]
  library?: Array<{ cue: string; url: string }>
  available: number
  missing: number
}

const cueUrls = new Map<string, string>()
let manifestPromise: Promise<void> | null = null
let lastRefreshAt = 0
let enabled = true
let volume = 0.72

async function loadManifest(force = false): Promise<void> {
  if (!force && manifestPromise) return manifestPromise

  manifestPromise = fetch('/api/audio/manifest')
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('Could not load the SFX manifest.')
      }

      const manifest = await response.json() as AudioManifest
      cueUrls.clear()

      for (const cue of manifest.cues ?? []) {
        if (cue.available && cue.url) {
          cueUrls.set(cue.cue, cue.url)
        }
      }

      for (const asset of manifest.library ?? []) {
        if (asset.cue && asset.url) cueUrls.set(asset.cue, asset.url)
      }

      lastRefreshAt = Date.now()
    })
    .catch(() => {
      cueUrls.clear()
      lastRefreshAt = Date.now()
    })

  return manifestPromise
}

export function initialiseSfx(): void {
  void loadManifest()
}

export async function refreshSfxManifest(): Promise<void> {
  await loadManifest(true)
}

export function setSfxEnabled(nextEnabled: boolean): void {
  enabled = nextEnabled
}

export function setSfxVolume(nextVolume: number): void {
  volume = Math.max(0, Math.min(1, Number(nextVolume) || 0))
}

export function getSfxCueStatus(cue: string): boolean {
  return cueUrls.has(cue)
}

export async function playSfx(
  cue: SfxCue,
  fallbackCues: SfxCue[] = [],
): Promise<boolean> {
  if (!enabled) return false

  await loadManifest()

  const candidates = [cue, ...fallbackCues]
  let url = candidates
    .map((candidate) => cueUrls.get(candidate))
    .find((candidateUrl): candidateUrl is string => Boolean(candidateUrl))

  if (!url && Date.now() - lastRefreshAt > 5000) {
    await loadManifest(true)
    url = candidates
      .map((candidate) => cueUrls.get(candidate))
      .find((candidateUrl): candidateUrl is string => Boolean(candidateUrl))
  }

  if (!url) return false

  try {
    const audio = new Audio(url)
    audio.preload = 'auto'
    audio.volume = volume
    await audio.play()
    return true
  } catch {
    return false
  }
}

function cueMatches(category: string, terms: string[]): string[] {
  const normalizedTerms = terms.map((term) => term.toLowerCase()).filter(Boolean)
  return [...cueUrls.keys()].filter((cue) => {
    const lower = cue.toLowerCase()
    return lower.startsWith(`${category}/`) && normalizedTerms.some((term) => lower.includes(term))
  })
}

function stableChoice(values: string[], seed: string): string | null {
  if (!values.length) return null
  let hash = 0
  for (const character of seed) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return values[Math.abs(hash) % values.length] ?? values[0]
}

export async function playDiceSfx(sides: number, total?: number): Promise<void> {
  void playSfx('dice/dice-shake', ['dice/dice-roll-wood', 'dice/dice-roll-stone'])
  window.setTimeout(() => {
    if (sides === 20 && total === 20) {
      void playSfx('dice/critical-hit', ['dice/dice-impact'])
    } else if (sides === 20 && total === 1) {
      void playSfx('dice/critical-fail', ['dice/dice-impact'])
    } else {
      void playSfx('dice/dice-impact', ['dice/dice-roll-wood'])
    }
  }, 180)
}

export async function playSpellSfx(spell: {
  id: string
  name?: string
  school: string
  damageType: string
  area: string
  healAtSlotLevel: Record<string, string>
}): Promise<boolean> {
  await loadManifest()
  const exactProfile = SPELL_AUDIO_PROFILES.find(
    (profile) => profile.spell.toLowerCase() === (spell.name ?? '').toLowerCase(),
  )
  if (exactProfile && cueUrls.has(exactProfile.cue)) {
    return playSfx(exactProfile.cue)
  }

  const damage = spell.damageType.toLowerCase()
  const school = spell.school.toLowerCase()
  const healing = Object.keys(spell.healAtSlotLevel).length > 0
  const terms = healing
    ? ['heal', 'holy']
    : damage.includes('fire') ? ['fire', 'flame']
      : damage.includes('cold') ? ['cold', 'frost', 'ice']
        : damage.includes('lightning') ? ['elec', 'light']
          : damage.includes('acid') ? ['acid']
            : damage.includes('thunder') ? ['sonic', 'sonc']
              : damage.includes('necrotic') ? ['negative', 'evil', 'death']
                : damage.includes('radiant') ? ['holy', 'sun']
                  : damage.includes('psychic') ? ['mind']
                    : [school.slice(0, 4), 'magic', 'odd']
  const formTerms = spell.area.toLowerCase().includes('cone') ? ['cone', ...terms] : terms
  const cue = stableChoice(cueMatches('magic', formTerms), spell.id)
  if (cue) return playSfx(cue)

  const schoolName = spell.school as SpellSchool
  const chants = MAGIC_SCHOOL_CHANTS[schoolName] ?? []
  return playSfx(
    stableChoice(chants.filter((candidate) => cueUrls.has(candidate)), spell.id) ?? 'magic/spell-cast',
  )
}

export async function playHealthSfx(operation: 'damage' | 'heal' | 'set-temp', damageType = ''): Promise<void> {
  await loadManifest()
  if (operation === 'heal') {
    const cue = stableChoice(cueMatches('magic', ['heal', 'holy']), `heal-${Date.now()}`)
    void playSfx(cue ?? 'magic/healing')
    return
  }
  if (operation === 'damage') {
    const terms = damageType === 'fire' ? ['fire', 'flame']
      : damageType === 'cold' ? ['cold', 'frost', 'ice']
        : damageType === 'lightning' ? ['elec', 'light']
          : damageType === 'acid' ? ['acid']
            : damageType === 'thunder' ? ['sonic', 'sonc']
              : damageType === 'necrotic' ? ['negative', 'death']
                : damageType === 'radiant' ? ['holy', 'sun']
                  : ['hit', 'impact']
    const cue = stableChoice(cueMatches('magic', terms), `${damageType}-${Date.now()}`)
    if (cue) void playSfx(cue)
  }
}

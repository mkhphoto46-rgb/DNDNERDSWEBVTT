export type SfxCue =
  | 'tokens/token-pickup'
  | 'tokens/token-drop'
  | 'tokens/token-move'
  | 'tokens/token-snap'

interface AudioCueStatus {
  cue: string
  available: boolean
  format: string | null
  url: string | null
}

interface AudioManifest {
  cues: AudioCueStatus[]
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

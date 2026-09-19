import fs from 'node:fs'
import path from 'node:path'

import {
  PROJECT_ROOT,
} from './paths'

const AUDIO_ROOT =
  path.join(
    PROJECT_ROOT,
    'assets-source',
    'audio',
  )

const SUPPORTED_EXTENSIONS =
  new Set([
    '.ogg',
    '.mp3',
    '.wav',
  ])

export const AUDIO_CUES = [
  'ui/button-hover',
  'ui/button-click',
  'ui/panel-open',
  'ui/panel-close',
  'ui/tab-change',
  'ui/toggle-on',
  'ui/toggle-off',
  'ui/error',
  'ui/success',
  'dice/dice-shake',
  'dice/dice-roll-wood',
  'dice/dice-roll-stone',
  'dice/dice-impact',
  'dice/critical-hit',
  'dice/critical-fail',
  'tokens/token-pickup',
  'tokens/token-drop',
  'tokens/token-move',
  'tokens/token-snap',
  'tokens/token-delete',
  'tokens/condition-add',
  'tokens/condition-remove',
  'combat/initiative-start',
  'combat/turn-change',
  'combat/round-change',
  'combat/combat-end',
  'doors/door-open-wood',
  'doors/door-close-wood',
  'doors/door-open-stone',
  'doors/door-close-stone',
  'doors/door-locked',
  'doors/secret-reveal',
  'doors/magical-secret-reveal',
  'magic/spell-cast',
  'magic/healing',
  'magic/fire',
  'magic/frost',
  'magic/lightning',
  'magic/necrotic',
  'magic/radiant',
  'magic/teleport',
  'atmosphere/session-start',
  'atmosphere/session-end',
  'atmosphere/map-reveal',
  'atmosphere/fog-reveal',
  'atmosphere/notification',
] as const

export interface AudioCueStatus {
  cue: string
  available: boolean
  format: string | null
  url: string | null
}

export interface AudioLibraryAsset {
  cue: string
  category: string
  filename: string
  format: string
  url: string
}

const CUE_ALIASES:
  Record<string, string[]> = {
    'dice/dice-shake': [
      'dice/dice_shake',
    ],
  }

export function ensureAudioDirectories(): void {
  for (const cue of AUDIO_CUES) {
    fs.mkdirSync(
      path.join(
        AUDIO_ROOT,
        path.dirname(cue),
      ),
      { recursive: true },
    )
  }
}

export function listAudioCueStatus(): AudioCueStatus[] {
  ensureAudioDirectories()

  return AUDIO_CUES.map(
    (cue) => {
      const candidates = [
        cue,
        ...(CUE_ALIASES[cue] ?? []),
      ]

      for (const candidate of candidates) {
        for (const extension of SUPPORTED_EXTENSIONS) {
          const absolutePath =
            path.join(
              AUDIO_ROOT,
              `${candidate}${extension}`,
            )

          if (fs.existsSync(absolutePath)) {
            return {
              cue,
              available: true,
              format: extension.slice(1),
              url: `/audio-assets/${candidate}${extension}`,
            }
          }
        }
      }

      return {
        cue,
        available: false,
        format: null,
        url: null,
      }
    },
  )
}

export function listAudioLibrary(): AudioLibraryAsset[] {
  ensureAudioDirectories()

  const assets: AudioLibraryAsset[] = []

  const visit =
    (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath =
          path.join(directory, entry.name)

        if (entry.isDirectory()) {
          visit(absolutePath)
          continue
        }

        const extension =
          path.extname(entry.name)
            .toLowerCase()

        if (!SUPPORTED_EXTENSIONS.has(extension)) {
          continue
        }

        const relativePath =
          path.relative(AUDIO_ROOT, absolutePath)
            .replace(/\\/g, '/')

        const cue =
          relativePath.slice(0, -extension.length)

        assets.push({
          cue,
          category: cue.split('/')[0] ?? 'other',
          filename: entry.name,
          format: extension.slice(1),
          url: `/audio-assets/${relativePath}`,
        })
      }
    }

  visit(AUDIO_ROOT)

  return assets.sort(
    (left, right) => left.cue.localeCompare(right.cue),
  )
}

export function resolveAudioAsset(
  relativePath: string,
): string | null {
  const normalized =
    relativePath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')

  const extension =
    path.extname(normalized)
      .toLowerCase()

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    return null
  }

  const root =
    path.resolve(AUDIO_ROOT)

  const absolutePath =
    path.resolve(
      root,
      normalized,
    )

  if (
    !absolutePath.startsWith(`${root}${path.sep}`) ||
    !fs.existsSync(absolutePath)
  ) {
    return null
  }

  return absolutePath
}

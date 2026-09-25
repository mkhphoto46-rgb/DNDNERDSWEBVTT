import fs from 'node:fs'
import path from 'node:path'

import {
  MONSTER_PORTRAITS_ROOT,
  ensureBaseDirectories,
} from './paths'

const EXTENSIONS = [
  '.webp',
  '.png',
  '.jpg',
  '.jpeg',
] as const

const MIME_TYPES: Record<(typeof EXTENSIONS)[number], string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

function portraitBasename(monsterId: string): string | null {
  const normalized = monsterId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return /^[a-z0-9][a-z0-9-]{0,100}$/.test(normalized)
    ? normalized
    : null
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()

  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

export interface MonsterPortraitAsset {
  absolutePath: string
  mimeType: string
}

export function getMonsterPortrait(
  monsterId: string,
): MonsterPortraitAsset | null {
  ensureBaseDirectories()

  const basename = portraitBasename(monsterId)
  if (!basename) return null

  for (const extension of EXTENSIONS) {
    const absolutePath = path.join(MONSTER_PORTRAITS_ROOT, `${basename}${extension}`)
    if (fs.existsSync(absolutePath)) {
      return {
        absolutePath,
        mimeType: MIME_TYPES[extension],
      }
    }
  }

  return null
}

/**
 * Every compendium monster receives a stable local portrait URL.
 * If no hand-authored portrait exists, the server returns a generated SVG token.
 */
export function monsterPortraitUrl(monsterId: string): string {
  return `/api/compendium/monsters/${encodeURIComponent(monsterId)}/portrait`
}

export function generatedMonsterPortraitSvg(
  name: string,
  creatureType: string,
): string {
  const safeName = escapeXml(name || 'Monster')
  const safeType = escapeXml(creatureType || 'Creature')
  const safeInitials = escapeXml(initials(name || 'Monster'))

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="${safeName}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="68%">
      <stop offset="0%" stop-color="#5b321a"/>
      <stop offset="70%" stop-color="#201008"/>
      <stop offset="100%" stop-color="#0c0604"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" rx="128" fill="#0c0604"/>
  <circle cx="128" cy="128" r="118" fill="url(#bg)" stroke="#c89349" stroke-width="8"/>
  <circle cx="128" cy="128" r="101" fill="none" stroke="#6f3c1d" stroke-width="3"/>
  <text x="128" y="136" text-anchor="middle" fill="#f0d28e" font-family="Georgia, serif" font-size="78" font-weight="700">${safeInitials}</text>
  <text x="128" y="190" text-anchor="middle" fill="#c8a36c" font-family="Georgia, serif" font-size="18">${safeType}</text>
</svg>`
}

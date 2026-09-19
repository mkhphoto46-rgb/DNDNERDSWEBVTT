import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  PROJECT_ROOT,
} from './paths'

const MUSIC_ROOT =
  path.join(
    PROJECT_ROOT,
    'assets-source',
    'music',
  )

const DEFAULT_COLLECTIONS = [
  'ambient',
  'battle',
  'boss',
  'city',
  'dungeon',
  'forest',
  'mystery',
  'tavern',
  'travel',
] as const

const MUSIC_MIME_TYPES:
  Record<string, string> = {
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.wav': 'audio/wav',
  }

export interface MusicTrack {
  id: string
  title: string
  collection: string
  relativePath: string
  format: string
  byteSize: number
  url: string
}

function displayTitle(filename: string): string {
  return path
    .parse(filename)
    .name
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function ensureMusicDirectories(): void {
  for (const collection of DEFAULT_COLLECTIONS) {
    fs.mkdirSync(
      path.join(MUSIC_ROOT, collection),
      { recursive: true },
    )
  }
}

export function listMusicLibrary(): MusicTrack[] {
  ensureMusicDirectories()

  const tracks: MusicTrack[] = []

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

        if (!MUSIC_MIME_TYPES[extension]) {
          continue
        }

        const relativePath =
          path.relative(MUSIC_ROOT, absolutePath)
            .replace(/\\/g, '/')

        const collection =
          relativePath.includes('/')
            ? relativePath.split('/')[0]
            : 'uncategorized'

        tracks.push({
          id:
            `music_${crypto
              .createHash('sha1')
              .update(relativePath.toLowerCase())
              .digest('hex')
              .slice(0, 16)}`,
          title: displayTitle(entry.name),
          collection,
          relativePath,
          format: extension.slice(1),
          byteSize: fs.statSync(absolutePath).size,
          url: `/music-assets/${relativePath
            .split('/')
            .map(encodeURIComponent)
            .join('/')}`,
        })
      }
    }

  visit(MUSIC_ROOT)

  return tracks.sort(
    (left, right) =>
      left.collection.localeCompare(right.collection) ||
      left.title.localeCompare(right.title),
  )
}

export function resolveMusicAsset(
  relativePath: string,
): {
  absolutePath: string
  mimeType: string
} | null {
  const normalized =
    relativePath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')

  const extension =
    path.extname(normalized)
      .toLowerCase()

  const mimeType =
    MUSIC_MIME_TYPES[extension]

  if (!mimeType) {
    return null
  }

  const root =
    path.resolve(MUSIC_ROOT)

  const absolutePath =
    path.resolve(root, normalized)

  if (
    !absolutePath.startsWith(`${root}${path.sep}`) ||
    !fs.existsSync(absolutePath)
  ) {
    return null
  }

  return {
    absolutePath,
    mimeType,
  }
}

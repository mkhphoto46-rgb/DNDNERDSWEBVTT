import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const serverDirectory = path.dirname(currentFile)

export const PROJECT_ROOT = path.resolve(
  serverDirectory,
  '..',
)

export const DATA_ROOT = process.env.DND_VTT_DATA_ROOT
  ? path.resolve(process.env.DND_VTT_DATA_ROOT)
  : path.join(
      PROJECT_ROOT,
      'data',
    )

export const CAMPAIGNS_ROOT = path.join(
  DATA_ROOT,
  'campaigns',
)

export const COMPENDIUM_ROOT = path.join(
  DATA_ROOT,
  'compendium',
)

export const MONSTER_COMPENDIUM_DATABASE_PATH = path.join(
  COMPENDIUM_ROOT,
  'monsters.sqlite',
)

export const RULEBOOK_COMPENDIUM_DATABASE_PATH = path.join(
  COMPENDIUM_ROOT,
  'rulebooks.sqlite',
)

export const RULES_KNOWLEDGE_DATABASE_PATH = path.join(
  COMPENDIUM_ROOT,
  'rules_knowledge.sqlite',
)

export const MONSTER_PORTRAITS_ROOT = path.join(
  COMPENDIUM_ROOT,
  'portraits',
)

export const SYSTEM_DATABASE_PATH = path.join(
  DATA_ROOT,
  'system.sqlite',
)

export const SYSTEM_BACKUPS_ROOT = path.join(
  DATA_ROOT,
  'backups',
)

export const DIST_ROOT = path.join(
  PROJECT_ROOT,
  'dist',
)

export function campaignRoot(
  campaignId: string,
): string {
  return path.join(
    CAMPAIGNS_ROOT,
    campaignId,
  )
}

export function campaignDatabasePath(
  campaignId: string,
): string {
  return path.join(
    campaignRoot(campaignId),
    'campaign.sqlite',
  )
}

export function campaignBackupsRoot(
  campaignId: string,
): string {
  return path.join(
    campaignRoot(campaignId),
    'backups',
  )
}

export function ensureBaseDirectories(): void {
  fs.mkdirSync(
    DATA_ROOT,
    {
      recursive: true,
    },
  )

  fs.mkdirSync(
    CAMPAIGNS_ROOT,
    {
      recursive: true,
    },
  )

  fs.mkdirSync(
    SYSTEM_BACKUPS_ROOT,
    {
      recursive: true,
    },
  )

  fs.mkdirSync(
    COMPENDIUM_ROOT,
    {
      recursive: true,
    },
  )

  fs.mkdirSync(
    MONSTER_PORTRAITS_ROOT,
    {
      recursive: true,
    },
  )
}

export function ensureCampaignDirectories(
  campaignId: string,
): void {
  const root =
    campaignRoot(campaignId)

  const folders = [
    root,
    path.join(root, 'maps'),
    path.join(root, 'tokens'),
    path.join(root, 'avatars'),
    path.join(root, 'handouts'),
    path.join(root, 'audio'),
    path.join(root, 'backups'),
    path.join(root, 'cache'),
  ]

  for (const folder of folders) {
    fs.mkdirSync(
      folder,
      {
        recursive: true,
      },
    )
  }
}

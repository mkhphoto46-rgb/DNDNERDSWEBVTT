import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const currentFile = fileURLToPath(import.meta.url)
const serverDirectory = path.dirname(currentFile)

export const PROJECT_ROOT = path.resolve(
  serverDirectory,
  '..',
)

export const DATA_ROOT = path.join(
  PROJECT_ROOT,
  'data',
)

export const CAMPAIGNS_ROOT = path.join(
  DATA_ROOT,
  'campaigns',
)

export const SYSTEM_DATABASE_PATH = path.join(
  DATA_ROOT,
  'system.sqlite',
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
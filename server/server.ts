import fs from 'node:fs'
import { randomInt } from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express'

import multer from 'multer'

import {
  Server,
  type Socket,
} from 'socket.io'

import {
  DIST_ROOT,
} from './paths'

import {
  createCampaign,
  createSnapshot,
  endSession,
  getActiveSession,
  getCampaign,
  getCampaignByJoinCode,
  listCampaigns,
  listSnapshots,
  loadCampaignState,
  registerOrResumePlayer,
  restoreSnapshot,
  saveCampaignState,
  startSession,
  touchCampaign,
} from './store'

import {
  getAsset,
  getAssetAbsolutePath,
  listAssets,
  saveMapAsset,
  saveTokenAsset,
} from './assets'

import {
  DEV_CONNECTION_PAGE,
} from './devPage'

import {
  ensureAudioDirectories,
  listAudioLibrary,
  listAudioCueStatus,
  resolveAudioAsset,
} from './audio'

import {
  ensureMusicDirectories,
  listMusicLibrary,
  resolveMusicAsset,
} from './music'

const PORT =
  Number(
    process.env.PORT ?? 3000,
  )

const HOST =
  '0.0.0.0'

ensureAudioDirectories()
ensureMusicDirectories()

interface PresenceEntry {
  socketId: string
  campaignId: string
  role: 'dm' | 'player'
  name: string
  userId: string
}

const app =
  express()

app.use(
  express.json({
    limit: '2mb',
  }),
)

const httpServer =
  http.createServer(
    app,
  )

const io =
  new Server(
    httpServer,
    {
      maxHttpBufferSize:
        1_000_000,
    },
  )

const mapUpload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      files: 1,

      fileSize:
        100 *
        1024 *
        1024,
    },

    fileFilter: (
      _request,
      file,
      callback,
    ) => {
      const allowed =
        new Set([
          'image/png',
          'image/jpeg',
          'image/webp',
        ])

      if (
        !allowed.has(
          file.mimetype,
        )
      ) {
        callback(
          new Error(
            'Only PNG, JPG and WEBP maps are allowed.',
          ),
        )

        return
      }

      callback(
        null,
        true,
      )
    },
  })

const tokenUpload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      files: 1,
      fileSize:
        15 *
        1024 *
        1024,
    },

    fileFilter: (
      _request,
      file,
      callback,
    ) => {
      const allowed =
        new Set([
          'image/png',
          'image/jpeg',
          'image/webp',
        ])

      callback(
        allowed.has(file.mimetype)
          ? null
          : new Error('Only PNG, JPG and WEBP tokens are allowed.'),
        allowed.has(file.mimetype),
      )
    },
  })

const presenceByCampaign =
  new Map<
    string,
    Map<
      string,
      PresenceEntry
    >
  >()

function isLoopbackAddress(
  address: string | undefined,
): boolean {
  if (!address) {
    return false
  }

  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address ===
      '::ffff:127.0.0.1'
  )
}

type ProxyHeaderValue =
  string |
  string[] |
  undefined

type ProxyHeaderBag =
  Record<
    string,
    ProxyHeaderValue
  >

function hasForwardedClientHeaders(
  headers: ProxyHeaderBag,
): boolean {
  const keys = [
    'cf-connecting-ip',
    'x-forwarded-for',
    'forwarded',
    'x-real-ip',
  ]

  return keys.some(
    (key) => {
      const value =
        headers[key]

      if (
        Array.isArray(value)
      ) {
        return value.some(
          (entry) =>
            entry
              .trim()
              .length > 0,
        )
      }

      return (
        typeof value ===
          'string' &&
        value
          .trim()
          .length > 0
      )
    },
  )
}

function isTrustedLocalHttpRequest(
  request: Request,
): boolean {
  return (
    isLoopbackAddress(
      request.socket
        .remoteAddress,
    ) &&
    !hasForwardedClientHeaders(
      request.headers,
    )
  )
}

function isTrustedLocalSocket(
  socket: Socket,
): boolean {
  return (
    isLoopbackAddress(
      socket.handshake
        .address,
    ) &&
    !hasForwardedClientHeaders(
      socket.handshake
        .headers,
    )
  )
}

function isUsefulLanIPv4(
  address: string,
): boolean {
  if (
    address.startsWith(
      '169.254.',
    )
  ) {
    return false
  }

  return true
}

function getLanIPv4Addresses():
  string[] {
  const interfaces =
    os.networkInterfaces()

  const addresses:
    string[] = []

  for (
    const entries
    of Object.values(
      interfaces,
    )
  ) {
    if (!entries) {
      continue
    }

    for (
      const entry
      of entries
    ) {
      if (
        entry.family === 'IPv4' &&
        !entry.internal &&
        isUsefulLanIPv4(
          entry.address,
        )
      ) {
        addresses.push(
          entry.address,
        )
      }
    }
  }

  return [
    ...new Set(
      addresses,
    ),
  ]
}

function roomName(
  campaignId: string,
): string {
  return (
    'campaign:' +
    campaignId
  )
}

const PLAYER_COLOR_PALETTE = [
  '#D85A4A',
  '#4A8BD8',
  '#55A96A',
  '#C9923E',
  '#8F6DD8',
  '#D866A2',
  '#4AAFB0',
  '#D27A3A',
]

function defaultPlayerColor(
  playerId: string,
): string {
  let hash = 0

  for (
    let index = 0;
    index < playerId.length;
    index += 1
  ) {
    hash =
      (
        (
          hash << 5
        ) -
        hash +
        playerId.charCodeAt(index)
      ) |
      0
  }

  return PLAYER_COLOR_PALETTE[
    Math.abs(hash) %
    PLAYER_COLOR_PALETTE.length
  ]
}

function safeTokenColor(
  value: unknown,
  fallback: string,
): string {
  return (
    typeof value === 'string' &&
    /^#[0-9a-f]{6}$/i.test(value)
  )
    ? value.toUpperCase()
    : fallback
}

function playerSafeState(
  state: unknown,
): {
  activeMap: unknown
  tokens: Array<{
    id: string
    name: string
    assetId: string
    imageUrl: string
    mapId: string
    gridX: number
    gridY: number
    size: number
    ownerId: string | null
    visible: true
    color: string
    level: number
    speedFeet: number
    movementUsedFeet: number
  }>
  allowPlayerMovement: boolean
} {
  if (
    !state ||
    typeof state !== 'object'
  ) {
    return {
      activeMap: null,
      tokens: [],
      allowPlayerMovement: false,
    }
  }

  const typedState =
    state as {
      activeMap?: unknown
      tokens?: unknown
      playerColors?: unknown
      allowPlayerMovement?: unknown
    }

  const rawTokens =
    Array.isArray(typedState.tokens)
      ? typedState.tokens
      : []

  const safeTokens =
    rawTokens
      .filter(
        (rawToken): rawToken is Record<string, unknown> =>
          Boolean(
            rawToken &&
            typeof rawToken === 'object' &&
            (rawToken as { visible?: unknown }).visible !== false,
          ),
      )
      .map((rawToken) => {
        const ownerId =
          typeof rawToken.ownerId === 'string' && rawToken.ownerId
            ? rawToken.ownerId
            : null

        const playerColors =
          typedState.playerColors &&
          typeof typedState.playerColors === 'object'
            ? typedState.playerColors as Record<string, unknown>
            : {}

        const inheritedColor =
          ownerId
            ? safeTokenColor(
                playerColors[ownerId],
                defaultPlayerColor(ownerId),
              )
            : '#C9954B'

        return {
          id: String(rawToken.id ?? ''),
          name: String(rawToken.name ?? 'Token'),
          assetId: String(rawToken.assetId ?? ''),
          imageUrl: String(rawToken.imageUrl ?? ''),
          mapId: String(rawToken.mapId ?? ''),
          gridX: Math.max(0, Math.round(Number(rawToken.gridX) || 0)),
          gridY: Math.max(0, Math.round(Number(rawToken.gridY) || 0)),
          size: Math.max(0.5, Number(rawToken.size) || 1),
          ownerId,
          visible: true as const,
          color:
            safeTokenColor(
              rawToken.color,
              inheritedColor,
            ),
          level: Math.max(1, Math.min(30, Math.round(Number(rawToken.level) || 1))),
          speedFeet: Math.max(0, Math.round(Number(rawToken.speedFeet) || 30)),
          movementUsedFeet: Math.max(0, Math.round(Number(rawToken.movementUsedFeet) || 0)),
        }
      })
      .filter((token) => token.id && token.mapId && token.imageUrl)

  return {
    activeMap: typedState.activeMap ?? null,
    tokens: safeTokens,
    allowPlayerMovement: typedState.allowPlayerMovement === true,
  }
}

function emitPresence(
  campaignId: string,
): void {
  const room =
    presenceByCampaign.get(
      campaignId,
    )

  const users =
    room
      ? [...room.values()].map(
          (entry) => ({
            id:
              entry.userId,

            name:
              entry.name,

            role:
              entry.role,
          }),
        )
      : []

  io.to(
    roomName(
      campaignId,
    ),
  ).emit(
    'session:presence',
    users,
  )
}

function broadcastState(
  campaignId: string,
): void {
  const state =
    loadCampaignState(
      campaignId,
    )

  const presence =
    presenceByCampaign.get(
      campaignId,
    )

  if (!presence) {
    return
  }

  for (
    const entry
    of presence.values()
  ) {
    const socket =
      io.sockets.sockets.get(
        entry.socketId,
      )

    if (!socket) {
      continue
    }

    if (
      entry.role === 'dm'
    ) {
      socket.emit(
        'campaign:state-changed',
        state,
      )
    } else {
      socket.emit(
        'campaign:state-changed',
        playerSafeState(
          state,
        ),
      )
    }
  }
}

function broadcastSession(
  campaignId: string,
): void {
  const session =
    getActiveSession(
      campaignId,
    )

  io.to(
    roomName(
      campaignId,
    ),
  ).emit(
    'campaign:session-changed',
    session,
  )
}

function removePresence(
  socketId: string,
): string | null {
  for (
    const [
      campaignId,
      room,
    ]
    of presenceByCampaign
  ) {
    if (
      room.delete(
        socketId,
      )
    ) {
      if (
        room.size === 0
      ) {
        presenceByCampaign.delete(
          campaignId,
        )
      }

      emitPresence(
        campaignId,
      )

      return campaignId
    }
  }

  return null
}

function leaveCurrentCampaign(
  socket: Socket,
): void {
  const previousCampaignId =
    removePresence(
      socket.id,
    )

  if (
    previousCampaignId
  ) {
    socket.leave(
      roomName(
        previousCampaignId,
      ),
    )
  }

  delete socket.data.campaignId
  delete socket.data.role
  delete socket.data.userId
}

function requireLocalRequest(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (
    !isTrustedLocalHttpRequest(
      request,
    )
  ) {
    response
      .status(403)
      .json({
        error:
          'This action is available only on the DM host computer.',
      })

    return
  }

  next()
}

function mergeActiveMapIntoState(
  campaignId: string,
  activeMap: unknown,
): unknown {
  const currentState =
    loadCampaignState(
      campaignId,
    )

  const base =
    (
      currentState &&
      typeof currentState ===
        'object'
    )
      ? currentState as
          Record<
            string,
            unknown
          >
      : {}

  const nextState = {
    ...base,

    activeMap,
  }

  saveCampaignState(
    campaignId,
    nextState,
  )

  return nextState
}

app.get(
  '/api/health',
  (_request, response) => {
    response.json({
      ok: true,

      service:
        'dnd-web-vtt',

      timestamp:
        new Date()
          .toISOString(),
    })
  },
)

app.get(
  '/api/host-info',
  (_request, response) => {
    const addresses =
      getLanIPv4Addresses()

    response.json({
      localUrl:
        `http://localhost:${PORT}`,

      lanUrls:
        addresses.map(
          (address) =>
            `http://${address}:${PORT}`,
        ),
    })
  },
)

app.get(
  '/api/access-info',
  (request, response) => {
    response.set(
      'Cache-Control',
      'no-store',
    )

    response.json({
      isLocalHost:
        isTrustedLocalHttpRequest(
          request,
        ),

      remoteViaProxy:
        hasForwardedClientHeaders(
          request.headers,
        ),
    })
  },
)

app.get(
  '/api/campaigns',
  requireLocalRequest,
  (_request, response) => {
    response.json(
      listCampaigns(),
    )
  },
)

app.post(
  '/api/campaigns',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaign =
        createCampaign(
          String(
            request.body?.name ??
              '',
          ),
        )

      response
        .status(201)
        .json(
          campaign,
        )
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not create campaign.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/state',
  requireLocalRequest,
  (request, response) => {
    try {
      response.json(
        loadCampaignState(
          request.params
            .campaignId,
        ),
      )
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Campaign not found.',
        })
    }
  },
)

app.put(
  '/api/campaigns/:campaignId/state',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        request.params
          .campaignId

      saveCampaignState(
        campaignId,
        request.body ?? {},
      )

      broadcastState(
        campaignId,
      )

      response.json({
        ok: true,
      })
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Campaign not found.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/session',
  requireLocalRequest,
  (request, response) => {
    try {
      response.json(
        getActiveSession(
          request.params
            .campaignId,
        ),
      )
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Campaign not found.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/session/start',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        request.params
          .campaignId

      const session =
        startSession(
          campaignId,
        )

      broadcastSession(
        campaignId,
      )

      response
        .status(201)
        .json(
          session,
        )
    } catch (error) {
      response
        .status(409)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not start session.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/session/end',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        request.params
          .campaignId

      const session =
        endSession(
          campaignId,
        )

      broadcastSession(
        campaignId,
      )

      response.json(
        session,
      )
    } catch (error) {
      response
        .status(409)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not end session.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/snapshots',
  requireLocalRequest,
  (request, response) => {
    try {
      response.json(
        listSnapshots(
          request.params
            .campaignId,
        ),
      )
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Campaign not found.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/snapshots',
  requireLocalRequest,
  (request, response) => {
    try {
      const snapshot =
        createSnapshot(
          request.params
            .campaignId,

          String(
            request.body?.name ??
              '',
          ),
        )

      response
        .status(201)
        .json(
          snapshot,
        )
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not create snapshot.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/snapshots/:snapshotId/restore',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        request.params
          .campaignId

      restoreSnapshot(
        campaignId,
        request.params
          .snapshotId,
      )

      broadcastState(
        campaignId,
      )

      response.json({
        ok: true,

        state:
          loadCampaignState(
            campaignId,
          ),
      })
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not restore snapshot.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/maps',
  requireLocalRequest,
  (request, response) => {
    try {
      response.json(
        listAssets(
          request.params
            .campaignId,
          'map',
        ),
      )
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not load maps.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/maps',
  requireLocalRequest,
  mapUpload.single(
    'map',
  ),
  (request, response) => {
    try {
      const campaignId =
        request.params
          .campaignId

      if (!request.file) {
        response
          .status(400)
          .json({
            error:
              'No map file was uploaded.',
          })

        return
      }

      const asset =
        saveMapAsset(
          campaignId,
          request.file
            .originalname,
          request.file
            .mimetype,
          request.file
            .buffer,
        )

      mergeActiveMapIntoState(
        campaignId,
        asset,
      )

      broadcastState(
        campaignId,
      )

      response
        .status(201)
        .json({
          ok: true,

          asset,

          state:
            loadCampaignState(
              campaignId,
            ),
        })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not upload map.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/maps/:assetId/activate',
  requireLocalRequest,
  (request, response) => {
    try {
      const campaignId =
        request.params
          .campaignId

      const asset =
        getAsset(
          campaignId,
          request.params
            .assetId,
        )

      if (
        !asset ||
        asset.assetType !== 'map'
      ) {
        response
          .status(404)
          .json({
            error:
              'Map not found.',
          })

        return
      }

      const state =
        mergeActiveMapIntoState(
          campaignId,
          asset,
        )

      broadcastState(
        campaignId,
      )

      response.json({
        ok: true,

        asset,

        state,
      })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not activate map.',
        })
    }
  },
)

app.get(
  '/api/campaigns/:campaignId/token-assets',
  requireLocalRequest,
  (request, response) => {
    try {
      response.json(
        listAssets(
          request.params.campaignId,
          'token',
        ),
      )
    } catch (error) {
      response
        .status(404)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not load token assets.',
        })
    }
  },
)

app.post(
  '/api/campaigns/:campaignId/token-assets',
  requireLocalRequest,
  tokenUpload.single('token'),
  (request, response) => {
    try {
      if (!request.file) {
        response
          .status(400)
          .json({
            error: 'No token image was uploaded.',
          })

        return
      }

      const asset =
        saveTokenAsset(
          request.params.campaignId,
          request.file.originalname,
          request.file.mimetype,
          request.file.buffer,
        )

      response
        .status(201)
        .json({
          ok: true,
          asset,
        })
    } catch (error) {
      response
        .status(400)
        .json({
          error:
            error instanceof Error
              ? error.message
              : 'Could not upload token image.',
        })
    }
  },
)

app.get(
  '/campaign-assets/:campaignId/:assetId',
  (request, response) => {
    try {
      const campaignId =
        request.params
          .campaignId

      const asset =
        getAsset(
          campaignId,
          request.params
            .assetId,
        )

      if (!asset) {
        response
          .status(404)
          .send(
            'Asset not found.',
          )

        return
      }

      const absolutePath =
        getAssetAbsolutePath(
          campaignId,
          asset,
        )

      if (
        !fs.existsSync(
          absolutePath,
        )
      ) {
        response
          .status(404)
          .send(
            'Asset file is missing.',
          )

        return
      }

      response.setHeader(
        'Cache-Control',
        'public, max-age=31536000, immutable',
      )

      response.setHeader(
        'ETag',
        `"${asset.contentHash}"`,
      )

      response.type(
        asset.mimeType,
      )

      response.sendFile(
        absolutePath,
      )
    } catch {
      response
        .status(404)
        .send(
          'Asset not found.',
        )
    }
  },
)

app.get(
  '/dev/connect',
  (_request, response) => {
    response
      .type('html')
      .send(
        DEV_CONNECTION_PAGE,
      )
  },
)

io.on(
  'connection',
  (socket) => {
    socket.on(
      'session:join',
      (
        rawPayload: unknown,
        acknowledge:
          (
            result: unknown,
          ) => void,
      ) => {
        try {
          const payload =
            (
              rawPayload ?? {}
            ) as {
              role?: string
              campaignId?: string
              joinCode?: string
              name?: string
              playerKey?: string
            }

          const role =
            payload.role === 'dm'
              ? 'dm'
              : payload.role ===
                    'player'
                ? 'player'
                : null

          if (!role) {
            acknowledge({
              ok: false,

              error:
                'Invalid role.',
            })

            return
          }

          const name =
            String(
              payload.name ?? '',
            )
              .trim()
              .slice(
                0,
                40,
              )

          if (!name) {
            acknowledge({
              ok: false,

              error:
                'Name is required.',
            })

            return
          }

          let campaign = null

          let userId =
            'dm'

          let player = null

          let resumed =
            false

          if (
            role === 'dm'
          ) {
            if (
              !isTrustedLocalSocket(
                socket,
              )
            ) {
              acknowledge({
                ok: false,

                error:
                  'DM access is allowed only from the host computer using localhost.',
              })

              return
            }

            campaign =
              getCampaign(
                String(
                  payload.campaignId ??
                    '',
                ),
              )
          } else {
            campaign =
              getCampaignByJoinCode(
                String(
                  payload.joinCode ??
                    '',
                ),
              )

            if (campaign) {
              player =
                registerOrResumePlayer(
                  campaign.id,

                  String(
                    payload.playerKey ??
                      '',
                  ),

                  name,
                )

              userId =
                player.id

              resumed =
                player.createdAt !==
                player.lastSeenAt
            }
          }

          if (!campaign) {
            acknowledge({
              ok: false,

              error:
                'Campaign not found.',
            })

            return
          }

          leaveCurrentCampaign(
            socket,
          )

          const room =
            roomName(
              campaign.id,
            )

          socket.join(
            room,
          )

          let presence =
            presenceByCampaign.get(
              campaign.id,
            )

          if (!presence) {
            presence =
              new Map()

            presenceByCampaign.set(
              campaign.id,
              presence,
            )
          }

          presence.set(
            socket.id,
            {
              socketId:
                socket.id,

              campaignId:
                campaign.id,

              role,

              name,

              userId,
            },
          )

          socket.data.campaignId =
            campaign.id

          socket.data.role =
            role

          socket.data.userId =
            userId

          touchCampaign(
            campaign.id,
          )

          const fullState =
            loadCampaignState(
              campaign.id,
            )

          if (
            role === 'dm'
          ) {
            acknowledge({
              ok: true,

              campaign,

              activeSession:
                getActiveSession(
                  campaign.id,
                ),

              state:
                fullState,

              maps:
                listAssets(
                  campaign.id,
                  'map',
                ),

              snapshots:
                listSnapshots(
                  campaign.id,
                ),
            })
          } else {
            acknowledge({
              ok: true,

              campaign: {
                id:
                  campaign.id,

                name:
                  campaign.name,
              },

              player,

              resumed,

              activeSession:
                getActiveSession(
                  campaign.id,
                ),

              state:
                playerSafeState(
                  fullState,
                ),
            })
          }

          emitPresence(
            campaign.id,
          )
        } catch (error) {
          acknowledge({
            ok: false,

            error:
              error instanceof Error
                ? error.message
                : 'Could not join session.',
          })
        }
      },
    )

    socket.on(
      'dice:roll',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          const campaignId = String(socket.data.campaignId ?? '')
          const role = socket.data.role === 'dm' ? 'dm' : 'player'
          const userId = String(socket.data.userId ?? '')

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before rolling dice.')
          }

          const payload = (rawPayload ?? {}) as {
            sides?: unknown
            count?: unknown
            modifier?: unknown
            mode?: unknown
            visibility?: unknown
          }

          const sides = Math.trunc(Number(payload.sides))
          const count = Math.trunc(Number(payload.count ?? 1))
          const modifier = Math.trunc(Number(payload.modifier ?? 0))
          const mode =
            payload.mode === 'advantage' || payload.mode === 'disadvantage'
              ? payload.mode
              : 'normal'

          if (
            ![4, 6, 8, 10, 12, 20, 100].includes(sides) ||
            count < 1 || count > 20 ||
            modifier < -100 || modifier > 100
          ) {
            throw new Error('Invalid dice formula.')
          }

          const rollSet = () =>
            Array.from({ length: count }, () => randomInt(1, sides + 1))

          const first = rollSet()
          const second = mode === 'normal' ? null : rollSet()
          const firstTotal = first.reduce((sum, value) => sum + value, 0)
          const secondTotal = second?.reduce((sum, value) => sum + value, 0) ?? null
          const diceTotal =
            secondTotal === null
              ? firstTotal
              : mode === 'advantage'
                ? Math.max(firstTotal, secondTotal)
                : Math.min(firstTotal, secondTotal)

          const room = presenceByCampaign.get(campaignId)
          const roller = room?.get(socket.id)
          const record = {
            id: `roll_${Date.now()}_${randomInt(1000, 9999)}`,
            rollerId: userId,
            rollerName: roller?.name ?? (role === 'dm' ? 'Dungeon Master' : 'Player'),
            role,
            sides,
            count,
            modifier,
            mode,
            rolls: second ? [first, second] : [first],
            total: diceTotal + modifier,
            natural: count === 1 && sides === 20 ? diceTotal : null,
            visibility:
              role === 'dm' && payload.visibility === 'public'
                ? 'public'
                : role === 'dm'
                  ? 'dm-private'
                  : 'player-and-dm',
            createdAt: new Date().toISOString(),
          }

          if (record.visibility === 'public') {
            io.to(roomName(campaignId)).emit('dice:result', record)
          } else if (record.visibility === 'dm-private') {
            socket.emit('dice:result', record)
          } else {
            socket.emit('dice:result', record)
            if (room) {
              for (const entry of room.values()) {
                if (entry.role === 'dm' && entry.socketId !== socket.id) {
                  io.sockets.sockets.get(entry.socketId)?.emit('dice:result', record)
                }
              }
            }
          }

          acknowledge?.({ ok: true })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error: error instanceof Error ? error.message : 'Dice roll failed.',
          })
        }
      },
    )

    socket.on(
      'token:move',
      (
        rawPayload: unknown,
        acknowledge?: (result: unknown) => void,
      ) => {
        try {
          const campaignId =
            String(socket.data.campaignId ?? '')

          const role =
            socket.data.role === 'dm'
              ? 'dm'
              : 'player'

          const userId =
            String(socket.data.userId ?? '')

          if (!campaignId || !userId) {
            throw new Error('Join a campaign before moving tokens.')
          }

          const payload =
            (rawPayload ?? {}) as {
              tokenId?: unknown
              gridX?: unknown
              gridY?: unknown
            }

          const tokenId =
            String(payload.tokenId ?? '')

          const gridX =
            Math.max(0, Math.min(10000, Math.round(Number(payload.gridX))))

          const gridY =
            Math.max(0, Math.min(10000, Math.round(Number(payload.gridY))))

          if (
            !tokenId ||
            !Number.isFinite(gridX) ||
            !Number.isFinite(gridY)
          ) {
            throw new Error('Invalid token movement.')
          }

          const state =
            (loadCampaignState(campaignId) ?? {}) as {
              tokens?: Array<{
                id?: string
                ownerId?: string | null
                visible?: boolean
                gridX?: number
                gridY?: number
                speedFeet?: number
                movementUsedFeet?: number
                [key: string]: unknown
              }>
              allowPlayerMovement?: boolean
              [key: string]: unknown
            }

          const tokens =
            Array.isArray(state.tokens)
              ? state.tokens
              : []

          const tokenIndex =
            tokens.findIndex((token) => token.id === tokenId)

          if (tokenIndex < 0) {
            throw new Error('Token not found.')
          }

          const token = tokens[tokenIndex]
          const isPlayerControlledMove = role === 'player'
          const allowed =
            role === 'dm' ||
            (
              state.allowPlayerMovement === true &&
              token.visible !== false &&
              token.ownerId === userId
            )

          if (!allowed) {
            throw new Error('You do not control this visible token.')
          }

          const previousGridX = Math.max(0, Math.round(Number(token.gridX) || 0))
          const previousGridY = Math.max(0, Math.round(Number(token.gridY) || 0))
          const stepDistance = Math.max(
            Math.abs(gridX - previousGridX),
            Math.abs(gridY - previousGridY),
          )
          const distanceFeet = stepDistance * 5
          const speedFeet = Math.max(0, Math.round(Number(token.speedFeet) || 30))
          const movementUsedFeet = Math.max(0, Math.round(Number(token.movementUsedFeet) || 0))

          if (
            isPlayerControlledMove &&
            movementUsedFeet + distanceFeet > speedFeet
          ) {
            const remainingFeet = Math.max(0, speedFeet - movementUsedFeet)
            throw new Error(`Movement limit reached. ${remainingFeet} ft remaining.`)
          }

          tokens[tokenIndex] = {
            ...token,
            gridX,
            gridY,
            speedFeet,
            movementUsedFeet:
              isPlayerControlledMove
                ? movementUsedFeet + distanceFeet
                : movementUsedFeet,
          }

          saveCampaignState(
            campaignId,
            {
              ...state,
              tokens,
            },
          )

          broadcastState(campaignId)
          acknowledge?.({ ok: true })
        } catch (error) {
          acknowledge?.({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : 'Token movement failed.',
          })
        }
      },
    )

    socket.on(
      'disconnect',
      () => {
        removePresence(
          socket.id,
        )
      },
    )
  },
)

app.use(
  (
    error: unknown,
    _request: Request,
    response: Response,
    next: NextFunction,
  ) => {
    if (
      error instanceof
        multer.MulterError
    ) {
      response
        .status(400)
        .json({
          error:
            error.code ===
              'LIMIT_FILE_SIZE'
              ? 'Map is too large. Maximum size is 100 MB.'
              : error.message,
        })

      return
    }

    if (
      error instanceof Error
    ) {
      response
        .status(400)
        .json({
          error:
            error.message,
        })

      return
    }

    next()
  },
)

if (
  fs.existsSync(
    DIST_ROOT,
  )
) {
  app.use(
    express.static(
      DIST_ROOT,
      {
        etag: true,
        maxAge: '1h',
      },
    ),
  )

  app.get(
    /^\/(?!api\/|dev\/|socket\.io\/|campaign-assets\/|audio-assets\/|music-assets\/).*/,
    (_request, response) => {
      response.sendFile(
        path.join(
          DIST_ROOT,
          'index.html',
        ),
      )
    },
  )
}

httpServer.listen(
  PORT,
  HOST,
  () => {
    const lanAddresses =
      getLanIPv4Addresses()

    console.log('')

    console.log(
      '========================================',
    )

    console.log(
      ' D&D WEB VTT LOCAL HOST',
    )

    console.log(
      '========================================',
    )

    console.log('')

    console.log(
      `DM URL: http://localhost:${PORT}`,
    )

    console.log(
      `TEST PAGE: http://localhost:${PORT}/dev/connect`,
    )

    console.log('')

    console.log(
      'DM authentication:',
    )

    console.log(
      '  Localhost only — no host key required.',
    )

    console.log('')

    if (
      lanAddresses.length === 0
    ) {
      console.log(
        'No LAN IPv4 address detected.',
      )
    } else {
      console.log(
        'PLAYER LAN URLS:',
      )

      for (
        const address
        of lanAddresses
      ) {
        console.log(
          `  http://${address}:${PORT}`,
        )
      }
    }

    console.log('')

    console.log(
      'Campaign data:',
    )

    console.log(
      'F:\\DND WEB VTT\\data\\campaigns',
    )

    console.log('')

    console.log(
      'Press CTRL+C to stop the host.',
    )

    console.log(
      '========================================',
    )

    console.log('')
  },
)

app.get(
  '/api/audio/manifest',
  (_request, response) => {
    const cues =
      listAudioCueStatus()

    response.json({
      cues,
      library:
        listAudioLibrary(),
      available:
        cues.filter(
          (cue) => cue.available,
        ).length,
      missing:
        cues.filter(
          (cue) => !cue.available,
        ).length,
    })
  },
)

app.get(
  '/api/music/library',
  (_request, response) => {
    const tracks =
      listMusicLibrary()

    response.json({
      tracks,
      collections:
        [...new Set(
          tracks.map(
            (track) => track.collection,
          ),
        )],
    })
  },
)

app.get(
  '/music-assets/*musicPath',
  (request, response) => {
    const rawPath =
      request.params.musicPath

    const relativePath =
      Array.isArray(rawPath)
        ? rawPath.join('/')
        : String(rawPath ?? '')

    const asset =
      resolveMusicAsset(relativePath)

    if (!asset) {
      response
        .status(404)
        .json({ error: 'Music track not found.' })

      return
    }

    response.type(asset.mimeType)
    response.sendFile(
      asset.absolutePath,
      {
        headers: {
          'Cache-Control': 'public, max-age=3600',
        },
      },
    )
  },
)

app.get(
  '/audio-assets/*audioPath',
  (request, response) => {
    const rawPath =
      request.params.audioPath

    const relativePath =
      Array.isArray(rawPath)
        ? rawPath.join('/')
        : String(rawPath ?? '')

    const absolutePath =
      resolveAudioAsset(
        relativePath,
      )

    if (!absolutePath) {
      response
        .status(404)
        .json({
          error: 'Audio asset not found.',
        })

      return
    }

    response.sendFile(
      absolutePath,
      {
        headers: {
          'Cache-Control':
            'public, max-age=3600',
        },
      },
    )
  },
)

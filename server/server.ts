import fs from 'node:fs'
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
} from './assets'

import {
  DEV_CONNECTION_PAGE,
} from './devPage'

const PORT =
  Number(
    process.env.PORT ?? 3000,
  )

const HOST =
  '0.0.0.0'

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

function playerSafeState(
  state: unknown,
): {
  activeMap: unknown
} {
  if (
    !state ||
    typeof state !== 'object'
  ) {
    return {
      activeMap:
        null,
    }
  }

  const typedState =
    state as {
      activeMap?: unknown
    }

  return {
    activeMap:
      typedState.activeMap ??
      null,
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
    !isLoopbackAddress(
      request.socket
        .remoteAddress,
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
    response.json({
      isLocalHost:
        isLoopbackAddress(
          request.socket
            .remoteAddress,
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
              !isLoopbackAddress(
                socket.handshake
                  .address,
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
    /^\/(?!api\/|dev\/|socket\.io\/|campaign-assets\/).*/,
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
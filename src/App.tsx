import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

import './App.css'

import {
  socket,
} from './lib/socket'

type Role =
  | 'dm'
  | 'player'

type InspectorTab =
  | 'party'
  | 'scene'
  | 'assets'
  | 'session'

type ToolMode =
  | 'select'
  | 'pan'

interface Campaign {
  id: string
  name: string
  joinCode?: string
  createdAt?: string
  updatedAt?: string
  lastOpenedAt?: string | null
}

interface SessionRecord {
  id: string
  number: number
  startedAt: string
  endedAt: string | null
}

interface PlayerRecord {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string
}

interface PresenceUser {
  id: string
  name: string
  role: Role
}

interface MapAsset {
  id: string
  assetType: 'map'
  displayName: string
  relativePath: string
  contentHash: string
  byteSize: number
  mimeType: string
  updatedAt: string
  url: string
}

interface SnapshotRecord {
  id: string
  name: string
  createdAt: string
}

interface CampaignState {
  version?: number
  activeMap?: MapAsset | null
  activeSceneId?: string | null
  combat?: unknown
  devNote?: string
  [key: string]: unknown
}

interface JoinResult {
  ok: boolean
  error?: string
  campaign?: Campaign
  activeSession?: SessionRecord | null
  state?: CampaignState
  maps?: MapAsset[]
  snapshots?: SnapshotRecord[]
  player?: PlayerRecord
  resumed?: boolean
}

interface IconProps {
  name:
    | 'select'
    | 'pan'
    | 'fog'
    | 'measure'
    | 'aoe'
    | 'token'
    | 'map'
    | 'party'
    | 'scene'
    | 'assets'
    | 'session'
    | 'character'
    | 'book'
    | 'bag'
    | 'feature'
    | 'dice'
    | 'plus'
    | 'minus'
    | 'reset'
}

const PLAYER_KEY_STORAGE =
  'dnd_vtt_player_key_v1'

const PLAYER_NAME_STORAGE =
  'dnd_vtt_player_name_v1'

const JOIN_CODE_STORAGE =
  'dnd_vtt_join_code_v1'

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  )
}

function getOrCreatePlayerKey():
  string {
  let key =
    localStorage.getItem(
      PLAYER_KEY_STORAGE,
    )

  if (key) {
    return key
  }

  if (
    window.crypto &&
    window.crypto.randomUUID
  ) {
    key =
      window.crypto.randomUUID()
  } else {
    key =
      `player-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`
  }

  localStorage.setItem(
    PLAYER_KEY_STORAGE,
    key,
  )

  return key
}

async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response =
    await fetch(
      url,
      options,
    )

  let body:
    unknown = null

  try {
    body =
      await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body
        ? String(
            (
              body as {
                error: unknown
              }
            ).error,
          )
        : 'Request failed.'

    throw new Error(
      message,
    )
  }

  return body as T
}

function Icon({
  name,
}: IconProps) {
  const common = {
    viewBox:
      '0 0 24 24',
    fill:
      'none',
    stroke:
      'currentColor',
    strokeWidth:
      1.7,
    strokeLinecap:
      'round' as const,
    strokeLinejoin:
      'round' as const,
    'aria-hidden':
      true,
  }

  switch (name) {
    case 'select':
      return (
        <svg {...common}>
          <path d="M5 3l12 8-6 1.5L8.5 19 5 3z" />
          <path d="M11 12.5l4.5 5" />
        </svg>
      )

    case 'pan':
      return (
        <svg {...common}>
          <path d="M8 11V6.5a1.5 1.5 0 013 0V10" />
          <path d="M11 10V5.5a1.5 1.5 0 013 0V10" />
          <path d="M14 10V7a1.5 1.5 0 013 0v5" />
          <path d="M8 10V8.5a1.5 1.5 0 00-3 0V14c0 4.5 2.5 7 6.5 7H14c4 0 6-2.5 6-6v-3a1.5 1.5 0 00-3 0" />
        </svg>
      )

    case 'fog':
      return (
        <svg {...common}>
          <path d="M2.5 12s3.5-5 9.5-5 9.5 5 9.5 5-3.5 5-9.5 5-9.5-5-9.5-5z" />
          <circle cx="12" cy="12" r="2.2" />
          <path d="M3 20h7M14 20h7M6 4h5M15 4h3" />
        </svg>
      )

    case 'measure':
      return (
        <svg {...common}>
          <path d="M5 18L18 5l3 3L8 21 5 18z" />
          <path d="M15.5 7.5l2 2M12.5 10.5l2 2M9.5 13.5l2 2M6.5 16.5l2 2" />
        </svg>
      )

    case 'aoe':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5" />
        </svg>
      )

    case 'token':
      return (
        <svg {...common}>
          <path d="M12 2l7 4v6c0 4.7-2.7 8-7 10-4.3-2-7-5.3-7-10V6l7-4z" />
          <circle cx="12" cy="9" r="2" />
          <path d="M8.5 16c.8-2.1 2-3.2 3.5-3.2s2.7 1.1 3.5 3.2" />
        </svg>
      )

    case 'map':
      return (
        <svg {...common}>
          <path d="M3 5l5-2 8 3 5-2v15l-5 2-8-3-5 2V5z" />
          <path d="M8 3v15M16 6v15" />
        </svg>
      )

    case 'party':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <circle cx="17" cy="9" r="2.2" />
          <path d="M3 20c.7-4 2.8-6 6-6s5.3 2 6 6" />
          <path d="M15 15c2.9.2 4.8 1.9 5.5 5" />
        </svg>
      )

    case 'scene':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <path d="M6 16l4-4 3 3 2.5-2.5L19 16" />
          <circle cx="15.5" cy="8.5" r="1.3" />
        </svg>
      )

    case 'assets':
      return (
        <svg {...common}>
          <path d="M4 8l8-4 8 4-8 4-8-4z" />
          <path d="M4 8v8l8 4 8-4V8" />
          <path d="M12 12v8" />
        </svg>
      )

    case 'session':
      return (
        <svg {...common}>
          <path d="M7 3h10M7 21h10" />
          <path d="M8 3c0 4 2 5.5 4 7 2-1.5 4-3 4-7" />
          <path d="M8 21c0-4 2-5.5 4-7 2 1.5 4 3 4 7" />
        </svg>
      )

    case 'character':
      return (
        <svg {...common}>
          <circle cx="12" cy="7" r="3" />
          <path d="M6 20c.8-4.4 2.8-6.5 6-6.5s5.2 2.1 6 6.5" />
          <path d="M9 14.5l3 2 3-2" />
        </svg>
      )

    case 'book':
      return (
        <svg {...common}>
          <path d="M3 5.5C7 4 9.5 4.5 12 6v14c-2.5-1.5-5-2-9-.5v-14z" />
          <path d="M21 5.5C17 4 14.5 4.5 12 6v14c2.5-1.5 5-2 9-.5v-14z" />
          <path d="M12 9l1.2 2.2 2.4.3-1.8 1.7.5 2.4-2.3-1.2-2.3 1.2.5-2.4-1.8-1.7 2.4-.3L12 9z" />
        </svg>
      )

    case 'bag':
      return (
        <svg {...common}>
          <path d="M7 7c.5-3 2.2-4 5-4s4.5 1 5 4" />
          <path d="M5 8h14l1 12H4L5 8z" />
          <path d="M9 11h6" />
        </svg>
      )

    case 'feature':
      return (
        <svg {...common}>
          <path d="M12 2l2.2 6.2L21 9l-5.1 4.1L17.5 20 12 16.4 6.5 20l1.6-6.9L3 9l6.8-.8L12 2z" />
        </svg>
      )

    case 'dice':
      return (
        <svg {...common}>
          <path d="M12 2l8 6-3 10-5 4-5-4L4 8l8-6z" />
          <path d="M4 8h16M7 18l5-10 5 10M12 8v14" />
        </svg>
      )

    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )

    case 'minus':
      return (
        <svg {...common}>
          <path d="M5 12h14" />
        </svg>
      )

    case 'reset':
      return (
        <svg {...common}>
          <path d="M4 9V4h5" />
          <path d="M5 5a8 8 0 11-1 9" />
        </svg>
      )
  }
}

interface ToolButtonProps {
  icon: IconProps['name']
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}

function ToolButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      className={[
        'tool-button',
        active
          ? 'is-active'
          : '',
        disabled
          ? 'is-disabled'
          : '',
      ].join(' ')}
      onClick={
        disabled
          ? undefined
          : onClick
      }
      disabled={
        disabled
      }
      title={
        disabled
          ? `${label} — next milestone`
          : label
      }
    >
      <Icon
        name={icon}
      />

      <span className="tool-label">
        {label}
      </span>
    </button>
  )
}

function App() {
  const [
    accessMode,
    setAccessMode,
  ] =
    useState<
      'loading' |
      'host' |
      'player'
    >(
      'loading',
    )

  const [
    role,
    setRole,
  ] =
    useState<Role | null>(
      null,
    )

  const [
    campaigns,
    setCampaigns,
  ] =
    useState<Campaign[]>(
      [],
    )

  const [
    currentCampaign,
    setCurrentCampaign,
  ] =
    useState<Campaign | null>(
      null,
    )

  const [
    gameState,
    setGameState,
  ] =
    useState<CampaignState>(
      {},
    )

  const [
    activeSession,
    setActiveSession,
  ] =
    useState<SessionRecord | null>(
      null,
    )

  const [
    presence,
    setPresence,
  ] =
    useState<PresenceUser[]>(
      [],
    )

  const [
    maps,
    setMaps,
  ] =
    useState<MapAsset[]>(
      [],
    )

  const [
    snapshots,
    setSnapshots,
  ] =
    useState<SnapshotRecord[]>(
      [],
    )

  const [
    inspectorTab,
    setInspectorTab,
  ] =
    useState<InspectorTab>(
      'party',
    )

  const [
    toolMode,
    setToolMode,
  ] =
    useState<ToolMode>(
      'select',
    )

  const [
    zoom,
    setZoom,
  ] =
    useState(
      1,
    )

  const [
    pan,
    setPan,
  ] =
    useState({
      x: 0,
      y: 0,
    })

  const [
    isDragging,
    setIsDragging,
  ] =
    useState(
      false,
    )

  const [
    dragOrigin,
    setDragOrigin,
  ] =
    useState({
      x: 0,
      y: 0,
    })

  const [
    panOrigin,
    setPanOrigin,
  ] =
    useState({
      x: 0,
      y: 0,
    })

  const [
    playerName,
    setPlayerName,
  ] =
    useState(
      () =>
        localStorage.getItem(
          PLAYER_NAME_STORAGE,
        ) ??
        '',
    )

  const [
    joinCode,
    setJoinCode,
  ] =
    useState(
      () =>
        localStorage.getItem(
          JOIN_CODE_STORAGE,
        ) ??
        '',
    )

  const [
    newCampaignName,
    setNewCampaignName,
  ] =
    useState(
      '',
    )

  const [
    statusMessage,
    setStatusMessage,
  ] =
    useState(
      '',
    )

  const [
    diceResult,
    setDiceResult,
  ] =
    useState<number | null>(
      null,
    )

  const mapFileInput =
    useRef<HTMLInputElement>(
      null,
    )

  useEffect(
    () => {
      const initialise =
        async () => {
          try {
            const access =
              await requestJson<{
                isLocalHost:
                  boolean
              }>(
                '/api/access-info',
              )

            if (
              access.isLocalHost
            ) {
              setAccessMode(
                'host',
              )

              const availableCampaigns =
                await requestJson<
                  Campaign[]
                >(
                  '/api/campaigns',
                )

              setCampaigns(
                availableCampaigns,
              )
            } else {
              setAccessMode(
                'player',
              )
            }
          } catch (error) {
            setStatusMessage(
              error instanceof Error
                ? error.message
                : 'Could not reach the local VTT host.',
            )
          }
        }

      initialise()
    },
    [],
  )

  useEffect(
    () => {
      const onPresence =
        (
          users:
            PresenceUser[],
        ) => {
          setPresence(
            users,
          )
        }

      const onStateChanged =
        (
          nextState:
            CampaignState,
        ) => {
          setGameState(
            nextState ?? {},
          )
        }

      const onSessionChanged =
        (
          nextSession:
            SessionRecord |
            null,
        ) => {
          setActiveSession(
            nextSession,
          )
        }

      socket.on(
        'session:presence',
        onPresence,
      )

      socket.on(
        'campaign:state-changed',
        onStateChanged,
      )

      socket.on(
        'campaign:session-changed',
        onSessionChanged,
      )

      return () => {
        socket.off(
          'session:presence',
          onPresence,
        )

        socket.off(
          'campaign:state-changed',
          onStateChanged,
        )

        socket.off(
          'campaign:session-changed',
          onSessionChanged,
        )
      }
    },
    [],
  )

  const joinAsDm =
    (
      campaign:
        Campaign,
    ) => {
      socket.emit(
        'session:join',
        {
          role:
            'dm',

          campaignId:
            campaign.id,

          name:
            'Dungeon Master',
        },
        (
          result:
            JoinResult,
        ) => {
          if (!result.ok) {
            setStatusMessage(
              result.error ??
              'Could not open campaign.',
            )

            return
          }

          setRole(
            'dm',
          )

          setCurrentCampaign(
            result.campaign ??
            campaign,
          )

          setGameState(
            result.state ??
            {},
          )

          setActiveSession(
            result.activeSession ??
            null,
          )

          setMaps(
            result.maps ??
            [],
          )

          setSnapshots(
            result.snapshots ??
            [],
          )

          setZoom(
            1,
          )

          setPan({
            x: 0,
            y: 0,
          })

          setStatusMessage(
            'Campaign loaded from the DM host.',
          )
        },
      )
    }

  const createCampaign =
    async (
      event:
        FormEvent,
    ) => {
      event.preventDefault()

      const name =
        newCampaignName
          .trim()

      if (!name) {
        return
      }

      try {
        const campaign =
          await requestJson<Campaign>(
            '/api/campaigns',
            {
              method:
                'POST',

              headers: {
                'Content-Type':
                  'application/json',
              },

              body:
                JSON.stringify({
                  name,
                }),
            },
          )

        setNewCampaignName(
          '',
        )

        setCampaigns(
          (previous) => [
            campaign,
            ...previous,
          ],
        )

        joinAsDm(
          campaign,
        )
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Could not create campaign.',
        )
      }
    }

  const joinAsPlayer =
    (
      event:
        FormEvent,
    ) => {
      event.preventDefault()

      const name =
        playerName.trim()

      const code =
        joinCode
          .trim()
          .toUpperCase()

      if (
        !name ||
        !code
      ) {
        setStatusMessage(
          'Enter your name and campaign join code.',
        )

        return
      }

      const playerKey =
        getOrCreatePlayerKey()

      localStorage.setItem(
        PLAYER_NAME_STORAGE,
        name,
      )

      localStorage.setItem(
        JOIN_CODE_STORAGE,
        code,
      )

      socket.emit(
        'session:join',
        {
          role:
            'player',

          name,

          joinCode:
            code,

          playerKey,
        },
        (
          result:
            JoinResult,
        ) => {
          if (!result.ok) {
            setStatusMessage(
              result.error ??
              'Could not join campaign.',
            )

            return
          }

          setRole(
            'player',
          )

          setCurrentCampaign(
            result.campaign ??
            null,
          )

          setGameState(
            result.state ??
            {},
          )

          setActiveSession(
            result.activeSession ??
            null,
          )

          setZoom(
            1,
          )

          setPan({
            x: 0,
            y: 0,
          })

          setStatusMessage(
            result.resumed
              ? 'Returning player restored.'
              : 'Welcome to the table.',
          )
        },
      )
    }

  const uploadMap =
    async () => {
      if (
        role !== 'dm' ||
        !currentCampaign
      ) {
        return
      }

      const file =
        mapFileInput
          .current
          ?.files?.[0]

      if (!file) {
        setStatusMessage(
          'Choose a PNG, JPG or WEBP map first.',
        )

        return
      }

      const formData =
        new FormData()

      formData.append(
        'map',
        file,
      )

      try {
        setStatusMessage(
          `Uploading ${file.name}...`,
        )

        const result =
          await requestJson<{
            asset:
              MapAsset

            state:
              CampaignState
          }>(
            `/api/campaigns/${encodeURIComponent(
              currentCampaign.id,
            )}/maps`,
            {
              method:
                'POST',

              body:
                formData,
            },
          )

        setGameState(
          result.state,
        )

        const refreshedMaps =
          await requestJson<
            MapAsset[]
          >(
            `/api/campaigns/${encodeURIComponent(
              currentCampaign.id,
            )}/maps`,
          )

        setMaps(
          refreshedMaps,
        )

        if (
          mapFileInput.current
        ) {
          mapFileInput.current.value =
            ''
        }

        setStatusMessage(
          'Map stored locally and shared with the table.',
        )
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Map upload failed.',
        )
      }
    }

  const activateMap =
    async (
      map:
        MapAsset,
    ) => {
      if (
        role !== 'dm' ||
        !currentCampaign
      ) {
        return
      }

      try {
        const result =
          await requestJson<{
            state:
              CampaignState
          }>(
            `/api/campaigns/${encodeURIComponent(
              currentCampaign.id,
            )}/maps/${encodeURIComponent(
              map.id,
            )}/activate`,
            {
              method:
                'POST',
            },
          )

        setGameState(
          result.state,
        )

        setZoom(
          1,
        )

        setPan({
          x: 0,
          y: 0,
        })
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Could not activate map.',
        )
      }
    }

  const startSession =
    async () => {
      if (
        role !== 'dm' ||
        !currentCampaign
      ) {
        return
      }

      try {
        const session =
          await requestJson<
            SessionRecord
          >(
            `/api/campaigns/${encodeURIComponent(
              currentCampaign.id,
            )}/session/start`,
            {
              method:
                'POST',
            },
          )

        setActiveSession(
          session,
        )

        setStatusMessage(
          `Session ${session.number} started.`,
        )
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Could not start session.',
        )
      }
    }

  const endSession =
    async () => {
      if (
        role !== 'dm' ||
        !currentCampaign
      ) {
        return
      }

      try {
        await requestJson<SessionRecord>(
          `/api/campaigns/${encodeURIComponent(
            currentCampaign.id,
          )}/session/end`,
          {
            method:
              'POST',
          },
        )

        setActiveSession(
          null,
        )

        setStatusMessage(
          'Session ended and snapshotted.',
        )
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Could not end session.',
        )
      }
    }

  const createSnapshot =
    async () => {
      if (
        role !== 'dm' ||
        !currentCampaign
      ) {
        return
      }

      const name =
        window.prompt(
          'Snapshot name',
          'Before Major Encounter',
        )

      if (
        name === null
      ) {
        return
      }

      try {
        const snapshot =
          await requestJson<
            SnapshotRecord
          >(
            `/api/campaigns/${encodeURIComponent(
              currentCampaign.id,
            )}/snapshots`,
            {
              method:
                'POST',

              headers: {
                'Content-Type':
                  'application/json',
              },

              body:
                JSON.stringify({
                  name,
                }),
            },
          )

        setSnapshots(
          (previous) => [
            snapshot,
            ...previous,
          ],
        )

        setStatusMessage(
          'Snapshot created.',
        )
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Could not create snapshot.',
        )
      }
    }

  const rollD20 =
    () => {
      const result =
        Math.floor(
          Math.random() * 20,
        ) + 1

      setDiceResult(
        result,
      )

      setTimeout(
        () => {
          setDiceResult(
            null,
          )
        },
        2400,
      )
    }

  const resetMapView =
    () => {
      setZoom(
        1,
      )

      setPan({
        x: 0,
        y: 0,
      })
    }

  const handleMapWheel =
    (
      event:
        ReactWheelEvent<HTMLDivElement>,
    ) => {
      if (
        !gameState.activeMap
      ) {
        return
      }

      event.preventDefault()

      const delta =
        event.deltaY > 0
          ? -0.1
          : 0.1

      setZoom(
        (previous) =>
          clamp(
            Number(
              (
                previous +
                delta
              ).toFixed(
                2,
              ),
            ),
            0.4,
            3.5,
          ),
      )
    }

  const handlePointerDown =
    (
      event:
        ReactPointerEvent<HTMLDivElement>,
    ) => {
      if (
        toolMode !== 'pan' ||
        !gameState.activeMap
      ) {
        return
      }

      setIsDragging(
        true,
      )

      setDragOrigin({
        x:
          event.clientX,
        y:
          event.clientY,
      })

      setPanOrigin(
        pan,
      )

      event.currentTarget
        .setPointerCapture(
          event.pointerId,
        )
    }

  const handlePointerMove =
    (
      event:
        ReactPointerEvent<HTMLDivElement>,
    ) => {
      if (
        !isDragging ||
        toolMode !== 'pan'
      ) {
        return
      }

      setPan({
        x:
          panOrigin.x +
          event.clientX -
          dragOrigin.x,

        y:
          panOrigin.y +
          event.clientY -
          dragOrigin.y,
      })
    }

  const handlePointerUp =
    () => {
      setIsDragging(
        false,
      )
    }

  if (
    accessMode === 'loading'
  ) {
    return (
      <main className="startup-shell">
        <div className="startup-emblem">
          <Icon name="dice" />
        </div>

        <h1 className="startup-title">
          D&D WEB VTT
        </h1>

        <p className="startup-motto">
          Dice will decide your fate.
        </p>

        <div className="loading-rune">
          Awakening the table…
        </div>
      </main>
    )
  }

  if (!role) {
    return (
      <main className="startup-shell">
        <div className="startup-ornament" />

        <div className="startup-emblem">
          <Icon name="dice" />
        </div>

        <h1 className="startup-title">
          D&D WEB VTT
        </h1>

        <p className="startup-motto">
          Dice will decide your fate.
        </p>

        {accessMode === 'host'
          ? (
            <section className="campaign-gate">
              <div className="gate-heading">
                <span>
                  Dungeon Master
                </span>

                <h2>
                  Choose Your Chronicle
                </h2>

                <p>
                  Continue an existing campaign or begin a new tale.
                </p>
              </div>

              <div className="campaign-grid">
                {campaigns.map(
                  (
                    campaign,
                  ) => (
                    <button
                      key={
                        campaign.id
                      }
                      type="button"
                      className="campaign-card"
                      onClick={
                        () =>
                          joinAsDm(
                            campaign,
                          )
                      }
                    >
                      <span className="campaign-seal">
                        <Icon name="book" />
                      </span>

                      <span className="campaign-card-copy">
                        <strong>
                          {campaign.name}
                        </strong>

                        <small>
                          Join code
                        </small>

                        <span className="campaign-code">
                          {campaign.joinCode}
                        </span>
                      </span>

                      <span className="campaign-enter">
                        Enter →
                      </span>
                    </button>
                  ),
                )}
              </div>

              <form
                className="create-campaign"
                onSubmit={
                  createCampaign
                }
              >
                <input
                  value={
                    newCampaignName
                  }
                  onChange={
                    (
                      event,
                    ) =>
                      setNewCampaignName(
                        event
                          .target
                          .value,
                      )
                  }
                  placeholder="Name a new campaign"
                  maxLength={80}
                />

                <button
                  type="submit"
                  className="brass-button"
                >
                  Begin Chronicle
                </button>
              </form>
            </section>
          )
          : (
            <section className="player-gate">
              <div className="gate-heading">
                <span>
                  Adventurer
                </span>

                <h2>
                  Enter the Table
                </h2>

                <p>
                  Ask your Dungeon Master for the campaign join code.
                </p>
              </div>

              <form
                onSubmit={
                  joinAsPlayer
                }
                className="join-form"
              >
                <label>
                  Your Name

                  <input
                    value={
                      playerName
                    }
                    onChange={
                      (
                        event,
                      ) =>
                        setPlayerName(
                          event
                            .target
                            .value,
                        )
                    }
                    placeholder="Adventurer name"
                    maxLength={40}
                  />
                </label>

                <label>
                  Join Code

                  <input
                    value={
                      joinCode
                    }
                    onChange={
                      (
                        event,
                      ) =>
                        setJoinCode(
                          event
                            .target
                            .value
                            .toUpperCase(),
                        )
                    }
                    placeholder="ABC123"
                    maxLength={12}
                  />
                </label>

                <button
                  type="submit"
                  className="brass-button enter-table-button"
                >
                  Enter the Table
                </button>
              </form>
            </section>
          )}

        {statusMessage
          ? (
            <div className="startup-status">
              {statusMessage}
            </div>
          )
          : null}
      </main>
    )
  }

  const activeMap =
    gameState.activeMap ??
    null

  const isDm =
    role === 'dm'

  return (
    <main
      className={[
        'table-shell',
        isDm
          ? 'dm-shell'
          : 'player-shell',
      ].join(' ')}
    >
      <header className="table-header">
        <div className="brand-lockup">
          <div className="brand-die">
            <Icon name="dice" />
          </div>

          <div>
            <span className="eyebrow">
              D&D WEB VTT
            </span>

            <h1>
              {currentCampaign
                ?.name ??
                'The Adventurer’s Table'}
            </h1>
          </div>
        </div>

        <div className="fate-banner">
          <span>
            Dice will decide your fate.
          </span>
        </div>

        <div className="header-status">
          <span
            className={[
              'session-lamp',
              activeSession
                ? 'is-live'
                : '',
            ].join(' ')}
          />

          <div className="session-copy">
            <small>
              {activeSession
                ? `Session ${activeSession.number}`
                : 'Table Resting'}
            </small>

            <strong>
              {isDm
                ? 'Dungeon Master'
                : playerName}
            </strong>
          </div>

          {isDm &&
          currentCampaign
            ?.joinCode
            ? (
              <div className="join-code-plate">
                <small>
                  Join
                </small>

                <strong>
                  {currentCampaign.joinCode}
                </strong>
              </div>
            )
            : null}
        </div>
      </header>

      <aside className="tool-rail">
        <div className="rail-cap">
          TOOLS
        </div>

        <ToolButton
          icon="select"
          label="Select"
          active={
            toolMode ===
            'select'
          }
          onClick={
            () =>
              setToolMode(
                'select',
              )
          }
        />

        <ToolButton
          icon="pan"
          label="Pan"
          active={
            toolMode ===
            'pan'
          }
          onClick={
            () =>
              setToolMode(
                'pan',
              )
          }
        />

        <div className="rail-divider" />

        <ToolButton
          icon="fog"
          label="Fog"
          disabled
        />

        <ToolButton
          icon="measure"
          label="Measure"
          disabled
        />

        <ToolButton
          icon="aoe"
          label="Area"
          disabled
        />

        <ToolButton
          icon="token"
          label="Token"
          disabled
        />

        <ToolButton
          icon="map"
          label="Map"
          active={
            isDm &&
            inspectorTab ===
              'assets'
          }
          onClick={
            isDm
              ? () =>
                  setInspectorTab(
                    'assets',
                  )
              : undefined
          }
          disabled={
            !isDm
          }
        />
      </aside>

      <section className="battlefield">
        <div className="battlefield-frame">
          <div className="frame-corner corner-tl" />
          <div className="frame-corner corner-tr" />
          <div className="frame-corner corner-bl" />
          <div className="frame-corner corner-br" />

          <div className="scene-ribbon">
            <span>
              {activeMap
                ? activeMap.displayName
                : 'The Empty Table'}
            </span>
          </div>

          <div
            className={[
              'map-stage',
              toolMode ===
                'pan'
                ? 'is-pannable'
                : '',
              isDragging
                ? 'is-dragging'
                : '',
            ].join(' ')}
            onWheel={
              handleMapWheel
            }
            onPointerDown={
              handlePointerDown
            }
            onPointerMove={
              handlePointerMove
            }
            onPointerUp={
              handlePointerUp
            }
            onPointerCancel={
              handlePointerUp
            }
          >
            {activeMap
              ? (
                <img
                  className="battle-map-image"
                  src={
                    activeMap.url
                  }
                  alt={
                    activeMap.displayName
                  }
                  draggable={false}
                  style={{
                    transform:
                      `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  }}
                />
              )
              : (
                <div className="empty-map-state">
                  <div className="empty-map-sigil">
                    <Icon name="map" />
                  </div>

                  <h2>
                    {isDm
                      ? 'Lay a map upon the table'
                      : 'Awaiting the Dungeon Master'}
                  </h2>

                  <p>
                    {isDm
                      ? 'Open the Map chest on the right and choose an image.'
                      : 'The active map will appear here as soon as the DM reveals it.'}
                  </p>
                </div>
              )}

            {diceResult !== null
              ? (
                <div
                  className={[
                    'dice-result',
                    diceResult === 20
                      ? 'critical'
                      : '',
                    diceResult === 1
                      ? 'fumble'
                      : '',
                  ].join(' ')}
                >
                  <small>
                    d20
                  </small>

                  <strong>
                    {diceResult}
                  </strong>
                </div>
              )
              : null}
          </div>

          <div className="map-controls">
            <button
              type="button"
              title="Zoom out"
              onClick={
                () =>
                  setZoom(
                    (previous) =>
                      clamp(
                        previous -
                        0.15,
                        0.4,
                        3.5,
                      ),
                  )
              }
            >
              <Icon name="minus" />
            </button>

            <span>
              {Math.round(
                zoom * 100,
              )}%
            </span>

            <button
              type="button"
              title="Zoom in"
              onClick={
                () =>
                  setZoom(
                    (previous) =>
                      clamp(
                        previous +
                        0.15,
                        0.4,
                        3.5,
                      ),
                  )
              }
            >
              <Icon name="plus" />
            </button>

            <button
              type="button"
              title="Reset view"
              onClick={
                resetMapView
              }
            >
              <Icon name="reset" />
            </button>
          </div>

          <div className="map-status-plate">
            <span>
              {toolMode ===
                'pan'
                ? 'PAN MODE'
                : 'SELECT MODE'}
            </span>

            {activeMap
              ? (
                <small>
                  Cached map • {
                    (
                      activeMap.byteSize /
                      1024 /
                      1024
                    ).toFixed(
                      1,
                    )
                  } MB
                </small>
              )
              : (
                <small>
                  No map active
                </small>
              )}
          </div>
        </div>
      </section>

      {isDm
        ? (
          <aside className="inspector">
            <div className="inspector-tabs">
              {(
                [
                  [
                    'party',
                    'party',
                    'Party',
                  ],
                  [
                    'scene',
                    'scene',
                    'Scene',
                  ],
                  [
                    'assets',
                    'assets',
                    'Maps',
                  ],
                  [
                    'session',
                    'session',
                    'Session',
                  ],
                ] as const
              ).map(
                (
                  [
                    tab,
                    icon,
                    label,
                  ],
                ) => (
                  <button
                    key={tab}
                    type="button"
                    className={
                      inspectorTab ===
                      tab
                        ? 'is-active'
                        : ''
                    }
                    onClick={
                      () =>
                        setInspectorTab(
                          tab,
                        )
                    }
                    title={label}
                  >
                    <Icon
                      name={icon}
                    />

                    <span>
                      {label}
                    </span>
                  </button>
                ),
              )}
            </div>

            <div className="inspector-body">
              {inspectorTab ===
                'party'
                ? (
                  <>
                    <div className="panel-heading">
                      <span>
                        The Party
                      </span>

                      <strong>
                        {
                          presence
                            .filter(
                              (
                                user,
                              ) =>
                                user.role ===
                                'player',
                            )
                            .length
                        } Adventurers
                      </strong>
                    </div>

                    <div className="party-list">
                      {presence
                        .filter(
                          (
                            user,
                          ) =>
                            user.role ===
                            'player',
                        )
                        .map(
                          (
                            user,
                          ) => (
                            <div
                              key={
                                user.id
                              }
                              className="party-member"
                            >
                              <div className="member-avatar">
                                {user.name
                                  .slice(
                                    0,
                                    1,
                                  )
                                  .toUpperCase()}
                              </div>

                              <div>
                                <strong>
                                  {user.name}
                                </strong>

                                <small>
                                  Connected
                                </small>
                              </div>

                              <span className="online-dot" />
                            </div>
                          ),
                        )}

                      {presence.filter(
                        (
                          user,
                        ) =>
                          user.role ===
                          'player',
                      ).length ===
                      0
                        ? (
                          <p className="panel-empty">
                            No adventurers have joined yet.
                          </p>
                        )
                        : null}
                    </div>
                  </>
                )
                : null}

              {inspectorTab ===
                'scene'
                ? (
                  <>
                    <div className="panel-heading">
                      <span>
                        Scene
                      </span>

                      <strong>
                        Current Map
                      </strong>
                    </div>

                    {activeMap
                      ? (
                        <div className="scene-card">
                          <div className="scene-thumbnail">
                            <img
                              src={
                                activeMap.url
                              }
                              alt=""
                            />
                          </div>

                          <strong>
                            {activeMap.displayName}
                          </strong>

                          <small>
                            Hash {
                              activeMap.contentHash.slice(
                                0,
                                10,
                              )
                            }
                          </small>
                        </div>
                      )
                      : (
                        <p className="panel-empty">
                          No map is active.
                        </p>
                      )}

                    <div className="coming-next">
                      Grid calibration, walls and lighting enter here next.
                    </div>
                  </>
                )
                : null}

              {inspectorTab ===
                'assets'
                ? (
                  <>
                    <div className="panel-heading">
                      <span>
                        Map Chest
                      </span>

                      <strong>
                        Campaign Maps
                      </strong>
                    </div>

                    <label className="file-drop">
                      <Icon name="map" />

                      <span>
                        Choose Map
                      </span>

                      <small>
                        PNG • JPG • WEBP
                      </small>

                      <input
                        ref={
                          mapFileInput
                        }
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                      />
                    </label>

                    <button
                      type="button"
                      className="brass-button full-width"
                      onClick={
                        uploadMap
                      }
                    >
                      Upload & Reveal
                    </button>

                    <div className="map-library">
                      {maps.map(
                        (
                          map,
                        ) => (
                          <button
                            type="button"
                            key={
                              map.id
                            }
                            className={[
                              'map-library-item',
                              activeMap
                                ?.id ===
                              map.id
                                ? 'is-active'
                                : '',
                            ].join(' ')}
                            onClick={
                              () =>
                                activateMap(
                                  map,
                                )
                            }
                          >
                            <span className="map-library-thumb">
                              <img
                                src={
                                  map.url
                                }
                                alt=""
                              />
                            </span>

                            <span>
                              <strong>
                                {map.displayName}
                              </strong>

                              <small>
                                {
                                  (
                                    map.byteSize /
                                    1024 /
                                    1024
                                  ).toFixed(
                                    1,
                                  )
                                } MB
                              </small>
                            </span>
                          </button>
                        ),
                      )}

                      {maps.length ===
                      0
                        ? (
                          <p className="panel-empty">
                            Your map chest is empty.
                          </p>
                        )
                        : null}
                    </div>
                  </>
                )
                : null}

              {inspectorTab ===
                'session'
                ? (
                  <>
                    <div className="panel-heading">
                      <span>
                        Chronicle
                      </span>

                      <strong>
                        Session Control
                      </strong>
                    </div>

                    <div className="session-card">
                      <span
                        className={[
                          'session-lamp large',
                          activeSession
                            ? 'is-live'
                            : '',
                        ].join(' ')}
                      />

                      <div>
                        <small>
                          Status
                        </small>

                        <strong>
                          {activeSession
                            ? `Session ${activeSession.number} Active`
                            : 'No Active Session'}
                        </strong>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="brass-button full-width"
                      onClick={
                        activeSession
                          ? endSession
                          : startSession
                      }
                    >
                      {activeSession
                        ? 'End Session'
                        : 'Start Session'}
                    </button>

                    <button
                      type="button"
                      className="wood-button full-width"
                      onClick={
                        createSnapshot
                      }
                    >
                      Create Snapshot
                    </button>

                    <div className="snapshot-mini-list">
                      {snapshots
                        .slice(
                          0,
                          5,
                        )
                        .map(
                          (
                            snapshot,
                          ) => (
                            <div
                              key={
                                snapshot.id
                              }
                              className="snapshot-mini"
                            >
                              <strong>
                                {snapshot.name}
                              </strong>

                              <small>
                                {new Date(
                                  snapshot.createdAt,
                                ).toLocaleString()}
                              </small>
                            </div>
                          ),
                        )}
                    </div>
                  </>
                )
                : null}
            </div>
          </aside>
        )
        : null}

      <nav className="player-dock">
        <button
          type="button"
          className="dock-item is-disabled"
          title="Character sheet — next milestone"
          disabled
        >
          <Icon name="character" />
          <span>
            Character
          </span>
        </button>

        <button
          type="button"
          className="dock-item is-disabled"
          title="Spellbook — next milestone"
          disabled
        >
          <Icon name="book" />
          <span>
            Spellbook
          </span>
        </button>

        <button
          type="button"
          className="dock-item dice-dock"
          onClick={
            rollD20
          }
        >
          <Icon name="dice" />
          <span>
            Roll d20
          </span>
        </button>

        <button
          type="button"
          className="dock-item is-disabled"
          title="Inventory — next milestone"
          disabled
        >
          <Icon name="bag" />
          <span>
            Inventory
          </span>
        </button>

        <button
          type="button"
          className="dock-item is-disabled"
          title="Features — next milestone"
          disabled
        >
          <Icon name="feature" />
          <span>
            Features
          </span>
        </button>
      </nav>

      {statusMessage
        ? (
          <div
            className="table-toast"
            onClick={
              () =>
                setStatusMessage(
                  '',
                )
            }
          >
            {statusMessage}
          </div>
        )
        : null}
    </main>
  )
}

export default App

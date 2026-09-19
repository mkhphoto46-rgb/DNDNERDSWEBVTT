import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react'

import './App.css'

import {
  MapViewport,
  type MapViewportHandle,
} from './components/MapViewport'

import {
  socket,
} from './lib/socket'

import {
  DEFAULT_GRID_SETTINGS,
  type GridSettings,
  type MapAsset,
  type MapSettingsByAssetId,
  normalizeGridSettings,
  type SceneMapAsset,
  type SceneToken,
  type TokenAsset,
} from './types/scene'

type Role = 'dm' | 'player'
type InspectorTab = 'party' | 'grid' | 'maps' | 'tokens' | 'session'
type ToolMode = 'select' | 'pan'

interface Campaign {
  id: string
  name: string
  joinCode?: string
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

interface SnapshotRecord {
  id: string
  name: string
  createdAt: string
}

interface CampaignState {
  version?: number
  activeMap?: SceneMapAsset | null
  mapSettings?: MapSettingsByAssetId
  activeSceneId?: string | null
  tokens?: SceneToken[]
  allowPlayerMovement?: boolean
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

const PLAYER_KEY_STORAGE = 'dnd_vtt_player_key_v1'
const PLAYER_NAME_STORAGE = 'dnd_vtt_player_name_v1'
const JOIN_CODE_STORAGE = 'dnd_vtt_join_code_v1'
const GRID_SAVE_DELAY_MS = 350

function getOrCreatePlayerKey(): string {
  let key = localStorage.getItem(PLAYER_KEY_STORAGE)
  if (key) return key

  key = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `player-${Date.now()}-${Math.random().toString(16).slice(2)}`

  localStorage.setItem(PLAYER_KEY_STORAGE, key)
  return key
}

async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, options)
  let body: unknown = null

  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body
        ? String((body as { error: unknown }).error)
        : 'Request failed.'

    throw new Error(message)
  }

  return body as T
}

function readGridFromState(state: CampaignState): GridSettings {
  const activeMap = state.activeMap
  if (!activeMap) return { ...DEFAULT_GRID_SETTINGS }

  if (activeMap.grid) {
    return normalizeGridSettings(activeMap.grid)
  }

  return normalizeGridSettings(state.mapSettings?.[activeMap.id])
}

function hydrateActiveMapGrid(state: CampaignState): CampaignState {
  if (!state.activeMap) return state

  return {
    ...state,
    activeMap: {
      ...state.activeMap,
      grid: readGridFromState(state),
    },
  }
}

function rollD20(): number {
  const values = new Uint32Array(1)
  window.crypto.getRandomValues(values)
  return (values[0] % 20) + 1
}

function App() {
  const [accessMode, setAccessMode] = useState<'loading' | 'host' | 'player'>('loading')
  const [role, setRole] = useState<Role | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [currentCampaign, setCurrentCampaign] = useState<Campaign | null>(null)
  const [gameState, setGameState] = useState<CampaignState>({})
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null)
  const [presence, setPresence] = useState<PresenceUser[]>([])
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null)
  const [maps, setMaps] = useState<MapAsset[]>([])
  const [tokenAssets, setTokenAssets] = useState<TokenAsset[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([])
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('grid')
  const [toolMode, setToolMode] = useState<ToolMode>('pan')
  const [cameraZoom, setCameraZoom] = useState(1)
  const [statusMessage, setStatusMessage] = useState('')
  const [diceResult, setDiceResult] = useState<number | null>(null)
  const [newCampaignName, setNewCampaignName] = useState('')
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem(PLAYER_NAME_STORAGE) ?? '',
  )
  const [joinCode, setJoinCode] = useState(
    () => localStorage.getItem(JOIN_CODE_STORAGE) ?? '',
  )
  const [cellSizeDraft, setCellSizeDraft] = useState('')

  const gameStateRef = useRef<CampaignState>({})
  const gridSaveTimerRef = useRef<number | null>(null)
  const mapViewportRef = useRef<MapViewportHandle>(null)
  const mapFileInput = useRef<HTMLInputElement>(null)
  const tokenFileInput = useRef<HTMLInputElement>(null)

  const isDm = role === 'dm'
  const activeMap = gameState.activeMap ?? null
  const grid = readGridFromState(gameState)

  const commitState = (state: CampaignState) => {
    gameStateRef.current = state
    setGameState(state)
  }

  useEffect(() => {
    gameStateRef.current = gameState
  }, [gameState])

  useEffect(() => {
    setCellSizeDraft(String(Math.round(grid.cellSize)))
  }, [activeMap?.id, grid.cellSize])

  useEffect(() => {
    const initialise = async () => {
      try {
        const access = await requestJson<{ isLocalHost: boolean }>('/api/access-info')

        if (access.isLocalHost) {
          setAccessMode('host')
          setCampaigns(await requestJson<Campaign[]>('/api/campaigns'))
        } else {
          setAccessMode('player')
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
  }, [])

  useEffect(() => {
    const onPresence = (users: PresenceUser[]) => setPresence(users)
    const onStateChanged = (state: CampaignState) => {
      commitState(hydrateActiveMapGrid(state ?? {}))
    }
    const onSessionChanged = (session: SessionRecord | null) => {
      setActiveSession(session)
    }

    socket.on('session:presence', onPresence)
    socket.on('campaign:state-changed', onStateChanged)
    socket.on('campaign:session-changed', onSessionChanged)

    return () => {
      socket.off('session:presence', onPresence)
      socket.off('campaign:state-changed', onStateChanged)
      socket.off('campaign:session-changed', onSessionChanged)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (gridSaveTimerRef.current !== null) {
        window.clearTimeout(gridSaveTimerRef.current)
      }
    }
  }, [])

  const saveWholeState = async (
    campaignId: string,
    state: CampaignState,
  ) => {
    await requestJson<{ ok: boolean }>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/state`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      },
    )
  }

  const joinAsDm = (campaign: Campaign) => {
    socket.emit(
      'session:join',
      {
        role: 'dm',
        campaignId: campaign.id,
        name: 'Dungeon Master',
      },
      (result: JoinResult) => {
        if (!result.ok) {
          setStatusMessage(result.error ?? 'Could not open campaign.')
          return
        }

        setRole('dm')
        setCurrentPlayerId(null)
        setCurrentCampaign(result.campaign ?? campaign)
        commitState(hydrateActiveMapGrid(result.state ?? {}))
        setActiveSession(result.activeSession ?? null)
        setMaps(result.maps ?? [])
        requestJson<TokenAsset[]>(
          `/api/campaigns/${encodeURIComponent(campaign.id)}/token-assets`,
        ).then(setTokenAssets).catch(() => setTokenAssets([]))
        setSnapshots(result.snapshots ?? [])
        setToolMode('pan')
        setStatusMessage('Campaign loaded from the DM host.')
      },
    )
  }

  const createCampaign = async (event: FormEvent) => {
    event.preventDefault()
    const name = newCampaignName.trim()
    if (!name) return

    try {
      const campaign = await requestJson<Campaign>('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      setNewCampaignName('')
      setCampaigns((previous) => [campaign, ...previous])
      joinAsDm(campaign)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not create campaign.')
    }
  }

  const joinAsPlayer = (event: FormEvent) => {
    event.preventDefault()

    const name = playerName.trim()
    const code = joinCode.trim().toUpperCase()

    if (!name || !code) {
      setStatusMessage('Enter your name and campaign join code.')
      return
    }

    const playerKey = getOrCreatePlayerKey()
    localStorage.setItem(PLAYER_NAME_STORAGE, name)
    localStorage.setItem(JOIN_CODE_STORAGE, code)

    socket.emit(
      'session:join',
      {
        role: 'player',
        name,
        joinCode: code,
        playerKey,
      },
      (result: JoinResult) => {
        if (!result.ok) {
          setStatusMessage(result.error ?? 'Could not join campaign.')
          return
        }

        setRole('player')
        setCurrentPlayerId(result.player?.id ?? null)
        setCurrentCampaign(result.campaign ?? null)
        commitState(hydrateActiveMapGrid(result.state ?? {}))
        setActiveSession(result.activeSession ?? null)
        setToolMode('pan')
        setStatusMessage(result.resumed ? 'Returning player restored.' : 'Welcome to the table.')
      },
    )
  }

  const persistGrid = (nextGrid: GridSettings) => {
    if (!isDm || !currentCampaign) return

    const current = gameStateRef.current
    const currentMap = current.activeMap
    if (!currentMap) return

    const normalized = normalizeGridSettings(nextGrid)
    const nextState: CampaignState = {
      ...current,
      mapSettings: {
        ...(current.mapSettings ?? {}),
        [currentMap.id]: normalized,
      },
      activeMap: {
        ...currentMap,
        grid: normalized,
      },
    }

    commitState(nextState)

    if (gridSaveTimerRef.current !== null) {
      window.clearTimeout(gridSaveTimerRef.current)
    }

    gridSaveTimerRef.current = window.setTimeout(async () => {
      try {
        await saveWholeState(currentCampaign.id, nextState)
        setStatusMessage('Grid calibration saved.')
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : 'Could not save grid calibration.',
        )
      }
    }, GRID_SAVE_DELAY_MS)
  }

  const updateGrid = (patch: Partial<GridSettings>) => {
    persistGrid({ ...grid, ...patch })
  }

  const commitCellSizeDraft = () => {
    const trimmed = cellSizeDraft.trim()

    if (!trimmed) {
      setCellSizeDraft(String(Math.round(grid.cellSize)))
      return
    }

    const parsed = Number(trimmed)

    if (!Number.isFinite(parsed) || parsed < 10 || parsed > 500) {
      setCellSizeDraft(String(Math.round(grid.cellSize)))
      setStatusMessage('Cell Size must be between 10 and 500 pixels.')
      return
    }

    const rounded = Math.round(parsed)
    setCellSizeDraft(String(rounded))
    updateGrid({ cellSize: rounded })
  }

  const activateMapState = async (
    campaignId: string,
    state: CampaignState,
    asset: MapAsset,
  ) => {
    const gridSettings = normalizeGridSettings(state.mapSettings?.[asset.id])

    const nextState: CampaignState = {
      ...state,
      mapSettings: {
        ...(state.mapSettings ?? {}),
        [asset.id]: gridSettings,
      },
      activeMap: {
        ...asset,
        grid: gridSettings,
      },
    }

    commitState(nextState)
    await saveWholeState(campaignId, nextState)
  }

  const uploadMap = async () => {
    if (!isDm || !currentCampaign) return

    const file = mapFileInput.current?.files?.[0]
    if (!file) {
      setStatusMessage('Choose a PNG, JPG or WEBP map first.')
      return
    }

    const formData = new FormData()
    formData.append('map', file)

    try {
      setStatusMessage(`Uploading ${file.name}...`)

      const result = await requestJson<{ asset: MapAsset; state: CampaignState }>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/maps`,
        { method: 'POST', body: formData },
      )

      await activateMapState(currentCampaign.id, result.state, result.asset)
      setMaps(
        await requestJson<MapAsset[]>(
          `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/maps`,
        ),
      )

      if (mapFileInput.current) mapFileInput.current.value = ''
      setStatusMessage('Map stored locally and revealed to the table.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Map upload failed.')
    }
  }

  const activateMap = async (map: MapAsset) => {
    if (!isDm || !currentCampaign) return

    try {
      const result = await requestJson<{ state: CampaignState; asset: MapAsset }>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/maps/${encodeURIComponent(map.id)}/activate`,
        { method: 'POST' },
      )

      await activateMapState(currentCampaign.id, result.state, result.asset)
      setStatusMessage(`${map.displayName} is now active.`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not activate map.')
    }
  }

  const uploadTokenAsset = async () => {
    if (!isDm || !currentCampaign) return

    const file = tokenFileInput.current?.files?.[0]
    if (!file) {
      setStatusMessage('Choose a PNG, JPG or WEBP token first.')
      return
    }

    const formData = new FormData()
    formData.append('token', file)

    try {
      const result = await requestJson<{ asset: TokenAsset }>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/token-assets`,
        { method: 'POST', body: formData },
      )

      setTokenAssets((previous) => [
        result.asset,
        ...previous.filter((asset) => asset.id !== result.asset.id),
      ])

      if (tokenFileInput.current) tokenFileInput.current.value = ''
      setStatusMessage('Token portrait added to the campaign chest.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Token upload failed.')
    }
  }

  const placeToken = async (asset: TokenAsset) => {
    if (!isDm || !currentCampaign || !activeMap) return

    const existing = gameStateRef.current.tokens ?? []
    const onCurrentMap = existing.filter((token) => token.mapId === activeMap.id)
    const token: SceneToken = {
      id: window.crypto.randomUUID(),
      name: asset.displayName.replace(/\.[^.]+$/, ''),
      assetId: asset.id,
      imageUrl: asset.url,
      mapId: activeMap.id,
      gridX: 2 + (onCurrentMap.length % 6),
      gridY: 2 + Math.floor(onCurrentMap.length / 6),
      size: 1,
      ownerId: null,
      visible: true,
    }

    const nextState: CampaignState = {
      ...gameStateRef.current,
      tokens: [...existing, token],
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
    setStatusMessage(`${token.name} placed on the active map.`)
  }

  const moveToken = (
    tokenId: string,
    gridX: number,
    gridY: number,
  ) => {
    const current = gameStateRef.current
    const tokens = current.tokens ?? []
    const nextState: CampaignState = {
      ...current,
      tokens: tokens.map((token) =>
        token.id === tokenId
          ? { ...token, gridX, gridY }
          : token,
      ),
    }

    commitState(nextState)
    socket.emit(
      'token:move',
      { tokenId, gridX, gridY },
      (result: { ok?: boolean; error?: string }) => {
        if (!result?.ok) {
          setStatusMessage(result?.error ?? 'Token movement was rejected.')
        }
      },
    )
  }

  const updateToken = async (
    tokenId: string,
    patch: Partial<SceneToken>,
  ) => {
    if (!isDm || !currentCampaign) return

    const current = gameStateRef.current
    const nextState: CampaignState = {
      ...current,
      tokens: (current.tokens ?? []).map((token) =>
        token.id === tokenId
          ? { ...token, ...patch }
          : token,
      ),
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
  }

  const setPlayerMovement = async (enabled: boolean) => {
    if (!isDm || !currentCampaign) return

    const nextState: CampaignState = {
      ...gameStateRef.current,
      allowPlayerMovement: enabled,
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
    setStatusMessage(
      enabled
        ? 'Player self-movement enabled.'
        : 'Player self-movement locked.',
    )
  }

  const removeToken = async (tokenId: string) => {
    if (!isDm || !currentCampaign) return

    const current = gameStateRef.current
    const nextState: CampaignState = {
      ...current,
      tokens: (current.tokens ?? []).filter((token) => token.id !== tokenId),
    }

    commitState(nextState)
    await saveWholeState(currentCampaign.id, nextState)
    setStatusMessage('Token removed from the scene.')
  }

  const startSession = async () => {
    if (!isDm || !currentCampaign) return

    try {
      const session = await requestJson<SessionRecord>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/session/start`,
        { method: 'POST' },
      )
      setActiveSession(session)
      setStatusMessage(`Session ${session.number} started.`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not start session.')
    }
  }

  const endSession = async () => {
    if (!isDm || !currentCampaign) return

    try {
      await requestJson<SessionRecord>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/session/end`,
        { method: 'POST' },
      )
      setActiveSession(null)
      setStatusMessage('Session ended and snapshotted.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not end session.')
    }
  }

  const createSnapshot = async () => {
    if (!isDm || !currentCampaign) return

    const name = window.prompt('Snapshot name', 'Before Major Encounter')
    if (name === null) return

    try {
      const snapshot = await requestJson<SnapshotRecord>(
        `/api/campaigns/${encodeURIComponent(currentCampaign.id)}/snapshots`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      )
      setSnapshots((previous) => [snapshot, ...previous])
      setStatusMessage('Snapshot created.')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'Could not create snapshot.')
    }
  }

  const performLocalD20 = () => {
    setDiceResult(rollD20())
    window.setTimeout(() => setDiceResult(null), 2600)
  }

  if (accessMode === 'loading') {
    return (
      <main className="startup-shell">
        <div className="startup-seal">D20</div>
        <h1>D&D WEB VTT</h1>
        <p>Dice will decide your fate.</p>
      </main>
    )
  }

  if (!role) {
    return (
      <main className="startup-shell">
        <div className="startup-seal">D20</div>
        <h1>D&D WEB VTT</h1>
        <p>Dice will decide your fate.</p>

        {accessMode === 'host' ? (
          <section className="gate-card">
            <header>
              <span>Dungeon Master</span>
              <h2>Choose Your Chronicle</h2>
            </header>

            <div className="campaign-grid">
              {campaigns.map((campaign) => (
                <button
                  key={campaign.id}
                  type="button"
                  className="campaign-card"
                  onClick={() => joinAsDm(campaign)}
                >
                  <strong>{campaign.name}</strong>
                  <small>Join Code</small>
                  <b>{campaign.joinCode}</b>
                </button>
              ))}
            </div>

            <form className="create-campaign" onSubmit={createCampaign}>
              <input
                value={newCampaignName}
                onChange={(event) => setNewCampaignName(event.target.value)}
                placeholder="Name a new campaign"
                maxLength={80}
              />
              <button type="submit">Begin Chronicle</button>
            </form>
          </section>
        ) : (
          <section className="gate-card player-gate">
            <header>
              <span>Adventurer</span>
              <h2>Enter the Table</h2>
            </header>

            <form className="join-form" onSubmit={joinAsPlayer}>
              <label>
                Your Name
                <input
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  placeholder="Adventurer name"
                />
              </label>

              <label>
                Join Code
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                  placeholder="ABC123"
                />
              </label>

              <button type="submit">Enter the Table</button>
            </form>
          </section>
        )}

        {statusMessage ? <div className="startup-status">{statusMessage}</div> : null}
      </main>
    )
  }

  return (
    <main className={`table-shell ${isDm ? 'dm-shell' : 'player-shell'}`}>
      <header className="table-header">
        <div className="campaign-heading">
          <span>D&D WEB VTT</span>
          <h1>{currentCampaign?.name ?? 'Adventurer’s Table'}</h1>
        </div>

        <div className="fate-banner">Dice will decide your fate.</div>

        <div className="header-status">
          <i className={activeSession ? 'session-dot is-live' : 'session-dot'} />
          <div>
            <small>{activeSession ? `Session ${activeSession.number}` : 'Table Resting'}</small>
            <strong>{isDm ? 'Dungeon Master' : playerName}</strong>
          </div>
          {isDm && currentCampaign?.joinCode ? (
            <div className="join-code">
              <small>JOIN</small>
              <b>{currentCampaign.joinCode}</b>
            </div>
          ) : null}
        </div>
      </header>

      <aside className="tool-rail">
        <span className="rail-title">TOOLS</span>
        <button
          type="button"
          className={toolMode === 'select' ? 'tool is-active' : 'tool'}
          onClick={() => setToolMode('select')}
        >
          <span className="tool-icon">↖</span>
          <b>Select</b>
        </button>
        <button
          type="button"
          className={toolMode === 'pan' ? 'tool is-active' : 'tool'}
          onClick={() => setToolMode('pan')}
        >
          <span className="tool-icon">✋</span>
          <b>Pan</b>
        </button>
        {isDm ? (
          <>
            <button type="button" className="tool" onClick={() => setInspectorTab('grid')}>
              <span className="tool-icon">▦</span>
              <b>Grid</b>
            </button>
            <button type="button" className="tool" onClick={() => setInspectorTab('maps')}>
              <span className="tool-icon">🗺</span>
              <b>Maps</b>
            </button>
          </>
        ) : null}
      </aside>

      <section className="battlefield">
        <div className="battlefield-frame">
          <div className="scene-title">{activeMap?.displayName ?? 'The Empty Table'}</div>

          <MapViewport
            ref={mapViewportRef}
            activeMap={activeMap}
            grid={grid}
            tokens={(gameState.tokens ?? []).filter(
              (token) => token.mapId === activeMap?.id && token.visible,
            )}
            movableTokenIds={(gameState.tokens ?? [])
              .filter((token) =>
                toolMode === 'select' &&
                (
                  isDm ||
                  (
                    gameState.allowPlayerMovement === true &&
                    token.ownerId === currentPlayerId
                  )
                ),
              )
              .map((token) => token.id)}
            onTokenMove={moveToken}
            panEnabled={toolMode === 'pan'}
            onCameraChange={(camera) => setCameraZoom(camera.zoom)}
          />

          <div className="camera-controls">
            <button type="button" onClick={() => mapViewportRef.current?.zoomOut()}>−</button>
            <strong>{Math.round(cameraZoom * 100)}%</strong>
            <button type="button" onClick={() => mapViewportRef.current?.zoomIn()}>+</button>
            <button type="button" onClick={() => mapViewportRef.current?.fitMap()}>Fit</button>
            <button type="button" onClick={() => mapViewportRef.current?.actualSize()}>100%</button>
          </div>

          <div className="map-hint">
            <b>{toolMode === 'pan' ? 'PAN MODE' : 'SELECT MODE'}</b>
            <span>Wheel = zoom • Drag = pan • Double-click = fit</span>
          </div>

          {diceResult !== null ? (
            <div className="dice-result">
              <small>{isDm ? 'PRIVATE DM ROLL' : 'LOCAL ROLL'}</small>
              <strong>{diceResult}</strong>
              <span>d20</span>
            </div>
          ) : null}
        </div>
      </section>

      {isDm ? (
        <aside className="inspector">
          <nav className="inspector-tabs">
            {(['party', 'grid', 'maps', 'tokens', 'session'] as InspectorTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={inspectorTab === tab ? 'is-active' : ''}
                onClick={() => setInspectorTab(tab)}
              >
                {tab.toUpperCase()}
              </button>
            ))}
          </nav>

          <div className="inspector-body">
            {inspectorTab === 'party' ? (
              <section>
                <div className="panel-heading">
                  <span>THE PARTY</span>
                  <h2>{presence.filter((user) => user.role === 'player').length} Adventurers</h2>
                </div>

                <div className="party-list">
                  {presence
                    .filter((user) => user.role === 'player')
                    .map((user) => (
                      <div className="party-member" key={user.id}>
                        <span>{user.name.slice(0, 1).toUpperCase()}</span>
                        <div>
                          <strong>{user.name}</strong>
                          <small>Connected</small>
                        </div>
                      </div>
                    ))}
                </div>
              </section>
            ) : null}

            {inspectorTab === 'grid' ? (
              <section>
                <div className="panel-heading">
                  <span>SCENE GEOMETRY</span>
                  <h2>Square Grid</h2>
                </div>

                {!activeMap ? (
                  <p className="empty-note">Activate a map before calibrating its grid.</p>
                ) : (
                  <div className="grid-editor">
                    <label className="toggle-row">
                      <span>Show Grid</span>
                      <input
                        type="checkbox"
                        checked={grid.enabled}
                        onChange={(event) => updateGrid({ enabled: event.target.checked })}
                      />
                    </label>

                    <label>
                      Cell Size (px)
                      <input
                        type="text"
                        inputMode="numeric"
                        value={cellSizeDraft}
                        onChange={(event) => {
                          const nextValue = event.target.value

                          if (/^\d{0,3}$/.test(nextValue)) {
                            setCellSizeDraft(nextValue)
                          }
                        }}
                        onBlur={commitCellSizeDraft}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.currentTarget.blur()
                          }

                          if (event.key === 'Escape') {
                            setCellSizeDraft(String(Math.round(grid.cellSize)))
                            event.currentTarget.blur()
                          }
                        }}
                        aria-label="Grid cell size in pixels"
                      />
                    </label>

                    <div className="two-column-inputs">
                      <label>
                        Offset X
                        <input
                          type="number"
                          step="1"
                          value={Math.round(grid.offsetX)}
                          onChange={(event) => updateGrid({ offsetX: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        Offset Y
                        <input
                          type="number"
                          step="1"
                          value={Math.round(grid.offsetY)}
                          onChange={(event) => updateGrid({ offsetY: Number(event.target.value) })}
                        />
                      </label>
                    </div>

                    <label>
                      Grid Opacity — {Math.round(grid.opacity * 100)}%
                      <input
                        type="range"
                        min="0.05"
                        max="1"
                        step="0.05"
                        value={grid.opacity}
                        onChange={(event) => updateGrid({ opacity: Number(event.target.value) })}
                      />
                    </label>

                    <div className="grid-help">
                      <strong>Calibration</strong>
                      <p>Match Cell Size to one square on the map. Then adjust X/Y Offset until both grids overlap.</p>
                      <p>Grid belongs to the map. Camera pan/zoom stays private to each browser.</p>
                    </div>
                  </div>
                )}
              </section>
            ) : null}

            {inspectorTab === 'maps' ? (
              <section>
                <div className="panel-heading">
                  <span>MAP CHEST</span>
                  <h2>Campaign Maps</h2>
                </div>

                <label className="file-drop">
                  <strong>Choose Map</strong>
                  <small>PNG • JPG • WEBP</small>
                  <input
                    ref={mapFileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                  />
                </label>

                <button type="button" className="primary-button" onClick={uploadMap}>
                  Upload & Reveal
                </button>

                <div className="map-list">
                  {maps.map((map) => (
                    <button
                      type="button"
                      key={map.id}
                      className={activeMap?.id === map.id ? 'map-item is-active' : 'map-item'}
                      onClick={() => activateMap(map)}
                    >
                      <img src={map.url} alt="" />
                      <span>
                        <strong>{map.displayName}</strong>
                        <small>{(map.byteSize / 1024 / 1024).toFixed(1)} MB</small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {inspectorTab === 'tokens' ? (
              <section>
                <div className="panel-heading">
                  <span>MINIATURE CHEST</span>
                  <h2>Tokens</h2>
                </div>

                <label className="toggle-row movement-toggle">
                  <span>
                    <strong>Player Self-Movement</strong>
                    <small>Owned tokens only</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={gameState.allowPlayerMovement === true}
                    onChange={(event) => setPlayerMovement(event.target.checked)}
                  />
                </label>

                <label className="file-drop">
                  <strong>Choose Portrait</strong>
                  <small>PNG • JPG • WEBP</small>
                  <input
                    ref={tokenFileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                  />
                </label>

                <button type="button" className="primary-button" onClick={uploadTokenAsset}>
                  Add to Token Chest
                </button>

                <div className="token-asset-list">
                  {tokenAssets.map((asset) => (
                    <button
                      type="button"
                      className="token-asset"
                      key={asset.id}
                      onClick={() => placeToken(asset)}
                      disabled={!activeMap}
                    >
                      <span className="token-asset-ring">
                        <img src={asset.url} alt="" />
                      </span>
                      <span>
                        <strong>{asset.displayName}</strong>
                        <small>{activeMap ? 'Place on map' : 'Activate a map first'}</small>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="placed-token-list">
                  {(gameState.tokens ?? [])
                    .filter((token) => token.mapId === activeMap?.id)
                    .map((token) => (
                      <article className="placed-token" key={token.id}>
                        <img src={token.imageUrl} alt="" />
                        <div>
                          <strong>{token.name}</strong>
                          <small>Grid {token.gridX}, {token.gridY}</small>
                        </div>
                        <select
                          aria-label={`${token.name} size`}
                          value={token.size}
                          onChange={(event) => updateToken(token.id, { size: Number(event.target.value) })}
                        >
                          <option value="0.5">Tiny</option>
                          <option value="1">Small / Medium</option>
                          <option value="2">Large</option>
                          <option value="3">Huge</option>
                          <option value="4">Gargantuan</option>
                        </select>
                        <select
                          aria-label={`${token.name} owner`}
                          value={token.ownerId ?? ''}
                          onChange={(event) => updateToken(token.id, {
                            ownerId: event.target.value || null,
                          })}
                        >
                          <option value="">DM only</option>
                          {presence
                            .filter((user) => user.role === 'player')
                            .map((player) => (
                              <option value={player.id} key={player.id}>{player.name}</option>
                            ))}
                        </select>
                        <button type="button" onClick={() => removeToken(token.id)} aria-label={`Remove ${token.name}`}>
                          ×
                        </button>
                      </article>
                    ))}
                </div>
              </section>
            ) : null}

            {inspectorTab === 'session' ? (
              <section>
                <div className="panel-heading">
                  <span>CHRONICLE</span>
                  <h2>Session Control</h2>
                </div>

                <div className="session-card">
                  <strong>{activeSession ? `Session ${activeSession.number} Active` : 'No Active Session'}</strong>
                </div>

                <button
                  type="button"
                  className="primary-button"
                  onClick={activeSession ? endSession : startSession}
                >
                  {activeSession ? 'End Session' : 'Start Session'}
                </button>

                <button type="button" className="secondary-button" onClick={createSnapshot}>
                  Create Snapshot
                </button>

                <div className="snapshot-list">
                  {snapshots.slice(0, 6).map((snapshot) => (
                    <div key={snapshot.id}>
                      <strong>{snapshot.name}</strong>
                      <small>{new Date(snapshot.createdAt).toLocaleString()}</small>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </aside>
      ) : null}

      <nav className="bottom-dock">
        <button type="button" disabled>Character</button>
        <button type="button" disabled>Spellbook</button>
        <button type="button" className="dice-button" onClick={performLocalD20}>
          {isDm ? 'Private d20' : 'Roll d20'}
        </button>
        <button type="button" disabled>Inventory</button>
        <button type="button" disabled>Features</button>
      </nav>

      {statusMessage ? (
        <button type="button" className="toast" onClick={() => setStatusMessage('')}>
          {statusMessage}
        </button>
      ) : null}
    </main>
  )
}

export default App

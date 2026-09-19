export const DEV_CONNECTION_PAGE = `
<!doctype html>

<html lang="en">
<head>
  <meta charset="utf-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >

  <title>
    D&D VTT Persistence Test
  </title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      padding: 28px;

      background: #0d0a07;
      color: #eadcbc;

      font-family:
        system-ui,
        sans-serif;
    }

    .wrap {
      width: min(
        1100px,
        100%
      );

      margin: 0 auto;
    }

    h1,
    h2,
    h3 {
      margin-top: 0;
    }

    .notice {
      margin-bottom: 18px;
      padding: 12px;

      border:
        1px solid #72552d;

      background: #1a130c;
      color: #d2b57d;
    }

    .host-mode {
      margin-bottom: 18px;
      padding: 12px;

      border:
        1px solid #41613a;

      background: #11190f;
      color: #a7ca98;
    }

    .player-mode {
      margin-bottom: 18px;
      padding: 12px;

      border:
        1px solid #444;

      background: #111;
      color: #bbb;
    }

    .grid {
      display: grid;

      grid-template-columns:
        repeat(
          2,
          minmax(0, 1fr)
        );

      gap: 16px;
    }

    .card {
      padding: 18px;

      border:
        1px solid #3d3021;

      background: #17110c;
    }

    .wide {
      grid-column:
        1 / -1;
    }

    input,
    textarea,
    button {
      width: 100%;

      margin-top: 8px;
      padding: 9px 11px;

      font: inherit;
    }

    input,
    textarea {
      border:
        1px solid #4a3927;

      background: #090706;
      color: white;
    }

    textarea {
      min-height: 110px;
      resize: vertical;
    }

    button {
      min-height: 40px;

      cursor: pointer;

      border:
        1px solid #8b6838;

      background: #b68a49;
      color: #171007;

      font-weight: 800;
    }

    button.secondary {
      background: #2b2117;
      color: #e7d4ae;
    }

    button.danger {
      border-color: #81453c;
      background: #6b3028;
      color: white;
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }

    .campaign {
      margin-top: 10px;
      padding: 12px;

      border:
        1px solid #392b1e;

      background: #0e0b08;
    }

    .campaign button {
      width: auto;
      margin-right: 8px;
    }

    .snapshot {
      margin-top: 8px;
      padding: 10px;

      border:
        1px solid #35291e;

      background: #0c0907;
    }

    .snapshot button {
      width: auto;
    }

    code {
      color: #dfb96e;
    }

    .status {
      margin-top: 10px;
      min-height: 22px;

      color: #a5c48e;
    }

    .error {
      color: #e48d7f;
    }

    .muted {
      color: #9a8e7a;
    }

    .hidden {
      display: none;
    }

    #presence {
      padding-left: 20px;
    }

    .session-active {
      color: #9dcc8b;
    }

    .session-inactive {
      color: #c0a889;
    }

    @media (
      max-width: 760px
    ) {
      body {
        padding: 15px;
      }

      .grid {
        grid-template-columns:
          1fr;
      }

      .wide {
        grid-column:
          auto;
      }
    }
  </style>
</head>

<body>
  <div class="wrap">

    <h1>
      D&D VTT — Persistence Test
    </h1>

    <div class="notice">
      Temporary development page.
      The final fantasy UI will replace this.
    </div>

    <div
      id="accessMode"
    >
      Detecting access mode...
    </div>

    <div class="grid">

      <section
        id="campaignCard"
        class="card"
      >
        <h2>
          Campaigns
        </h2>

        <input
          id="campaignName"
          placeholder="New campaign name"
        >

        <button
          id="createCampaign"
        >
          Create Campaign
        </button>

        <div
          id="campaignList"
        ></div>
      </section>

      <section class="card">
        <h2>
          Host Information
        </h2>

        <div
          id="hostInfo"
        >
          Loading...
        </div>
      </section>

      <section
        id="dmControlCard"
        class="card wide hidden"
      >
        <h2>
          Current DM Campaign
        </h2>

        <div
          id="currentCampaign"
          class="muted"
        >
          No campaign opened.
        </div>

        <hr>

        <h3>
          Session
        </h3>

        <div
          id="sessionStatus"
          class="session-inactive"
        >
          No active session.
        </div>

        <button
          id="startSession"
        >
          Start Session
        </button>

        <button
          id="endSession"
          class="danger"
        >
          End Session
        </button>

        <hr>

        <h3>
          Autosave Test
        </h3>

        <p class="muted">
          Type here. It should survive a server restart.
        </p>

        <textarea
          id="devNote"
          placeholder="Persistent campaign note..."
        ></textarea>

        <div
          id="saveStatus"
          class="status"
        ></div>

        <hr>

        <h3>
          Snapshots
        </h3>

        <input
          id="snapshotName"
          placeholder="Snapshot name"
        >

        <button
          id="createSnapshot"
          class="secondary"
        >
          Create Manual Snapshot
        </button>

        <div
          id="snapshotStatus"
          class="status"
        ></div>

        <div
          id="snapshotList"
        ></div>
      </section>

      <section class="card">
        <h2>
          Player Join
        </h2>

        <input
          id="playerName"
          placeholder="Player name"
        >

        <input
          id="joinCode"
          placeholder="Campaign join code"
        >

        <button
          id="joinPlayer"
        >
          Join as Player
        </button>

        <div
          id="playerStatus"
          class="status"
        ></div>

        <div
          id="playerIdentity"
          class="muted"
        ></div>
      </section>

      <section class="card">
        <h2>
          Live Presence
        </h2>

        <ul
          id="presence"
        >
          <li>
            Not joined yet.
          </li>
        </ul>
      </section>

    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>

  <script>
    const socket = io()

    let isLocalHost = false
    let currentCampaignId = ''
    let currentCampaignState = {}
    let saveTimer = null

    const PLAYER_KEY_STORAGE =
      'dnd_vtt_player_key_v1'

    const PLAYER_NAME_STORAGE =
      'dnd_vtt_player_name_v1'

    const JOIN_CODE_STORAGE =
      'dnd_vtt_join_code_v1'

    function getOrCreatePlayerKey() {
      let key =
        localStorage.getItem(
          PLAYER_KEY_STORAGE
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
          'player-' +
          Date.now() +
          '-' +
          Math.random()
            .toString(16)
            .slice(2)
      }

      localStorage.setItem(
        PLAYER_KEY_STORAGE,
        key
      )

      return key
    }

    function escapeHtml(value) {
      const div =
        document.createElement(
          'div'
        )

      div.textContent =
        String(value)

      return div.innerHTML
    }

    function setStatus(
      elementId,
      message,
      isError
    ) {
      const element =
        document.getElementById(
          elementId
        )

      element.textContent =
        message

      element.className =
        isError
          ? 'status error'
          : 'status'
    }

    async function jsonRequest(
      url,
      options
    ) {
      const response =
        await fetch(
          url,
          options
        )

      let body = null

      try {
        body =
          await response.json()
      } catch {
        body = null
      }

      if (!response.ok) {
        throw new Error(
          body &&
          body.error
            ? body.error
            : 'Request failed.'
        )
      }

      return body
    }

    async function detectAccessMode() {
      const info =
        await jsonRequest(
          '/api/access-info'
        )

      isLocalHost =
        Boolean(
          info.isLocalHost
        )

      const accessMode =
        document.getElementById(
          'accessMode'
        )

      const campaignCard =
        document.getElementById(
          'campaignCard'
        )

      if (isLocalHost) {
        accessMode.className =
          'host-mode'

        accessMode.textContent =
          'HOST MODE — DM computer detected.'

        campaignCard
          .classList
          .remove(
            'hidden'
          )

        await refreshCampaigns()
      } else {
        accessMode.className =
          'player-mode'

        accessMode.textContent =
          'PLAYER MODE — DM controls are disabled.'

        campaignCard
          .classList
          .add(
            'hidden'
          )
      }
    }

    async function loadHostInfo() {
      const info =
        await jsonRequest(
          '/api/host-info'
        )

      const lines = [
        '<strong>DM:</strong>',
        '<br>',
        '<code>',
        escapeHtml(
          info.localUrl
        ),
        '</code>',
        '<br><br>',
        '<strong>Player LAN URLs:</strong>',
        '<br>'
      ]

      if (
        info.lanUrls.length === 0
      ) {
        lines.push(
          'No LAN IPv4 address detected.'
        )
      } else {
        for (
          const url
          of info.lanUrls
        ) {
          lines.push(
            '<code>' +
            escapeHtml(
              url
            ) +
            '</code><br>'
          )
        }
      }

      document
        .getElementById(
          'hostInfo'
        )
        .innerHTML =
        lines.join('')
    }

    async function refreshCampaigns() {
      if (!isLocalHost) {
        return
      }

      const campaigns =
        await jsonRequest(
          '/api/campaigns'
        )

      const list =
        document.getElementById(
          'campaignList'
        )

      list.innerHTML = ''

      if (
        campaigns.length === 0
      ) {
        list.innerHTML =
          '<p class="muted">No campaigns yet.</p>'

        return
      }

      for (
        const campaign
        of campaigns
      ) {
        const wrapper =
          document.createElement(
            'div'
          )

        wrapper.className =
          'campaign'

        wrapper.innerHTML =
          '<strong>' +
          escapeHtml(
            campaign.name
          ) +
          '</strong>' +
          '<br>' +
          '<small>ID: <code>' +
          escapeHtml(
            campaign.id
          ) +
          '</code></small>' +
          '<br>' +
          '<small>Join Code: <code>' +
          escapeHtml(
            campaign.joinCode
          ) +
          '</code></small>' +
          '<br>' +
          '<button type="button">' +
          'Open / Continue as DM' +
          '</button>'

        wrapper
          .querySelector(
            'button'
          )
          .addEventListener(
            'click',
            () => {
              openCampaignAsDm(
                campaign
              )
            }
          )

        list.appendChild(
          wrapper
        )
      }
    }

    async function openCampaignAsDm(
      campaign
    ) {
      socket.emit(
        'session:join',
        {
          role:
            'dm',

          campaignId:
            campaign.id,

          name:
            'Dungeon Master'
        },
        async (result) => {
          if (!result.ok) {
            alert(
              result.error
            )

            return
          }

          currentCampaignId =
            campaign.id

          currentCampaignState =
            result.state || {}

          document
            .getElementById(
              'currentCampaign'
            )
            .innerHTML =
            '<strong>' +
            escapeHtml(
              campaign.name
            ) +
            '</strong>' +
            '<br>Join Code: <code>' +
            escapeHtml(
              campaign.joinCode
            ) +
            '</code>'

          document
            .getElementById(
              'dmControlCard'
            )
            .classList
            .remove(
              'hidden'
            )

          document
            .getElementById(
              'devNote'
            )
            .value =
            currentCampaignState
              .devNote ||
            ''

          document
            .getElementById(
              'joinCode'
            )
            .value =
            campaign.joinCode

          updateSessionDisplay(
            result.activeSession
          )

          await refreshSnapshots()

          setStatus(
            'saveStatus',
            'Campaign loaded from disk.',
            false
          )
        }
      )
    }

    function updateSessionDisplay(
      session
    ) {
      const element =
        document.getElementById(
          'sessionStatus'
        )

      const startButton =
        document.getElementById(
          'startSession'
        )

      const endButton =
        document.getElementById(
          'endSession'
        )

      if (session) {
        element.className =
          'session-active'

        element.textContent =
          'Session ' +
          session.number +
          ' ACTIVE — started ' +
          new Date(
            session.startedAt
          ).toLocaleString()

        startButton.disabled =
          true

        endButton.disabled =
          false
      } else {
        element.className =
          'session-inactive'

        element.textContent =
          'No active session.'

        startButton.disabled =
          false

        endButton.disabled =
          true
      }
    }

    async function saveCurrentState() {
      if (
        !currentCampaignId
      ) {
        return
      }

      currentCampaignState =
        Object.assign(
          {},
          currentCampaignState,
          {
            devNote:
              document
                .getElementById(
                  'devNote'
                )
                .value
          }
        )

      setStatus(
        'saveStatus',
        'Saving...',
        false
      )

      try {
        await jsonRequest(
          '/api/campaigns/' +
          encodeURIComponent(
            currentCampaignId
          ) +
          '/state',
          {
            method:
              'PUT',

            headers: {
              'Content-Type':
                'application/json'
            },

            body:
              JSON.stringify(
                currentCampaignState
              )
          }
        )

        setStatus(
          'saveStatus',
          'Autosaved.',
          false
        )
      } catch (error) {
        setStatus(
          'saveStatus',
          error.message,
          true
        )
      }
    }

    document
      .getElementById(
        'devNote'
      )
      .addEventListener(
        'input',
        () => {
          clearTimeout(
            saveTimer
          )

          setStatus(
            'saveStatus',
            'Waiting to autosave...',
            false
          )

          saveTimer =
            setTimeout(
              saveCurrentState,
              700
            )
        }
      )

    async function refreshSnapshots() {
      if (
        !currentCampaignId
      ) {
        return
      }

      const snapshots =
        await jsonRequest(
          '/api/campaigns/' +
          encodeURIComponent(
            currentCampaignId
          ) +
          '/snapshots'
        )

      const list =
        document.getElementById(
          'snapshotList'
        )

      list.innerHTML = ''

      if (
        snapshots.length === 0
      ) {
        list.innerHTML =
          '<p class="muted">No snapshots yet.</p>'

        return
      }

      for (
        const snapshot
        of snapshots
      ) {
        const wrapper =
          document.createElement(
            'div'
          )

        wrapper.className =
          'snapshot'

        wrapper.innerHTML =
          '<strong>' +
          escapeHtml(
            snapshot.name
          ) +
          '</strong>' +
          '<br>' +
          '<small>' +
          escapeHtml(
            new Date(
              snapshot.createdAt
            ).toLocaleString()
          ) +
          '</small>' +
          '<br>' +
          '<button type="button">' +
          'Restore' +
          '</button>'

        wrapper
          .querySelector(
            'button'
          )
          .addEventListener(
            'click',
            async () => {
              const confirmed =
                window.confirm(
                  'Restore this snapshot? A backup of the current state will be created automatically first.'
                )

              if (!confirmed) {
                return
              }

              try {
                const result =
                  await jsonRequest(
                    '/api/campaigns/' +
                    encodeURIComponent(
                      currentCampaignId
                    ) +
                    '/snapshots/' +
                    encodeURIComponent(
                      snapshot.id
                    ) +
                    '/restore',
                    {
                      method:
                        'POST'
                    }
                  )

                currentCampaignState =
                  result.state ||
                  {}

                document
                  .getElementById(
                    'devNote'
                  )
                  .value =
                  currentCampaignState
                    .devNote ||
                  ''

                setStatus(
                  'snapshotStatus',
                  'Snapshot restored.',
                  false
                )

                await refreshSnapshots()
              } catch (error) {
                setStatus(
                  'snapshotStatus',
                  error.message,
                  true
                )
              }
            }
          )

        list.appendChild(
          wrapper
        )
      }
    }

    document
      .getElementById(
        'createCampaign'
      )
      .addEventListener(
        'click',
        async () => {
          const input =
            document.getElementById(
              'campaignName'
            )

          const name =
            input.value.trim()

          if (!name) {
            alert(
              'Enter a campaign name.'
            )

            return
          }

          try {
            const campaign =
              await jsonRequest(
                '/api/campaigns',
                {
                  method:
                    'POST',

                  headers: {
                    'Content-Type':
                      'application/json'
                  },

                  body:
                    JSON.stringify({
                      name:
                        name
                    })
                }
              )

            input.value = ''

            await refreshCampaigns()

            openCampaignAsDm(
              campaign
            )
          } catch (error) {
            alert(
              error.message
            )
          }
        }
      )

    document
      .getElementById(
        'startSession'
      )
      .addEventListener(
        'click',
        async () => {
          if (
            !currentCampaignId
          ) {
            return
          }

          try {
            const session =
              await jsonRequest(
                '/api/campaigns/' +
                encodeURIComponent(
                  currentCampaignId
                ) +
                '/session/start',
                {
                  method:
                    'POST'
                }
              )

            updateSessionDisplay(
              session
            )

            await refreshSnapshots()
          } catch (error) {
            alert(
              error.message
            )
          }
        }
      )

    document
      .getElementById(
        'endSession'
      )
      .addEventListener(
        'click',
        async () => {
          if (
            !currentCampaignId
          ) {
            return
          }

          try {
            await saveCurrentState()

            await jsonRequest(
              '/api/campaigns/' +
              encodeURIComponent(
                currentCampaignId
              ) +
              '/session/end',
              {
                method:
                  'POST'
              }
            )

            updateSessionDisplay(
              null
            )

            await refreshSnapshots()
          } catch (error) {
            alert(
              error.message
            )
          }
        }
      )

    document
      .getElementById(
        'createSnapshot'
      )
      .addEventListener(
        'click',
        async () => {
          if (
            !currentCampaignId
          ) {
            return
          }

          const input =
            document.getElementById(
              'snapshotName'
            )

          try {
            await saveCurrentState()

            await jsonRequest(
              '/api/campaigns/' +
                encodeURIComponent(
                  currentCampaignId
                ) +
                '/snapshots',
              {
                method:
                  'POST',

                headers: {
                  'Content-Type':
                    'application/json'
                },

                body:
                  JSON.stringify({
                    name:
                      input.value
                  })
              }
            )

            input.value = ''

            setStatus(
              'snapshotStatus',
              'Snapshot created.',
              false
            )

            await refreshSnapshots()
          } catch (error) {
            setStatus(
              'snapshotStatus',
              error.message,
              true
            )
          }
        }
      )

    document
      .getElementById(
        'joinPlayer'
      )
      .addEventListener(
        'click',
        () => {
          const name =
            document
              .getElementById(
                'playerName'
              )
              .value
              .trim()

          const joinCode =
            document
              .getElementById(
                'joinCode'
              )
              .value
              .trim()

          if (!name) {
            setStatus(
              'playerStatus',
              'Enter your player name.',
              true
            )

            return
          }

          if (!joinCode) {
            setStatus(
              'playerStatus',
              'Enter the campaign join code.',
              true
            )

            return
          }

          const playerKey =
            getOrCreatePlayerKey()

          localStorage.setItem(
            PLAYER_NAME_STORAGE,
            name
          )

          localStorage.setItem(
            JOIN_CODE_STORAGE,
            joinCode
          )

          socket.emit(
            'session:join',
            {
              role:
                'player',

              name,

              joinCode,

              playerKey
            },
            (result) => {
              if (!result.ok) {
                setStatus(
                  'playerStatus',
                  result.error,
                  true
                )

                return
              }

              setStatus(
                'playerStatus',
                result.resumed
                  ? 'Returning player resumed successfully.'
                  : 'New player registered successfully.',
                false
              )

              document
                .getElementById(
                  'playerIdentity'
                )
                .textContent =
                'Player ID: ' +
                result.player.id

              updateSessionDisplay(
                result.activeSession
              )
            }
          )
        }
      )

    socket.on(
      'session:presence',
      (users) => {
        const list =
          document.getElementById(
            'presence'
          )

        list.innerHTML = ''

        if (
          users.length === 0
        ) {
          list.innerHTML =
            '<li>No connected users.</li>'

          return
        }

        for (
          const user
          of users
        ) {
          const item =
            document.createElement(
              'li'
            )

          item.textContent =
            user.name +
            ' — ' +
            user.role

          list.appendChild(
            item
          )
        }
      }
    )

    socket.on(
      'campaign:state-changed',
      (state) => {
        if (!isLocalHost) {
          return
        }

        currentCampaignState =
          state || {}

        const note =
          document.getElementById(
            'devNote'
          )

        if (
          document.activeElement !==
          note
        ) {
          note.value =
            currentCampaignState
              .devNote ||
            ''
        }
      }
    )

    socket.on(
      'campaign:session-changed',
      (session) => {
        updateSessionDisplay(
          session
        )
      }
    )

    const storedName =
      localStorage.getItem(
        PLAYER_NAME_STORAGE
      )

    const storedJoinCode =
      localStorage.getItem(
        JOIN_CODE_STORAGE
      )

    if (storedName) {
      document
        .getElementById(
          'playerName'
        )
        .value =
        storedName
    }

    if (storedJoinCode) {
      document
        .getElementById(
          'joinCode'
        )
        .value =
        storedJoinCode
    }

    loadHostInfo()
    detectAccessMode()
  </script>
</body>
</html>
`
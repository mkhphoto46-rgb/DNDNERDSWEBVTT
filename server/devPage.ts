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
    D&D VTT Server Test
  </title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;

      min-height: 100vh;

      padding: 30px;

      background: #0c0a08;

      color: #e6d7b8;

      font-family:
        system-ui,
        sans-serif;
    }

    .wrap {
      width: min(
        900px,
        100%
      );

      margin: 0 auto;
    }

    h1 {
      margin-top: 0;
    }

    .warning {
      margin-bottom: 20px;

      padding: 12px;

      border:
        1px solid #6f542e;

      background: #18120d;

      color: #c6a76e;
    }

    .host-mode {
      margin-bottom: 20px;

      padding: 12px;

      border:
        1px solid #34552f;

      background: #10180e;

      color: #9fc08f;
    }

    .player-mode {
      margin-bottom: 20px;

      padding: 12px;

      border:
        1px solid #444;

      background: #111;

      color: #aaa;
    }

    .grid {
      display: grid;

      grid-template-columns:
        repeat(
          2,
          minmax(0, 1fr)
        );

      gap: 15px;
    }

    .card {
      padding: 18px;

      border:
        1px solid #3a2d20;

      background: #15110d;
    }

    input,
    button {
      width: 100%;

      min-height: 40px;

      margin-top: 8px;

      padding: 8px 10px;
    }

    input {
      color: white;

      border:
        1px solid #423426;

      background: #080706;
    }

    button {
      cursor: pointer;

      border:
        1px solid #8a6737;

      background: #b78b49;

      color: #171007;

      font-weight: 800;
    }

    button:disabled {
      cursor: not-allowed;

      opacity: 0.4;
    }

    .campaign {
      margin-top: 8px;

      padding: 10px;

      border:
        1px solid #32271d;

      background: #0c0a08;
    }

    .campaign button {
      width: auto;

      margin-right: 6px;
    }

    code {
      color: #d9b46f;
    }

    #presence {
      padding-left: 18px;
    }

    .status {
      min-height: 24px;

      margin-top: 10px;

      color: #9db47c;
    }

    .hidden {
      display: none;
    }

    @media (
      max-width: 700px
    ) {
      .grid {
        grid-template-columns:
          1fr;
      }
    }
  </style>
</head>

<body>
  <div class="wrap">

    <h1>
      D&D VTT — Server Foundation Test
    </h1>

    <div class="warning">
      Temporary diagnostic page.
      This is NOT the final VTT UI.
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
          placeholder="Campaign name"
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
        id="dmCard"
        class="card"
      >
        <h2>
          Join as DM
        </h2>

        <p>
          DM access works only from:
        </p>

        <code>
          http://localhost:3000
        </code>

        <input
          id="dmCampaignId"
          placeholder="Campaign ID"
        >

        <input
          id="dmName"
          value="Dungeon Master"
          placeholder="DM name"
        >

        <button
          id="joinDm"
        >
          Join as DM
        </button>

        <div
          id="dmStatus"
          class="status"
        ></div>
      </section>

      <section class="card">
        <h2>
          Join as Player
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
      </section>

      <section
        class="card"
        style="grid-column: 1 / -1;"
      >
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

    const campaignList =
      document.getElementById(
        'campaignList'
      )

    function escapeHtml(value) {
      const div =
        document.createElement(
          'div'
        )

      div.textContent =
        String(value)

      return div.innerHTML
    }

    async function detectAccessMode() {
      const response =
        await fetch(
          '/api/access-info'
        )

      const info =
        await response.json()

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

      const dmCard =
        document.getElementById(
          'dmCard'
        )

      if (
        isLocalHost
      ) {
        accessMode.className =
          'host-mode'

        accessMode.textContent =
          'HOST MODE — This browser is running on the DM computer.'

        campaignCard
          .classList
          .remove(
            'hidden'
          )

        dmCard
          .classList
          .remove(
            'hidden'
          )

        await refreshCampaigns()
      } else {
        accessMode.className =
          'player-mode'

        accessMode.textContent =
          'PLAYER MODE — This browser can join campaigns but cannot use DM controls.'

        campaignCard
          .classList
          .add(
            'hidden'
          )

        dmCard
          .classList
          .add(
            'hidden'
          )
      }
    }

    async function refreshCampaigns() {
      const response =
        await fetch(
          '/api/campaigns'
        )

      if (
        !response.ok
      ) {
        campaignList.innerHTML =
          '<p>Campaign management is available only on the host computer.</p>'

        return
      }

      const campaigns =
        await response.json()

      campaignList.innerHTML = ''

      if (
        campaigns.length === 0
      ) {
        campaignList.innerHTML =
          '<p>No campaigns yet.</p>'

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
          '<small>Join: <code>' +
          escapeHtml(
            campaign.joinCode
          ) +
          '</code></small>' +
          '<br>' +
          '<button type="button">' +
          'Use Campaign' +
          '</button>'

        wrapper
          .querySelector(
            'button'
          )
          .addEventListener(
            'click',
            () => {
              document
                .getElementById(
                  'dmCampaignId'
                )
                .value =
                campaign.id

              document
                .getElementById(
                  'joinCode'
                )
                .value =
                campaign.joinCode
            }
          )

        campaignList.appendChild(
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
          const name =
            document
              .getElementById(
                'campaignName'
              )
              .value
              .trim()

          if (!name) {
            alert(
              'Enter a campaign name.'
            )

            return
          }

          const response =
            await fetch(
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
                    name
                  })
              }
            )

          const result =
            await response.json()

          if (
            !response.ok
          ) {
            alert(
              result.error ||
              'Could not create campaign.'
            )

            return
          }

          document
            .getElementById(
              'dmCampaignId'
            )
            .value =
            result.id

          document
            .getElementById(
              'joinCode'
            )
            .value =
            result.joinCode

          document
            .getElementById(
              'campaignName'
            )
            .value = ''

          await refreshCampaigns()
        }
      )

    document
      .getElementById(
        'joinDm'
      )
      .addEventListener(
        'click',
        () => {
          const campaignId =
            document
              .getElementById(
                'dmCampaignId'
              )
              .value
              .trim()

          const name =
            document
              .getElementById(
                'dmName'
              )
              .value
              .trim()

          socket.emit(
            'session:join',
            {
              role:
                'dm',

              campaignId,

              name
            },
            (result) => {
              document
                .getElementById(
                  'dmStatus'
                )
                .textContent =
                result.ok
                  ? 'DM joined successfully.'
                  : result.error
            }
          )
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

          socket.emit(
            'session:join',
            {
              role:
                'player',

              joinCode,

              name
            },
            (result) => {
              document
                .getElementById(
                  'playerStatus'
                )
                .textContent =
                result.ok
                  ? 'Player joined successfully.'
                  : result.error
            }
          )
        }
      )

    socket.on(
      'session:presence',
      (players) => {
        const list =
          document.getElementById(
            'presence'
          )

        list.innerHTML = ''

        if (
          players.length === 0
        ) {
          list.innerHTML =
            '<li>No connected users.</li>'

          return
        }

        for (
          const player
          of players
        ) {
          const item =
            document.createElement(
              'li'
            )

          item.textContent =
            player.name +
            ' — ' +
            player.role

          list.appendChild(
            item
          )
        }
      }
    )

    async function loadHostInfo() {
      const response =
        await fetch(
          '/api/host-info'
        )

      const info =
        await response.json()

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

    loadHostInfo()
    detectAccessMode()
  </script>
</body>
</html>
`
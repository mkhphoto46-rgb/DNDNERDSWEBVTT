import './App.css'

function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">D20</div>

          <div>
            <div className="brand-name">D&D WEB VTT</div>
            <div className="campaign-name">No Campaign Loaded</div>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="connection-status">
            <span className="connection-dot" />
            Local
          </div>

          <button className="icon-button" type="button">
            DM
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-sidebar">
          <div className="sidebar-title">TOOLS</div>

          <button className="tool-button active" type="button">
            <span className="tool-icon">↖</span>
            Select
          </button>

          <button className="tool-button" type="button">
            <span className="tool-icon">✋</span>
            Pan
          </button>

          <button className="tool-button" type="button">
            <span className="tool-icon">◫</span>
            Fog
          </button>

          <button className="tool-button" type="button">
            <span className="tool-icon">╱</span>
            Measure
          </button>

          <button className="tool-button" type="button">
            <span className="tool-icon">◎</span>
            AoE
          </button>

          <div className="sidebar-divider" />

          <button className="tool-button" type="button">
            <span className="tool-icon">＋</span>
            Token
          </button>

          <button className="tool-button" type="button">
            <span className="tool-icon">▧</span>
            Map
          </button>
        </aside>

        <section className="tabletop">
          <div className="map-toolbar">
            <div className="scene-name">
              <span className="scene-indicator" />
              Untitled Scene
            </div>

            <div className="map-toolbar-actions">
              <button type="button">−</button>
              <span>100%</span>
              <button type="button">＋</button>
            </div>
          </div>

          <div className="map-area">
            <div className="grid-background" />

            <div className="empty-map-state">
              <div className="empty-map-icon">🗺️</div>
              <h1>Your Tabletop</h1>
              <p>
                Upload a battle map or image to start building the scene.
              </p>

              <button className="primary-button" type="button">
                Upload Map
              </button>
            </div>

            <div className="map-status">
              <span>Square Grid</span>
              <span>5 ft</span>
              <span>100%</span>
            </div>
          </div>
        </section>

        <aside className="right-sidebar">
          <section className="panel">
            <div className="panel-header">
              <span>PLAYERS</span>
              <span className="panel-count">0</span>
            </div>

            <div className="empty-panel">
              No players connected
            </div>
          </section>

          <section className="panel combat-panel">
            <div className="panel-header">
              <span>COMBAT</span>
              <span className="round-label">Round —</span>
            </div>

            <div className="empty-panel">
              Initiative is not active
            </div>

            <button className="secondary-button" type="button">
              Start Combat
            </button>
          </section>

          <section className="panel scene-panel">
            <div className="panel-header">
              <span>SCENES</span>

              <button className="small-add-button" type="button">
                +
              </button>
            </div>

            <div className="scene-card active">
              <div className="scene-preview">
                <span>MAP</span>
              </div>

              <div>
                <strong>Untitled Scene</strong>
                <small>Active</small>
              </div>
            </div>
          </section>
        </aside>
      </main>

      <nav className="mobile-nav">
        <button className="mobile-nav-button active" type="button">
          <span>🗺</span>
          Map
        </button>

        <button className="mobile-nav-button" type="button">
          <span>👤</span>
          Character
        </button>

        <button className="mobile-nav-button" type="button">
          <span>✨</span>
          Spells
        </button>

        <button className="mobile-nav-button" type="button">
          <span>⚔</span>
          Combat
        </button>

        <button className="mobile-nav-button" type="button">
          <span>•••</span>
          More
        </button>
      </nav>
    </div>
  )
}

export default App
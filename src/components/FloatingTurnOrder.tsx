import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import { createPortal } from 'react-dom'
import { GripHorizontal, LocateFixed, Minus, Swords } from 'lucide-react'

import './FloatingTurnOrder.css'

interface FloatingTurnOrderProps {
  status: string
  children: ReactNode
}

interface Position {
  x: number
  y: number
}

const STORAGE_KEY = 'ghost-theory.dm.turn-order-position.v1'
const PANEL_WIDTH = 320
const EDGE = 10

function defaultPosition(): Position {
  if (typeof window === 'undefined') {
    return { x: 16, y: 120 }
  }

  return {
    x: Math.max(EDGE, window.innerWidth - 760),
    y: Math.max(EDGE, 118),
  }
}

function clampPosition(
  position: Position,
  element: HTMLElement | null,
): Position {
  if (typeof window === 'undefined') return position

  const width = element?.offsetWidth || PANEL_WIDTH
  const height = element?.offsetHeight || 180
  const maxX = Math.max(EDGE, window.innerWidth - width - EDGE)
  const maxY = Math.max(EDGE, window.innerHeight - Math.min(height, window.innerHeight - EDGE * 2) - EDGE)

  return {
    x: Math.min(maxX, Math.max(EDGE, position.x)),
    y: Math.min(maxY, Math.max(EDGE, position.y)),
  }
}

function readStoredPosition(): Position {
  if (typeof window === 'undefined') return defaultPosition()

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPosition()
    const parsed = JSON.parse(raw) as Partial<Position>
    const x = Number(parsed.x)
    const y = Number(parsed.y)
    return Number.isFinite(x) && Number.isFinite(y)
      ? { x, y }
      : defaultPosition()
  } catch {
    return defaultPosition()
  }
}

export function FloatingTurnOrder({
  status,
  children,
}: FloatingTurnOrderProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startX: number
    startY: number
  } | null>(null)

  const [position, setPosition] = useState<Position>(() => readStoredPosition())
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const keepOnScreen = () => {
      setPosition((current) => clampPosition(current, panelRef.current))
    }

    keepOnScreen()
    window.addEventListener('resize', keepOnScreen)
    return () => window.removeEventListener('resize', keepOnScreen)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position))
    } catch {
      // A blocked localStorage must not break combat controls.
    }
  }, [position])

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return

    const target = event.target as HTMLElement
    if (target.closest('button')) return

    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: position.x,
      startY: position.y,
    }
  }

  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragRef.current
    if (!active || active.pointerId !== event.pointerId) return

    setPosition(
      clampPosition(
        {
          x: active.startX + event.clientX - active.startClientX,
          y: active.startY + event.clientY - active.startClientY,
        },
        panelRef.current,
      ),
    )
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const content = (
    <div
      ref={panelRef}
      className={`floating-turn-order${collapsed ? ' is-collapsed' : ''}`}
      style={{ left: position.x, top: position.y }}
      aria-label="Turn Order"
    >
      <div
        className="floating-turn-order-handle"
        onPointerDown={beginDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="floating-turn-order-grip" aria-hidden="true">
          <GripHorizontal />
        </span>
        <span className="floating-turn-order-title">
          <Swords aria-hidden="true" />
          <strong>Turn Order</strong>
        </span>
        <small>{status}</small>
        <button
          type="button"
          title="Reset Turn Order position"
          aria-label="Reset Turn Order position"
          onClick={() => setPosition(clampPosition(defaultPosition(), panelRef.current))}
        >
          <LocateFixed />
        </button>
        <button
          type="button"
          title={collapsed ? 'Expand Turn Order' : 'Collapse Turn Order'}
          aria-label={collapsed ? 'Expand Turn Order' : 'Collapse Turn Order'}
          onClick={() => setCollapsed((current) => !current)}
        >
          <Minus />
        </button>
      </div>

      {!collapsed ? (
        <div className="floating-turn-order-body">
          {children}
        </div>
      ) : null}
    </div>
  )

  return createPortal(content, document.body)
}

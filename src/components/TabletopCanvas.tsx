import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  Application,
  Container,
  Graphics,
  Sprite,
  Texture,
} from 'pixi.js'

export type TabletopTool = 'select' | 'pan'

export interface TabletopCanvasHandle {
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
}

interface TabletopCanvasProps {
  mapUrl: string | null
  tool: TabletopTool
  gridSize?: number
  onZoomChange?: (zoom: number) => void
  onMapError?: (message: string) => void
}

interface MapDimensions {
  width: number
  height: number
}

export const TabletopCanvas = forwardRef<
  TabletopCanvasHandle,
  TabletopCanvasProps
>(
  (
    {
      mapUrl,
      tool,
      gridSize = 64,
      onZoomChange,
      onMapError,
    },
    ref,
  ) => {
    const hostRef = useRef<HTMLDivElement | null>(null)

    const appRef = useRef<Application | null>(null)
    const worldRef = useRef<Container | null>(null)

    const textureRef = useRef<Texture | null>(null)

    const dimensionsRef = useRef<MapDimensions | null>(null)

    const dragRef = useRef({
      active: false,
      pointerId: -1,
      x: 0,
      y: 0,
    })

    const [ready, setReady] = useState(false)

    const clampScale = (value: number) => {
      return Math.min(5, Math.max(0.08, value))
    }

    const reportZoom = (scale: number) => {
      onZoomChange?.(Math.round(scale * 100))
    }

    const fitMapToView = () => {
      const host = hostRef.current
      const world = worldRef.current
      const dimensions = dimensionsRef.current

      if (!host || !world || !dimensions) {
        return
      }

      const availableWidth = host.clientWidth
      const availableHeight = host.clientHeight

      if (availableWidth <= 0 || availableHeight <= 0) {
        return
      }

      const horizontalScale =
        availableWidth / dimensions.width

      const verticalScale =
        availableHeight / dimensions.height

      const scale = clampScale(
        Math.min(horizontalScale, verticalScale) * 0.9,
      )

      world.scale.set(scale)

      world.x =
        (availableWidth - dimensions.width * scale) / 2

      world.y =
        (availableHeight - dimensions.height * scale) / 2

      reportZoom(scale)
    }

    const zoomAtPoint = (
      requestedScale: number,
      screenX?: number,
      screenY?: number,
    ) => {
      const host = hostRef.current
      const world = worldRef.current

      if (!host || !world || !dimensionsRef.current) {
        return
      }

      const oldScale = world.scale.x
      const newScale = clampScale(requestedScale)

      const pivotX = screenX ?? host.clientWidth / 2
      const pivotY = screenY ?? host.clientHeight / 2

      const worldPointX =
        (pivotX - world.x) / oldScale

      const worldPointY =
        (pivotY - world.y) / oldScale

      world.scale.set(newScale)

      world.x =
        pivotX - worldPointX * newScale

      world.y =
        pivotY - worldPointY * newScale

      reportZoom(newScale)
    }

    useImperativeHandle(ref, () => ({
      zoomIn() {
        const world = worldRef.current

        if (!world) {
          return
        }

        zoomAtPoint(world.scale.x * 1.15)
      },

      zoomOut() {
        const world = worldRef.current

        if (!world) {
          return
        }

        zoomAtPoint(world.scale.x / 1.15)
      },

      resetView() {
        fitMapToView()
      },
    }))

    useEffect(() => {
      const host = hostRef.current

      if (!host) {
        return
      }

      let disposed = false

      const app = new Application()

      const start = async () => {
        await app.init({
          resizeTo: host,
          preference: 'webgl',
          background: '#090806',
          antialias: true,
          autoDensity: true,
          resolution: Math.min(
            window.devicePixelRatio || 1,
            2,
          ),
        })

        if (disposed) {
          app.destroy(
            { removeView: true },
            { children: true },
          )

          return
        }

        app.canvas.className = 'tabletop-canvas'

        host.appendChild(app.canvas)

        const world = new Container()

        app.stage.addChild(world)

        appRef.current = app
        worldRef.current = world

        setReady(true)
      }

      start()

      return () => {
        disposed = true
        setReady(false)

        textureRef.current?.destroy(true)
        textureRef.current = null

        if (appRef.current) {
          appRef.current.destroy(
            { removeView: true },
            { children: true },
          )
        }

        appRef.current = null
        worldRef.current = null
      }
    }, [])

    useEffect(() => {
      if (!ready) {
        return
      }

      const world = worldRef.current

      if (!world) {
        return
      }

      let cancelled = false

      const clearWorld = () => {
        const children = world.removeChildren()

        for (const child of children) {
          child.destroy()
        }

        if (textureRef.current) {
          textureRef.current.destroy(true)
          textureRef.current = null
        }

        dimensionsRef.current = null
      }

      clearWorld()

      if (!mapUrl) {
        return
      }

      const loadMap = async () => {
        try {
          const image = new Image()

          image.src = mapUrl

          await image.decode()

          if (cancelled) {
            return
          }

          const texture = Texture.from(image, true)

          textureRef.current = texture

          const mapSprite = new Sprite(texture)

          mapSprite.x = 0
          mapSprite.y = 0

          world.addChild(mapSprite)

          const width = texture.width
          const height = texture.height

          dimensionsRef.current = {
            width,
            height,
          }

          const grid = new Graphics()

          const safeGridSize = Math.max(16, gridSize)

          for (
            let x = 0;
            x <= width;
            x += safeGridSize
          ) {
            grid.moveTo(x, 0)
            grid.lineTo(x, height)
          }

          for (
            let y = 0;
            y <= height;
            y += safeGridSize
          ) {
            grid.moveTo(0, y)
            grid.lineTo(width, y)
          }

          grid.stroke({
            width: 1,
            color: 0xd7b36a,
            alpha: 0.2,
          })

          world.addChild(grid)

          requestAnimationFrame(() => {
            fitMapToView()
          })
        } catch {
          onMapError?.(
            'The selected image could not be loaded as a map.',
          )
        }
      }

      loadMap()

      return () => {
        cancelled = true
      }
    }, [
      mapUrl,
      ready,
      gridSize,
    ])

    useEffect(() => {
      if (!ready) {
        return
      }

      const app = appRef.current
      const world = worldRef.current

      if (!app || !world) {
        return
      }

      const canvas = app.canvas

      canvas.style.cursor =
        tool === 'pan' ? 'grab' : 'default'

      const pointerDown = (event: PointerEvent) => {
        const canPan =
          tool === 'pan' ||
          event.button === 1

        if (!canPan) {
          return
        }

        dragRef.current.active = true
        dragRef.current.pointerId = event.pointerId
        dragRef.current.x = event.clientX
        dragRef.current.y = event.clientY

        canvas.setPointerCapture(event.pointerId)

        canvas.style.cursor = 'grabbing'

        event.preventDefault()
      }

      const pointerMove = (event: PointerEvent) => {
        const drag = dragRef.current

        if (
          !drag.active ||
          drag.pointerId !== event.pointerId
        ) {
          return
        }

        const deltaX = event.clientX - drag.x
        const deltaY = event.clientY - drag.y

        drag.x = event.clientX
        drag.y = event.clientY

        world.x += deltaX
        world.y += deltaY
      }

      const stopDrag = (event: PointerEvent) => {
        const drag = dragRef.current

        if (
          !drag.active ||
          drag.pointerId !== event.pointerId
        ) {
          return
        }

        drag.active = false
        drag.pointerId = -1

        canvas.style.cursor =
          tool === 'pan' ? 'grab' : 'default'
      }

      const wheel = (event: WheelEvent) => {
        if (!dimensionsRef.current) {
          return
        }

        event.preventDefault()

        const rect =
          canvas.getBoundingClientRect()

        const pointerX =
          event.clientX - rect.left

        const pointerY =
          event.clientY - rect.top

        const factor =
          event.deltaY < 0 ? 1.1 : 0.9

        zoomAtPoint(
          world.scale.x * factor,
          pointerX,
          pointerY,
        )
      }

      canvas.addEventListener(
        'pointerdown',
        pointerDown,
      )

      canvas.addEventListener(
        'pointermove',
        pointerMove,
      )

      canvas.addEventListener(
        'pointerup',
        stopDrag,
      )

      canvas.addEventListener(
        'pointercancel',
        stopDrag,
      )

      canvas.addEventListener(
        'wheel',
        wheel,
        {
          passive: false,
        },
      )

      return () => {
        canvas.removeEventListener(
          'pointerdown',
          pointerDown,
        )

        canvas.removeEventListener(
          'pointermove',
          pointerMove,
        )

        canvas.removeEventListener(
          'pointerup',
          stopDrag,
        )

        canvas.removeEventListener(
          'pointercancel',
          stopDrag,
        )

        canvas.removeEventListener(
          'wheel',
          wheel,
        )
      }
    }, [
      ready,
      tool,
    ])

    return (
      <div
        ref={hostRef}
        className="tabletop-canvas-host"
      />
    )
  },
)

TabletopCanvas.displayName = 'TabletopCanvas'
import {
  ACESFilmicToneMapping,
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DodecahedronGeometry,
  Euler,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  PerspectiveCamera,
  PCFSoftShadowMap,
  PointLight,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TetrahedronGeometry,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  useEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'

import type {
  DiceRollPresentation,
  DiceThemeDefinition,
  DiceVisualResult,
} from '../types/diceVisuals'

import './DiceRollStage.css'

interface DiceRollStageProps {
  roll: DiceRollPresentation | null
  theme: DiceThemeDefinition
  onComplete: (rollId: string) => void
}

interface FallingDie {
  object: Group
  shadow: Mesh<PlaneGeometry, MeshBasicMaterial>
  startX: number
  startZ: number
  landingX: number
  landingZ: number
  startHeight: number
  delay: number
  floor: number
  flightDuration: number
  bounceOneDuration: number
  bounceTwoDuration: number
  bounceOneHeight: number
  bounceTwoHeight: number
  launchQuaternion: Quaternion
  impactQuaternion: Quaternion
  restingQuaternion: Quaternion
  spinAxis: Vector3
  spinTurns: number
  restingYaw: number
  flightProgress: number
  halfHeight: number
  resultMarker: Sprite
}

const modelCache = new Map<string, Promise<Group>>()

function seeded(seed: number): number {
  let value = seed | 0
  value = (value + 0x6d2b79f5) | 0
  let t = Math.imul(value ^ (value >>> 15), 1 | value)
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function seedFromText(value: string): number {
  let seed = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    seed = Math.imul(seed ^ value.charCodeAt(index), 16777619)
  }
  return seed >>> 0
}

function loadModel(url: string): Promise<Group> {
  const existing = modelCache.get(url)
  if (existing) return existing

  const pending = (async () => {
    const response = await fetch(url, { cache: 'default' })
    if (!response.ok) throw new Error(`Could not load dice model (${response.status}).`)
    const source = await response.arrayBuffer()
    const absoluteUrl = new URL(url, window.location.origin)
    const basePath = new URL('.', absoluteUrl).href
    const gltf = await new GLTFLoader().parseAsync(source, basePath)
    return gltf.scene
  })()

  modelCache.set(url, pending)
  pending.then(
    () => undefined,
    () => modelCache.delete(url),
  )
  return pending
}

async function loadThemeModel(
  theme: DiceThemeDefinition,
  sides: DiceVisualResult['sides'],
): Promise<Group | null> {
  const url = theme.models[sides]
  if (!url) return null
  try {
    return await loadModel(url)
  } catch {
    return null
  }
}

function proceduralGeometry(sides: number): BufferGeometry {
  if (sides === 4) return new TetrahedronGeometry(1, 0)
  if (sides === 6) return new BoxGeometry(1.5, 1.5, 1.5)
  if (sides === 8) return new OctahedronGeometry(1.05, 0)
  if (sides === 10 || sides === 100) return new IcosahedronGeometry(1.05, 0)
  if (sides === 12) return new DodecahedronGeometry(1.05, 0)
  return new IcosahedronGeometry(1.05, 0)
}

function styleImportedModel(root: Object3D, theme: DiceThemeDefinition): void {
  root.traverse((item) => {
    if (!(item instanceof Mesh)) return
    item.castShadow = true
    item.receiveShadow = true
    const materials = Array.isArray(item.material) ? item.material : [item.material]
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial)) continue
      material.emissive = new Color(theme.material.emissive)
      material.emissiveIntensity = theme.material.emissiveIntensity
      material.roughness = theme.material.roughness
      material.metalness = theme.material.metalness
      material.needsUpdate = true
    }
  })
}

function fitImportedModel(template: Group, theme: DiceThemeDefinition): Group {
  const root = template.clone(true)
  styleImportedModel(root, theme)
  root.updateMatrixWorld(true)
  const initialBounds = new Box3().setFromObject(root)
  const initialSize = initialBounds.getSize(new Vector3())
  const maxDimension = Math.max(initialSize.x, initialSize.y, initialSize.z, 0.001)
  root.scale.multiplyScalar(1.48 / maxDimension)
  root.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(root)
  const center = bounds.getCenter(new Vector3())
  root.position.sub(center)
  return root
}

function makeDie(
  die: DiceVisualResult,
  theme: DiceThemeDefinition,
  importedModel: Group | null,
): Group {
  if (importedModel) return fitImportedModel(importedModel, theme)

  const object = new Group()
  const material = new MeshStandardMaterial({
    color: new Color(theme.material.color),
    emissive: new Color(theme.material.emissive),
    emissiveIntensity: theme.material.emissiveIntensity,
    roughness: theme.material.roughness,
    metalness: theme.material.metalness,
  })
  const mesh = new Mesh(proceduralGeometry(die.sides), material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  object.add(mesh)
  return object
}

function displayedDice(dice: DiceVisualResult[]): DiceVisualResult[] {
  return dice
}

function scaleForDiceCount(count: number): number {
  return count > 28 ? 0.56 : count > 18 ? 0.66 : count > 10 ? 0.8 : count > 4 ? 0.94 : 1.12
}

function restingOrientation(object: Group, yaw: number): Quaternion {
  object.updateMatrixWorld(true)
  let faceNormal: Vector3 | null = null
  object.traverse((item) => {
    if (faceNormal || !(item instanceof Mesh)) return
    const positions = item.geometry.getAttribute('position')
    if (!positions || positions.count < 3) return
    const indices = item.geometry.getIndex()
    const triangleCount = indices?.count ?? positions.count
    for (let offset = 0; offset + 2 < triangleCount; offset += 3) {
      const first = indices ? indices.getX(offset) : offset
      const second = indices ? indices.getX(offset + 1) : offset + 1
      const third = indices ? indices.getX(offset + 2) : offset + 2
      const a = new Vector3().fromBufferAttribute(positions, first)
      const b = new Vector3().fromBufferAttribute(positions, second)
      const c = new Vector3().fromBufferAttribute(positions, third)
      const normal = b.sub(a).cross(c.sub(a))
      if (normal.lengthSq() < 1e-8) continue
      normal.normalize().applyQuaternion(item.getWorldQuaternion(new Quaternion()))
      faceNormal = normal.normalize()
      break
    }
  })

  const alignFace = faceNormal
    ? new Quaternion().setFromUnitVectors(faceNormal, new Vector3(0, 1, 0))
    : new Quaternion()
  const faceYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
  return faceYaw.multiply(alignFace)
}

function makeResultMarker(die: DiceVisualResult, theme: DiceThemeDefinition, scale: number): Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (context) {
    const ink = die.discarded ? '#ffc1a4' : '#ffffff'
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.beginPath()
    context.moveTo(128, 10)
    context.lineTo(238, 74)
    context.lineTo(238, 182)
    context.lineTo(128, 246)
    context.lineTo(18, 182)
    context.lineTo(18, 74)
    context.closePath()
    context.fillStyle = die.discarded ? 'rgba(48, 25, 20, 0.97)' : 'rgba(8, 17, 24, 0.97)'
    context.fill()
    context.lineWidth = 9
    context.strokeStyle = die.discarded ? '#ffb28a' : theme.stage.glow
    context.stroke()
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = '800 128px Inter, Arial, sans-serif'
    context.lineJoin = 'round'
    context.lineWidth = 14
    context.strokeStyle = 'rgba(0, 0, 0, 0.96)'
    context.shadowColor = die.discarded ? '#ff7957' : theme.stage.glow
    context.shadowBlur = 16
    context.strokeText(String(die.value), canvas.width / 2, canvas.height / 2)
    context.fillStyle = ink
    context.fillText(String(die.value), canvas.width / 2, canvas.height / 2)
  }
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  const material = new SpriteMaterial({
    map: texture,
    color: '#ffffff',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  })
  const sprite = new Sprite(material)
  const markerScale = scale * (die.discarded ? 0.58 : 0.68)
  sprite.scale.set(markerScale, markerScale, 1)
  sprite.renderOrder = 100
  sprite.visible = false
  return sprite
}

export function DiceRollStage({
  roll,
  theme,
  onComplete,
}: DiceRollStageProps) {
  const sceneHostRef = useRef<HTMLDivElement>(null)
  const onCompleteRef = useRef(onComplete)
  const [revealed, setRevealed] = useState(false)
  const [canvasFallback, setCanvasFallback] = useState(false)
  const visibleDice = roll ? displayedDice(roll.dice) : []

  onCompleteRef.current = onComplete

  useEffect(() => {
    if (!roll || !sceneHostRef.current) return

    let cancelled = false
    let renderer: WebGLRenderer | null = null
    let frame = 0
    let completeTimer = 0
    let revealTimer = 0
    let resizeObserver: ResizeObserver | null = null
    let contextLostListener: ((event: Event) => void) | null = null
    let motionDurationMs = Math.max(1000, theme.stage.durationMs)
    let shadowTexture: CanvasTexture | null = null
    let shadowGeometry: PlaneGeometry | null = null
    const shadowMaterials: MeshBasicMaterial[] = []
    const resultMarkerMaterials: SpriteMaterial[] = []
    const host = sceneHostRef.current
    const themeSnapshot = theme
    setRevealed(false)
    setCanvasFallback(false)

    const run = async () => {
      const count = visibleDice.length
      const loadedModels = Promise.all(
        visibleDice.map(async (die) => {
          return loadThemeModel(themeSnapshot, die.sides)
        }),
      )

      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      const columns = Math.max(1, Math.ceil(Math.sqrt(count * 1.35)))
      const rows = Math.ceil(count / columns)
      const spacing = count > 20 ? 1.05 : count > 10 ? 1.28 : count > 4 ? 1.42 : 1.58
      const floor = count > 20 ? 0.66 : count > 10 ? 0.73 : 0.82
      const scene = new Scene()
      const camera = new PerspectiveCamera(38, width / height, 0.1, 500)
      const viewWidth = Math.max(3, (columns - 1) * spacing + 2.4)
      const viewDepth = Math.max(3, (rows - 1) * spacing + 2.4)
      const cameraDistanceForAspect = (aspect: number) => Math.max(
        12,
        viewDepth / (2 * Math.tan((38 * Math.PI) / 360)) + 3,
        viewWidth / (2 * Math.tan((38 * Math.PI) / 360) * aspect) + 3,
      )
      let cameraDistance = cameraDistanceForAspect(width / height)
      camera.position.set(0, cameraDistance * 0.55, cameraDistance * 0.83)
      camera.lookAt(0, 0.3, 0)

      renderer = new WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
      renderer.setSize(width, height)
      renderer.outputColorSpace = SRGBColorSpace
      renderer.toneMapping = ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.28
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type = PCFSoftShadowMap
      renderer.setClearColor(0x000000, 0)
      renderer.domElement.className = 'dice-roll-webgl'
      host.replaceChildren(renderer.domElement)
      contextLostListener = (event) => {
        event.preventDefault()
        if (cancelled) return
        window.cancelAnimationFrame(frame)
        setCanvasFallback(true)
        revealTimer = window.setTimeout(() => {
          if (cancelled) return
          setRevealed(true)
          completeTimer = window.setTimeout(
            () => onCompleteRef.current(roll.id),
            themeSnapshot.stage.holdMs,
          )
        }, motionDurationMs + themeSnapshot.stage.revealDelayMs)
      }
      renderer.domElement.addEventListener('webglcontextlost', contextLostListener)

      scene.add(new HemisphereLight(0xcdf6ff, 0x071017, themeSnapshot.lighting.ambient))
      const keyLight = new DirectionalLight(0xe5fbff, themeSnapshot.lighting.key)
      keyLight.position.set(-3, 8, 5)
      keyLight.castShadow = true
      keyLight.shadow.mapSize.set(1024, 1024)
      keyLight.shadow.camera.left = -7
      keyLight.shadow.camera.right = 7
      keyLight.shadow.camera.top = 7
      keyLight.shadow.camera.bottom = -7
      keyLight.shadow.bias = -0.0005
      scene.add(keyLight)
      const fillLight = new PointLight(0x62c8e8, themeSnapshot.lighting.fill, 22)
      fillLight.position.set(5, 3, 1)
      scene.add(fillLight)
      const rimLight = new PointLight(themeSnapshot.stage.glow, themeSnapshot.lighting.rim, 24)
      rimLight.position.set(-4, 4, -5)
      scene.add(rimLight)

      const shadowCanvas = document.createElement('canvas')
      shadowCanvas.width = 128
      shadowCanvas.height = 128
      const shadowContext = shadowCanvas.getContext('2d')
      if (shadowContext) {
        const gradient = shadowContext.createRadialGradient(64, 64, 4, 64, 64, 62)
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.44)')
        gradient.addColorStop(0.35, 'rgba(0, 0, 0, 0.25)')
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
        shadowContext.fillStyle = gradient
        shadowContext.fillRect(0, 0, 128, 128)
        shadowTexture = new CanvasTexture(shadowCanvas)
      }
      const dieShadowGeometry = new PlaneGeometry(1, 1)
      shadowGeometry = dieShadowGeometry

      const randomSeed = seedFromText(roll.id)
      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
      const fallingDice: FallingDie[] = visibleDice.map((die, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const x = (column - (columns - 1) / 2) * spacing
        const z = (row - (rows - 1) / 2) * spacing
        const object = makeDie(die, themeSnapshot, null)
        object.scale.multiplyScalar(scaleForDiceCount(count))
        object.updateMatrixWorld(true)
        const objectHalfHeight = new Box3().setFromObject(object).getSize(new Vector3()).y / 2
        const dieFloor = Math.max(floor, objectHalfHeight + 0.035)
        const dieSeed = randomSeed + index * 0x9e3779b9
        const shadowMaterial = new MeshBasicMaterial({
          color: 0x020509,
          map: shadowTexture,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
          toneMapped: false,
        })
        shadowMaterials.push(shadowMaterial)
        const shadow = new Mesh(dieShadowGeometry, shadowMaterial)
        shadow.rotation.x = -Math.PI / 2
        shadow.position.set(x, 0.026, z)
        const shadowSize = scaleForDiceCount(count) * 1.9
        shadow.scale.set(shadowSize, shadowSize, 1)
        scene.add(shadow)
        const resultMarker = makeResultMarker(die, themeSnapshot, scaleForDiceCount(count))
        resultMarkerMaterials.push(resultMarker.material as SpriteMaterial)
        scene.add(resultMarker)
        const startX = x + (seeded(dieSeed + 4) - 0.5) * 1.05
        const startZ = z + (seeded(dieSeed + 6) - 0.5) * 1.05
        const landingX = x + (seeded(dieSeed + 8) - 0.5) * 0.34
        const landingZ = z + (seeded(dieSeed + 9) - 0.5) * 0.34
        const startHeight = themeSnapshot.stage.fallHeight + seeded(dieSeed + 5) * 0.55
        object.position.set(startX, startHeight, startZ)
        const restingYaw = seeded(dieSeed + 10) * Math.PI * 2
        const resting = restingOrientation(object, restingYaw)
        const launchRotation = new Euler(
          seeded(dieSeed + 1) * Math.PI * 2,
          seeded(dieSeed + 2) * Math.PI * 2,
          seeded(dieSeed + 3) * Math.PI * 2,
        )
        const launch = new Quaternion().setFromEuler(launchRotation)
        object.quaternion.copy(launch)
        const spinAxis = new Vector3(
          seeded(dieSeed + 11) - 0.5,
          seeded(dieSeed + 12) - 0.5,
          seeded(dieSeed + 13) - 0.5,
        ).normalize()
        const spinTurns = 0.9 + seeded(dieSeed + 14) * 1.1
        const impact = launch.clone().multiply(
          new Quaternion().setFromAxisAngle(spinAxis, spinTurns * Math.PI * 2),
        )
        const flightDistance = Math.max(0.1, startHeight - dieFloor)
        const flightDuration = clamp(
          Math.sqrt((2 * flightDistance) / Math.max(1, themeSnapshot.stage.gravity)) * 1.5,
          0.62,
          0.88,
        )
        const bounceOneDuration = 0.27 + seeded(dieSeed + 15) * 0.07
        const bounceTwoDuration = 0.16 + seeded(dieSeed + 16) * 0.05
        scene.add(object)
        return {
          object,
          shadow,
          startX,
          startZ,
          landingX,
          landingZ,
          startHeight,
          delay: seeded(dieSeed + 7) * 110,
          floor: dieFloor,
          flightDuration,
          bounceOneDuration,
          bounceTwoDuration,
          bounceOneHeight: 0.16 + seeded(dieSeed + 17) * 0.12,
          bounceTwoHeight: 0.045 + seeded(dieSeed + 18) * 0.035,
          launchQuaternion: launch,
          impactQuaternion: impact,
          restingQuaternion: resting,
          spinAxis,
          spinTurns,
          restingYaw,
          flightProgress: 0,
          halfHeight: objectHalfHeight,
          resultMarker,
        }
      })

      motionDurationMs = Math.max(
        themeSnapshot.stage.durationMs,
        ...fallingDice.map((die) => (
          (die.delay + die.flightDuration * 1000 + (die.bounceOneDuration + die.bounceTwoDuration) * 1000 + 180)
        )),
      )

      void loadedModels.then((models) => {
        if (cancelled) return
        for (let index = 0; index < models.length; index += 1) {
          const model = models[index]
          if (!model) continue
          const falling = fallingDice[index]
          const visual = visibleDice[index]
          if (!falling || !visual) continue

          const replacement = makeDie(visual, themeSnapshot, model)
          replacement.scale.multiplyScalar(scaleForDiceCount(count))
          replacement.position.copy(falling.object.position)
          const resting = restingOrientation(replacement, falling.restingYaw)
          replacement.rotation.copy(falling.object.rotation)
          replacement.updateMatrixWorld(true)
          const halfHeight = new Box3().setFromObject(replacement).getSize(new Vector3()).y / 2
          falling.floor = Math.max(floor, halfHeight + 0.035)
          falling.halfHeight = halfHeight
          falling.restingQuaternion.copy(resting)
          if (falling.flightProgress < 1) {
            const currentSpin = new Quaternion().setFromAxisAngle(
              falling.spinAxis,
              falling.spinTurns * Math.PI * 2 * falling.flightProgress,
            )
            falling.launchQuaternion.copy(replacement.quaternion).multiply(currentSpin.invert())
            falling.impactQuaternion.copy(falling.launchQuaternion).multiply(
              new Quaternion().setFromAxisAngle(falling.spinAxis, falling.spinTurns * Math.PI * 2),
            )
          }
          scene.remove(falling.object)
          falling.object = replacement
          scene.add(replacement)
        }
      })

      const startedAt = performance.now()

      const animate = (now: number) => {
        if (cancelled || !renderer) return
        for (const die of fallingDice) {
          const elapsed = (now - startedAt - die.delay) / 1000
          const progress = clamp(elapsed / die.flightDuration, 0, 1)
          die.flightProgress = progress
          const horizontalEase = progress * progress * (3 - 2 * progress)
          const fallDistance = Math.max(0, die.startHeight - die.floor)
          die.object.position.x = die.startX + (die.landingX - die.startX) * horizontalEase
          die.object.position.z = die.startZ + (die.landingZ - die.startZ) * horizontalEase

          const spin = new Quaternion().setFromAxisAngle(
            die.spinAxis,
            die.spinTurns * Math.PI * 2 * progress,
          )
          if (elapsed < die.flightDuration) {
            die.object.position.y = die.startHeight - fallDistance * progress * progress
            die.object.quaternion.copy(die.launchQuaternion).multiply(spin)
          } else {
            const settledTime = elapsed - die.flightDuration
            let bounceHeight = 0
            if (settledTime < die.bounceOneDuration) {
              const bounceProgress = settledTime / die.bounceOneDuration
              bounceHeight = 4 * die.bounceOneHeight * bounceProgress * (1 - bounceProgress)
            } else if (settledTime < die.bounceOneDuration + die.bounceTwoDuration) {
              const bounceProgress = (settledTime - die.bounceOneDuration) / die.bounceTwoDuration
              bounceHeight = 4 * die.bounceTwoHeight * bounceProgress * (1 - bounceProgress)
            }
            die.object.position.y = die.floor + bounceHeight
            const settleDuration = die.bounceOneDuration + die.bounceTwoDuration
            const settleProgress = clamp(settledTime / settleDuration, 0, 1)
            const settleEase = 1 - Math.pow(1 - settleProgress, 3)
            const resting = die.impactQuaternion.clone().slerp(die.restingQuaternion, settleEase)
            const wobble = Math.sin(settledTime * 22) * Math.exp(-settledTime * 8) * 0.055
            resting.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), wobble))
            die.object.quaternion.copy(resting)
          }
          const hoverHeight = Math.max(0, die.object.position.y - die.floor)
          die.shadow.position.x = die.object.position.x
          die.shadow.position.z = die.object.position.z
          die.shadow.material.opacity = 0.34 / (1 + hoverHeight * 0.34)
          const shadowScale = scaleForDiceCount(count) * (1.9 + Math.min(hoverHeight * 0.16, 0.7))
          die.shadow.scale.set(shadowScale, shadowScale, 1)

          const settledTime = Math.max(0, elapsed - die.flightDuration - die.bounceOneDuration - die.bounceTwoDuration)
          die.resultMarker.position.set(
            die.object.position.x,
            die.object.position.y + die.halfHeight + 0.025,
            die.object.position.z,
          )
          if (settledTime > 0) {
            die.resultMarker.visible = true
            ;(die.resultMarker.material as SpriteMaterial).opacity = clamp(settledTime / 0.16, 0, 0.96)
          }
        }

        try {
          renderer.render(scene, camera)
        } catch {
          window.cancelAnimationFrame(frame)
          setCanvasFallback(true)
          revealTimer = window.setTimeout(() => {
            if (cancelled) return
            setRevealed(true)
            completeTimer = window.setTimeout(
              () => onCompleteRef.current(roll.id),
              themeSnapshot.stage.holdMs,
            )
          }, motionDurationMs + themeSnapshot.stage.revealDelayMs)
          return
        }
        if (now - startedAt >= motionDurationMs) {
          revealTimer = window.setTimeout(() => {
            if (cancelled) return
            setRevealed(true)
            completeTimer = window.setTimeout(
              () => onCompleteRef.current(roll.id),
              themeSnapshot.stage.holdMs,
            )
          }, themeSnapshot.stage.revealDelayMs)
          return
        }
        frame = window.requestAnimationFrame(animate)
      }

      const resize = () => {
        if (!renderer) return
        const nextWidth = Math.max(1, host.clientWidth)
        const nextHeight = Math.max(1, host.clientHeight)
        renderer.setSize(nextWidth, nextHeight)
        camera.aspect = nextWidth / nextHeight
        cameraDistance = cameraDistanceForAspect(camera.aspect)
        camera.position.set(0, cameraDistance * 0.55, cameraDistance * 0.83)
        camera.updateProjectionMatrix()
        try {
          renderer.render(scene, camera)
        } catch {
          setCanvasFallback(true)
        }
      }

      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(host)
      frame = window.requestAnimationFrame(animate)
    }

    void run().catch(() => {
      if (!cancelled) {
        setCanvasFallback(true)
        revealTimer = window.setTimeout(() => {
          if (cancelled) return
          setRevealed(true)
          completeTimer = window.setTimeout(
            () => onCompleteRef.current(roll.id),
            themeSnapshot.stage.holdMs,
          )
        }, motionDurationMs + themeSnapshot.stage.revealDelayMs)
      }
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
      window.clearTimeout(revealTimer)
      window.clearTimeout(completeTimer)
      resizeObserver?.disconnect()
      if (renderer && contextLostListener) {
        renderer.domElement.removeEventListener('webglcontextlost', contextLostListener)
      }
      renderer?.dispose()
      shadowMaterials.forEach((material) => material.dispose())
      resultMarkerMaterials.forEach((material) => {
        material.map?.dispose()
        material.dispose()
      })
      shadowGeometry?.dispose()
      shadowTexture?.dispose()
      if (host) host.replaceChildren()
    }
  }, [roll?.id, theme.id])

  if (!roll) return null

  const visibleResults = roll.dice
  const hasDiscardedDie = roll.dice.some((die) => die.discarded)

  return (
    <div
      className={`dice-roll-overlay${revealed ? ' is-revealed' : ''}`}
      style={{
        '--dice-glow': theme.stage.glow,
        '--dice-stage': theme.stage.color,
      } as CSSProperties}
    >
      <div
        className={`dice-roll-scene${canvasFallback ? ' uses-css-fallback' : ''}`}
        style={{ '--dice-fall-duration': `${Math.max(1000, theme.stage.durationMs)}ms` } as CSSProperties}
        aria-hidden="true"
      >
        <div className="dice-roll-render-host" ref={sceneHostRef} />
        {canvasFallback ? (
          <div className="dice-roll-fallback-scene">
            {visibleDice.map((die, index) => (
              <span
                className={`dice-fallback-die sides-${die.sides}`}
                key={`${roll.id}-fallback-${index}`}
                style={{ '--die-delay': `${index * 42}ms` } as CSSProperties}
              ><i>◇</i></span>
            ))}
          </div>
        ) : null}
      </div>
      {revealed ? (
        <div className="dice-roll-result" role="status" aria-live="polite">
          <span className="dice-roll-roller">{roll.rollerName}</span>
          <strong className="dice-roll-title">{roll.title}</strong>
          <div className="dice-roll-values" aria-label="Rolled dice values">
            {visibleResults.map((die, index) => (
              <span
                key={`${roll.id}-${index}`}
                className={die.discarded ? 'is-discarded' : 'is-kept'}
                title={`d${die.sides}`}
              >
                <small>d{die.sides === 100 ? '%' : die.sides}</small>
                <b>{die.value}</b>
                {hasDiscardedDie
                  ? <i>{die.discarded ? 'DROP' : 'KEEP'}</i>
                  : null}
              </span>
            ))}
          </div>
          <div className="dice-roll-total-row">
            <span>{roll.detail ? `TOTAL · ${roll.detail}` : 'TOTAL'}</span>
            <b>{roll.total}</b>
          </div>
        </div>
      ) : null}
    </div>
  )
}

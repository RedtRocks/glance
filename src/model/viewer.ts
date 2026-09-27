/**
 * 3D model viewer (lazy chunk): three.js with the loaders for the formats Preview
 * opens and more. Renders on demand (only when the view changes), except while a
 * model animates or auto-rotates.
 */
import * as THREE from 'three'
import { t } from '../i18n'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { isTouchpad, pinchScale } from '../core/touchpad'

export interface ModelStats {
  meshes: number
  triangles: number
  vertices: number
  animations: number
}

export type Lighting = 'studio' | 'soft' | 'sunlight' | 'dramatic' | 'flat'
export type Backdrop = 'theme' | 'white' | 'black' | 'gradient' | 'room'
export type Look = 'original' | 'clay' | 'normals' | 'xray'
export type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'home'

export interface ModelViewer {
  stats: ModelStats
  resetView(): void
  setView(view: CameraView): void
  setLighting(preset: Lighting): void
  setBackdrop(backdrop: Backdrop): void
  setLook(look: Look): void
  setShadow(on: boolean): void
  setGrid(on: boolean): void
  setWireframe(on: boolean): void
  setAutoRotate(on: boolean): void
  setDark(dark: boolean): void
  snapshot(): Promise<Blob>
  resize(): void
  dispose(): void
}

/** Maps a file referenced by the model (textures, .bin, .mtl) to a loadable URL. */
export type Resolve = (relative: string) => string

const ext = (name: string) => /\.([^.\\/]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''
const text = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes)

export const MODEL_EXTS = ['glb', 'gltf', 'obj', 'stl', 'ply', '3mf', 'dae', 'fbx', 'usdz', '3ds']

function surface(color = 0xb8bcc4): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.6, side: THREE.DoubleSide })
}

function meshFromGeometry(g: THREE.BufferGeometry): THREE.Object3D {
  if (!g.getAttribute('normal') && g.index) g.computeVertexNormals()
  const colored = !!g.getAttribute('color')
  // Point clouds (PLY scans without faces) render as points.
  if (!g.index && g.getAttribute('position').count % 3 !== 0) {
    return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.01, vertexColors: colored, sizeAttenuation: true }))
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const m = surface()
  m.vertexColors = colored
  if (colored) m.color.set(0xffffff)
  return new THREE.Mesh(g, m)
}

/**
 * Parses a model file into an object (and its animation clips). Some loaders (OBJ
 * materials, FBX, Collada, 3DS) fetch textures after returning; `onAsset` fires as
 * each arrives so an on-demand renderer can redraw.
 */
export async function parseModel(bytes: ArrayBuffer, name: string, resolve: Resolve, onAsset?: () => void): Promise<{ object: THREE.Object3D; clips: THREE.AnimationClip[] }> {
  const manager = new THREE.LoadingManager()
  if (onAsset) manager.onProgress = manager.onLoad = onAsset
  manager.setURLModifier((url) => (/^(data|blob|https?|glance):/i.test(url) ? url : resolve(decodeURIComponent(url))))
  switch (ext(name)) {
    case 'glb':
    case 'gltf': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')
      const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder)
      const gltf = await loader.parseAsync(ext(name) === 'gltf' ? text(bytes) : bytes, '')
      return { object: gltf.scene, clips: gltf.animations }
    }
    case 'obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
      const source = text(bytes)
      const loader = new OBJLoader(manager)
      // Materials from the .mtl the file names, when it sits next to it.
      const mtl = /^mtllib\s+(.+)$/m.exec(source)?.[1]?.trim()
      let styled = false
      if (mtl) {
        try {
          const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js')
          const res = await fetch(resolve(mtl))
          if (res.ok) {
            const materials = new MTLLoader(manager).parse(await res.text(), '')
            materials.preload()
            loader.setMaterials(materials)
            styled = true
          }
        } catch {
          /* no materials: default surface */
        }
      }
      const object = loader.parse(source)
      // Without materials, keep per-vertex colors (OBJ "v x y z r g b") if the file has them.
      if (!styled)
        object.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return
          const colored = !!(o.geometry as THREE.BufferGeometry).getAttribute('color')
          const m = surface(colored ? 0xffffff : undefined)
          m.vertexColors = colored
          o.material = m
        })
      return { object, clips: [] }
    }
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
      return { object: meshFromGeometry(new STLLoader(manager).parse(bytes)), clips: [] }
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js')
      return { object: meshFromGeometry(new PLYLoader(manager).parse(bytes)), clips: [] }
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js')
      return { object: new ThreeMFLoader(manager).parse(bytes), clips: [] }
    }
    case 'dae': {
      const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js')
      const c = new ColladaLoader(manager).parse(text(bytes), '')
      if (!c) throw new Error(t('This Collada file has no scene.'))
      return { object: c.scene, clips: c.scene.animations ?? [] }
    }
    case 'fbx': {
      const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js')
      const object = new FBXLoader(manager).parse(bytes, '')
      return { object, clips: object.animations }
    }
    case 'usdz': {
      const { USDZLoader } = await import('three/examples/jsm/loaders/USDZLoader.js')
      return { object: new USDZLoader(manager).parse(bytes), clips: [] }
    }
    case '3ds': {
      const { TDSLoader } = await import('three/examples/jsm/loaders/TDSLoader.js')
      return { object: new TDSLoader(manager).parse(bytes, ''), clips: [] }
    }
    default:
      throw new Error(t('.{ext} models aren’t supported yet.', { ext: ext(name) }))
  }
}

interface LightRig {
  env: number
  hemi: [sky: number, ground: number, intensity: number]
  sun: [color: number, intensity: number, dir: [number, number, number]]
  ambient: number
  exposure: number
}

/** Lighting presets, like Preview's scene lighting choices. */
export const LIGHTING: Record<Lighting, LightRig> = {
  studio: { env: 1, hemi: [0xffffff, 0x444444, 0.6], sun: [0xffffff, 1.2, [3, 5, 4]], ambient: 0, exposure: 1 },
  soft: { env: 1.3, hemi: [0xffffff, 0x888888, 1], sun: [0xffffff, 0.35, [1, 6, 2]], ambient: 0.2, exposure: 1 },
  sunlight: { env: 0.5, hemi: [0xbfd9ff, 0x8a7458, 0.7], sun: [0xfff0d4, 2.6, [5, 7, 2]], ambient: 0, exposure: 1.05 },
  dramatic: { env: 0.12, hemi: [0xffffff, 0x000000, 0.08], sun: [0xffffff, 3.2, [-4, 3, -2.5]], ambient: 0, exposure: 1.1 },
  flat: { env: 0, hemi: [0xffffff, 0xffffff, 0], sun: [0xffffff, 0, [3, 5, 4]], ambient: 2.6, exposure: 1 }
}

/** Camera directions for the preset views (from the target toward the camera). */
const VIEWS: Record<Exclude<CameraView, 'home'>, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  // A hair off the pole so orbiting afterwards doesn't flip.
  top: [0, 1, 1e-4],
  bottom: [0, -1, 1e-4]
}

function gradientTexture(dark: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 2
  c.height = 256
  const g = c.getContext('2d')!
  const fill = g.createLinearGradient(0, 0, 0, 256)
  fill.addColorStop(0, dark ? '#3a3d44' : '#ffffff')
  fill.addColorStop(1, dark ? '#101113' : '#c9ced6')
  g.fillStyle = fill
  g.fillRect(0, 0, 2, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function statsOf(object: THREE.Object3D, clips: THREE.AnimationClip[]): ModelStats {
  const s: ModelStats = { meshes: 0, triangles: 0, vertices: 0, animations: clips.length }
  object.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (!g || !(o instanceof THREE.Mesh || o instanceof THREE.Points)) return
    s.meshes++
    const count = g.getAttribute('position')?.count ?? 0
    s.vertices += count
    if (o instanceof THREE.Mesh) s.triangles += Math.floor((g.index ? g.index.count : count) / 3)
  })
  return s
}

export async function createViewer(canvas: HTMLCanvasElement, bytes: ArrayBuffer, name: string, opts: { resolve: Resolve; dark: boolean }): Promise<ModelViewer> {
  let redraw = () => {}
  const { object, clips } = await parseModel(bytes, name, opts.resolve, () => redraw())
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const room = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = room
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6)
  const ambient = new THREE.AmbientLight(0xffffff, 0)
  const sun = new THREE.DirectionalLight(0xffffff, 1.2)
  scene.add(hemi, ambient, sun, sun.target)

  // Center the model at the origin.
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  object.position.sub(center)
  scene.add(object)
  const radius = Math.max(size.length() / 2, 1e-3)
  const floorY = -size.y / 2

  // Sun shadows fall on an invisible floor under the model.
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = radius * 0.004
  const shadowCam = sun.shadow.camera
  shadowCam.left = shadowCam.bottom = -radius * 1.6
  shadowCam.right = shadowCam.top = radius * 1.6
  shadowCam.near = radius * 0.1
  shadowCam.far = radius * 10
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 12, radius * 12), new THREE.ShadowMaterial({ opacity: 0.28 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = floorY - radius * 0.001
  floor.receiveShadow = true
  floor.visible = false
  scene.add(floor)
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true
  })

  let grid: THREE.GridHelper | null = null
  let dark = opts.dark
  let backdrop: Backdrop = 'theme'
  const makeGrid = () => {
    // Grid lines follow how dark the background is, not the app theme.
    const darkBg = backdrop === 'black' || ((backdrop === 'theme' || backdrop === 'gradient') && dark)
    const visible = grid?.visible ?? false
    if (grid) {
      scene.remove(grid)
      grid.dispose()
    }
    grid = new THREE.GridHelper(radius * 6, 24, darkBg ? 0x6b6b6b : 0x9a9a9a, darkBg ? 0x3a3a3a : 0xd0d0d0)
    grid.position.y = floorY
    grid.visible = visible
    scene.add(grid)
  }
  makeGrid()

  const camera = new THREE.PerspectiveCamera(40, 1, radius / 100, radius * 100)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.autoRotateSpeed = 1.5

  const distance = () => (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1
  const look = (dir: THREE.Vector3) => {
    const d = distance()
    camera.position.copy(dir.normalize().multiplyScalar(d))
    controls.target.set(0, 0, 0)
    camera.near = d / 100
    camera.far = d * 100
    camera.updateProjectionMatrix()
    controls.update()
  }
  const home = () => look(new THREE.Vector3(0.55, 0.4, 0.75))

  const mixer = clips.length ? new THREE.AnimationMixer(object) : null
  if (mixer) mixer.clipAction(clips[0]).play()
  const clock = new THREE.Clock()
  let frame = 0
  let dirty = true
  const loop = () => {
    frame = requestAnimationFrame(loop)
    const dt = clock.getDelta()
    const moving = controls.update()
    if (mixer) mixer.update(dt)
    if (dirty || moving || mixer || controls.autoRotate) {
      renderer.render(scene, camera)
      dirty = false
    }
  }
  controls.addEventListener('change', () => (dirty = true))
  redraw = () => void (dirty = true)

  // Touchpad: two-finger drag orbits, Shift + two-finger drag pans, and pinch
  // zooms. A mouse wheel (with or without Ctrl) still zooms through OrbitControls.
  // Pinch is handled here because Windows delivers it as Ctrl+wheel with tiny
  // deltas, often with a synthetic Ctrl keydown; OrbitControls then takes it for a
  // held Ctrl key and scales it down to almost nothing.
  const onWheel = (e: WheelEvent) => {
    if (!isTouchpad(e)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    const h = canvas.clientHeight || 1
    const offset = camera.position.clone().sub(controls.target)
    if (e.ctrlKey) {
      const d = THREE.MathUtils.clamp(offset.length() * pinchScale(e.deltaY), radius * 0.05, radius * 50)
      camera.position.copy(controls.target).add(offset.setLength(d))
    } else if (e.shiftKey) {
      const perPixel = (2 * offset.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / h
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1)
      const move = right.multiplyScalar(e.deltaX * perPixel).add(up.multiplyScalar(-e.deltaY * perPixel))
      camera.position.add(move)
      controls.target.add(move)
    } else {
      const s = new THREE.Spherical().setFromVector3(offset)
      s.theta += (2 * Math.PI * e.deltaX) / h
      s.phi = THREE.MathUtils.clamp(s.phi + (2 * Math.PI * e.deltaY) / h, 1e-3, Math.PI - 1e-3)
      camera.position.copy(controls.target).add(offset.setFromSpherical(s))
    }
    controls.update()
    dirty = true
  }
  canvas.addEventListener('wheel', onWheel, { capture: true, passive: false })

  // Lighting presets move and recolor the same lights.
  const setLighting = (preset: Lighting) => {
    const rig = LIGHTING[preset]
    scene.environmentIntensity = rig.env
    hemi.color.set(rig.hemi[0])
    hemi.groundColor.set(rig.hemi[1])
    hemi.intensity = rig.hemi[2]
    sun.color.set(rig.sun[0])
    sun.intensity = rig.sun[1]
    sun.position.set(...rig.sun[2]).normalize().multiplyScalar(radius * 4)
    ambient.intensity = rig.ambient
    renderer.toneMappingExposure = rig.exposure
    dirty = true
  }

  // Backgrounds; "theme" follows the app's light or dark theme.
  let gradient: THREE.CanvasTexture | null = null
  const applyBackdrop = () => {
    gradient?.dispose()
    gradient = null
    scene.backgroundBlurriness = 0
    if (backdrop === 'white') scene.background = new THREE.Color(0xffffff)
    else if (backdrop === 'black') scene.background = new THREE.Color(0x000000)
    else if (backdrop === 'gradient') scene.background = gradient = gradientTexture(dark)
    else if (backdrop === 'room') {
      scene.background = room
      scene.backgroundBlurriness = 0.35
    } else scene.background = new THREE.Color(dark ? 0x1f1f1f : 0xf3f3f3)
    dirty = true
  }

  // Material overrides swap each mesh's material and restore the originals.
  const originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) originals.set(o, o.material)
  })
  const overrides: Partial<Record<Exclude<Look, 'original'>, THREE.Material>> = {}
  const override = (l: Exclude<Look, 'original'>): THREE.Material => {
    if (overrides[l]) return overrides[l]
    const side = THREE.DoubleSide
    return (overrides[l] =
      l === 'clay'
        ? new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 0.85, metalness: 0, side })
        : l === 'normals'
          ? new THREE.MeshNormalMaterial({ side })
          : new THREE.MeshStandardMaterial({ color: 0x5aa0ff, emissive: 0x0b2a55, roughness: 0.3, transparent: true, opacity: 0.28, depthWrite: false, side }))
  }
  let wireframe = false
  const eachMaterial = (fn: (m: THREE.Material) => void) =>
    object.traverse((o) => {
      const mats = (o as THREE.Mesh).material
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) fn(m)
    })
  const applyWireframe = () =>
    eachMaterial((m) => {
      if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = wireframe
    })
  const setLook = (l: Look) => {
    for (const [mesh, mat] of originals) mesh.material = l === 'original' ? mat : override(l)
    applyWireframe()
    dirty = true
  }

  const resize = () => {
    const w = canvas.clientWidth || 1
    const h = canvas.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    dirty = true
  }
  setLighting('studio')
  applyBackdrop()
  resize()
  home()
  loop()

  return {
    stats: statsOf(object, clips),
    resetView: () => (home(), (dirty = true)),
    setView: (view) => {
      if (view === 'home') home()
      else look(new THREE.Vector3(...VIEWS[view]))
      dirty = true
    },
    setLighting,
    setBackdrop: (b) => {
      backdrop = b
      makeGrid()
      applyBackdrop()
    },
    setLook,
    setShadow: (on) => {
      sun.castShadow = on
      floor.visible = on
      dirty = true
    },
    setGrid: (on) => {
      grid!.visible = on
      dirty = true
    },
    setWireframe: (on) => {
      wireframe = on
      applyWireframe()
      dirty = true
    },
    setAutoRotate: (on) => void (controls.autoRotate = on),
    setDark: (d) => {
      dark = d
      makeGrid()
      applyBackdrop()
    },
    snapshot: () => {
      renderer.render(scene, camera)
      return new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('snapshot failed'))), 'image/png'))
    },
    resize,
    dispose: () => {
      cancelAnimationFrame(frame)
      canvas.removeEventListener('wheel', onWheel, { capture: true })
      controls.dispose()
      for (const [mesh, mat] of originals) mesh.material = mat
      object.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mats = m.material
        for (const mat of Array.isArray(mats) ? mats : mats ? [mats] : []) mat.dispose()
      })
      for (const m of Object.values(overrides)) m.dispose()
      floor.geometry.dispose()
      ;(floor.material as THREE.Material).dispose()
      grid?.dispose()
      gradient?.dispose()
      sun.shadow.map?.dispose()
      pmrem.dispose()
      room.dispose()
      renderer.dispose()
    }
  }
}

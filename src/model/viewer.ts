/**
 * 3D model viewer (lazy chunk): three.js with the loaders for the formats Preview
 * opens and more. Renders on demand (only when the view changes), except while a
 * model animates or auto-rotates.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export interface ModelStats {
  meshes: number
  triangles: number
  vertices: number
  animations: number
}

export interface ModelViewer {
  stats: ModelStats
  resetView(): void
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

/** Parses a model file into an object (and its animation clips). */
export async function parseModel(bytes: ArrayBuffer, name: string, resolve: Resolve): Promise<{ object: THREE.Object3D; clips: THREE.AnimationClip[] }> {
  const manager = new THREE.LoadingManager()
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
      if (!styled) object.traverse((o) => o instanceof THREE.Mesh && (o.material = surface()))
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
      if (!c) throw new Error('This Collada file has no scene.')
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
      throw new Error(`.${ext(name)} models aren’t supported yet.`)
  }
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
  const { object, clips } = await parseModel(bytes, name, opts.resolve)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6))
  const sun = new THREE.DirectionalLight(0xffffff, 1.2)
  sun.position.set(3, 5, 4)
  scene.add(sun)

  // Center the model at the origin.
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  object.position.sub(center)
  scene.add(object)
  const radius = Math.max(size.length() / 2, 1e-3)

  const camera = new THREE.PerspectiveCamera(40, 1, radius / 100, radius * 100)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.autoRotateSpeed = 1.5

  const home = () => {
    const d = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.1
    camera.position.set(d * 0.55, d * 0.4, d * 0.75)
    controls.target.set(0, 0, 0)
    camera.near = d / 100
    camera.far = d * 100
    camera.updateProjectionMatrix()
    controls.update()
  }

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

  const setDark = (dark: boolean) => {
    scene.background = new THREE.Color(dark ? 0x1f1f1f : 0xf3f3f3)
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
  setDark(opts.dark)
  resize()
  home()
  loop()

  return {
    stats: statsOf(object, clips),
    resetView: () => (home(), (dirty = true)),
    setWireframe: (on) => {
      object.traverse((o) => {
        const mats = (o as THREE.Mesh).material
        for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = on
      })
      dirty = true
    },
    setAutoRotate: (on) => void (controls.autoRotate = on),
    setDark,
    snapshot: () => {
      renderer.render(scene, camera)
      return new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('snapshot failed'))), 'image/png'))
    },
    resize,
    dispose: () => {
      cancelAnimationFrame(frame)
      controls.dispose()
      object.traverse((o) => {
        const m = o as THREE.Mesh
        m.geometry?.dispose()
        const mats = m.material
        for (const mat of Array.isArray(mats) ? mats : mats ? [mats] : []) mat.dispose()
      })
      pmrem.dispose()
      renderer.dispose()
    }
  }
}

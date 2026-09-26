import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import { parseModel, statsOf } from '../src/model/viewer'

const load = (name: string) => {
  const b = readFileSync(resolve(__dirname, 'models', name))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const noFiles = () => 'missing:'

describe('3D models', () => {
  it('parses STL, OBJ and GLB and counts their geometry', async () => {
    for (const [file, triangles] of [['pyramid.stl', 4], ['cube.obj', 12], ['tri.glb', 1]] as const) {
      const { object, clips } = await parseModel(load(file), file, noFiles)
      const s = statsOf(object, clips)
      expect(s.meshes, file).toBe(1)
      expect(s.triangles, file).toBe(triangles)
    }
  })

  it('keeps per-vertex colors of an OBJ without materials', async () => {
    const { object } = await parseModel(load('colored.obj'), 'colored.obj', noFiles)
    const meshes: THREE.Mesh[] = []
    object.traverse((o) => o instanceof THREE.Mesh && meshes.push(o))
    expect(meshes).toHaveLength(1)
    const m = meshes[0].material as THREE.MeshStandardMaterial
    expect(m.vertexColors).toBe(true)
    expect(m.color.getHex()).toBe(0xffffff)
    expect(meshes[0].geometry.getAttribute('color').count).toBe(3)
  })

  it('reports unsupported extensions clearly', async () => {
    await expect(parseModel(new ArrayBuffer(8), 'scene.blend', noFiles)).rejects.toThrow(/\.blend models/)
  })
})

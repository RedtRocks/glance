import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('reports unsupported extensions clearly', async () => {
    await expect(parseModel(new ArrayBuffer(8), 'scene.blend', noFiles)).rejects.toThrow(/\.blend models/)
  })
})

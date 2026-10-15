import { describe, expect, it } from 'vitest'
import { isWebUrl, modelAssetUrl, webHosts } from '../src/core/modelAssets'

const resolve = (rel: string) => `resolved:${rel}`

describe('model asset URLs', () => {
  it('resolves files next to the model', () => {
    expect(modelAssetUrl('textures/wood%20grain.png', resolve)).toBe('resolved:textures/wood grain.png')
    expect(modelAssetUrl('C:/models/tex.png', resolve)).toBe('resolved:C:/models/tex.png')
  })

  it('keeps data inside the file and Glance\'s own URLs', () => {
    for (const url of ['data:image/png;base64,AAAA', 'blob:http://x/1', 'glance://localhost/file?path=a', 'http://glance.localhost/file?path=a'])
      expect(modelAssetUrl(url, resolve)).toBe(url)
  })

  it('holds back web addresses until allowed, and reports them', () => {
    const held: string[] = []
    for (const url of ['https://tracker.example/pixel.png', 'http://example.com/a.bin', 'HTTPS://x/y', 'http://glance.localhost.evil.com/x'])
      expect(modelAssetUrl(url, resolve, { allow: false, blocked: (u) => held.push(u) })).toBe('data:,')
    expect(held).toHaveLength(4)
    expect(modelAssetUrl('https://cdn.example/t.png', resolve, { allow: true })).toBe('https://cdn.example/t.png')
  })

  it('never loads other schemes', () => {
    expect(modelAssetUrl('file:///etc/passwd', resolve, { allow: true })).toBe('data:,')
  })

  it('tells web addresses from Glance\'s own', () => {
    expect(isWebUrl('https://a.example/x')).toBe(true)
    expect(isWebUrl('http://glance.localhost/file?path=a')).toBe(false)
  })

  it('lists each site once', () => {
    expect(webHosts(['https://b.example/1', 'https://a.example/2', 'https://b.example/3', 'nonsense'])).toEqual(['a.example', 'b.example'])
  })
})

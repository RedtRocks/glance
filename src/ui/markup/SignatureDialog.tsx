import { useEffect, useRef, useState } from 'preact/hooks'
import { Modal } from '../dialogs/Dialog'
import { activeSignature, setTool, signatureDialog } from '../../state/markupState'
import { saveSignature } from '../../platform'
import { toast } from '../../state/ui'

const W = 560
const H = 200

/** Trims transparent borders and returns a PNG (base64, no data: prefix). */
function exportTrimmed(canvas: HTMLCanvasElement): string | null {
  const g = canvas.getContext('2d')!
  const { data, width, height } = g.getImageData(0, 0, canvas.width, canvas.height)
  let x1 = width
  let y1 = height
  let x2 = -1
  let y2 = -1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x1) x1 = x
        if (x > x2) x2 = x
        if (y < y1) y1 = y
        if (y > y2) y2 = y
      }
  if (x2 < 0) return null
  const pad = 6
  x1 = Math.max(0, x1 - pad)
  y1 = Math.max(0, y1 - pad)
  x2 = Math.min(width - 1, x2 + pad)
  y2 = Math.min(height - 1, y2 + pad)
  const out = document.createElement('canvas')
  out.width = x2 - x1 + 1
  out.height = y2 - y1 + 1
  out.getContext('2d')!.drawImage(canvas, x1, y1, out.width, out.height, 0, 0, out.width, out.height)
  return out.toDataURL('image/png').split(',')[1]
}

/**
 * Converts a photo of a signature on paper into ink on transparent background:
 * dark pixels become opaque ink, light paper becomes transparent.
 */
function inkFromPhoto(img: CanvasImageSource & { width: number; height: number }, target: HTMLCanvasElement, srcW = img.width, srcH = img.height): void {
  const scale = Math.min(1, (W * 2) / srcW, (H * 2) / srcH)
  const w = Math.round(srcW * scale)
  const h = Math.round(srcH * scale)
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = h
  const g = tmp.getContext('2d')!
  g.drawImage(img, 0, 0, w, h)
  const px = g.getImageData(0, 0, w, h)
  const d = px.data
  // Adaptive threshold from the mean brightness (paper dominates the image).
  let sum = 0
  for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
  const mean = sum / (d.length / 4)
  const t = mean * 0.72
  for (let i = 0; i < d.length; i += 4) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
    const a = lum >= t ? 0 : Math.min(255, Math.round(((t - lum) / t) * 255 * 2.2))
    d[i] = d[i + 1] = d[i + 2] = 20
    d[i + 3] = a
  }
  g.putImageData(px, 0, 0)
  target.width = W * 2
  target.height = H * 2
  const tg = target.getContext('2d')!
  tg.clearRect(0, 0, target.width, target.height)
  const fit = Math.min(target.width / w, target.height / h)
  tg.drawImage(tmp, (target.width - w * fit) / 2, (target.height - h * fit) / 2, w * fit, h * fit)
}

export function SignatureDialog() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [name, setName] = useState('My signature')
  const [empty, setEmpty] = useState(true)
  const close = (): void => void (signatureDialog.value = false)

  useEffect(() => {
    const c = canvas.current!
    c.width = W * 2
    c.height = H * 2
  }, [])

  const draw = (e: PointerEvent): void => {
    const c = canvas.current!
    const g = c.getContext('2d')!
    c.setPointerCapture(e.pointerId)
    const r = c.getBoundingClientRect()
    const sx = c.width / r.width
    let last = { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sx, w: 0 }
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.strokeStyle = '#141414'
    const move = (ev: PointerEvent): void => {
      for (const p of ev.getCoalescedEvents?.() ?? [ev]) {
        const x = (p.clientX - r.left) * sx
        const y = (p.clientY - r.top) * sx
        // Pen pressure when available; otherwise thinner at speed, like ink.
        const speed = Math.hypot(x - last.x, y - last.y)
        const target = p.pressure > 0 && p.pointerType === 'pen' ? 1.5 + p.pressure * 6 : Math.max(2, 6 - speed * 0.15)
        const w = last.w ? last.w * 0.6 + target * 0.4 : target
        g.lineWidth = w
        g.beginPath()
        g.moveTo(last.x, last.y)
        g.lineTo(x, y)
        g.stroke()
        last = { x, y, w }
      }
      setEmpty(false)
    }
    const up = (): void => {
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerup', up)
    }
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerup', up)
  }

  const fromImage = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const img = new Image()
      img.onload = () => {
        inkFromPhoto(img, canvas.current!, img.naturalWidth, img.naturalHeight)
        setEmpty(false)
        URL.revokeObjectURL(img.src)
      }
      img.src = URL.createObjectURL(file)
    }
    input.click()
  }

  // Camera: hold a signature on white paper up to the webcam, like Preview.
  const video = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const stopCamera = (): void => {
    stream?.getTracks().forEach((t) => t.stop())
    setStream(null)
  }
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream])
  useEffect(() => {
    if (stream && video.current) video.current.srcObject = stream
  }, [stream])
  const startCamera = async (): Promise<void> => {
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }))
    } catch (e) {
      toast(`Camera unavailable: ${(e as Error).message || e}`, 'error')
    }
  }
  const capture = (): void => {
    const v = video.current
    if (!v || !v.videoWidth) return
    // Only the band inside the guide, where the signature is held.
    const bandH = Math.round(v.videoHeight * 0.45)
    const frame = document.createElement('canvas')
    frame.width = v.videoWidth
    frame.height = bandH
    frame.getContext('2d')!.drawImage(v, 0, (v.videoHeight - bandH) / 2, v.videoWidth, bandH, 0, 0, v.videoWidth, bandH)
    stopCamera()
    requestAnimationFrame(() => {
      inkFromPhoto(frame, canvas.current!)
      setEmpty(false)
    })
  }

  const clear = (): void => {
    const c = canvas.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }

  const save = async (): Promise<void> => {
    const png = exportTrimmed(canvas.current!)
    if (!png) return
    const sig = await saveSignature(name.trim() || 'Signature', png)
    activeSignature.value = sig
    setTool('signature')
    close()
    toast('Signature saved. Click on the page to place it.')
  }

  return (
    <Modal
      title="Create signature"
      wide
      onClose={close}
      footer={
        <>
          <button class="btn" onClick={close}>Cancel</button>
          <button class="btn primary" disabled={empty} onClick={() => void save()}>Save signature</button>
        </>
      }
    >
      <p class="muted">
        {stream
          ? 'Sign on white paper and hold it up to the camera so the signature sits on the line, then choose Capture.'
          : 'Sign with your mouse, touchpad or pen, use your camera, or import a photo of your signature on white paper.'}
      </p>
      <canvas ref={canvas} class="signature-pad" style={{ width: '100%', aspectRatio: `${W} / ${H}`, display: stream ? 'none' : undefined }} onPointerDown={draw} />
      {stream && (
        <div class="camera-frame">
          <video ref={video} autoPlay playsInline muted />
          <div class="camera-guide" aria-hidden="true" />
        </div>
      )}
      <div class="inline-actions">
        {stream ? (
          <>
            <button class="btn primary" onClick={capture}>Capture</button>
            <button class="btn" onClick={stopCamera}>Cancel camera</button>
          </>
        ) : (
          <>
            <button class="btn" onClick={clear}>Clear</button>
            <button class="btn" onClick={() => void startCamera()}>Camera</button>
            <button class="btn" onClick={fromImage}>Import from photo…</button>
          </>
        )}
        <label class="field grow">
          <span>Name</span>
          <input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
      </div>
    </Modal>
  )
}

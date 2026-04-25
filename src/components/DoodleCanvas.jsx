import { useCallback, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const CSS_W = 320
const CSS_H = 180

/**
 * @param {{ value: string; onChange: (dataUrl: string) => void; className?: string }} props
 */
export default function DoodleCanvas({ value, onChange, className }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const ctxRef = useRef(null)
  const skipValueSyncRef = useRef(false)

  const syncCanvasSize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(CSS_W * dpr)
    canvas.height = Math.floor(CSS_H * dpr)
    canvas.style.width = `${CSS_W}px`
    canvas.style.height = `${CSS_H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const root = document.documentElement
    const fg =
      window.getComputedStyle(root).getPropertyValue('--foreground').trim() || 'oklch(0.2 0 0)'
    const bg =
      window.getComputedStyle(root).getPropertyValue('--background').trim() || 'oklch(1 0 0)'
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    ctx.strokeStyle = fg
    ctxRef.current = ctx
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, CSS_W, CSS_H)
  }, [])

  useEffect(() => {
    syncCanvasSize()
  }, [syncCanvasSize])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    if (skipValueSyncRef.current) {
      skipValueSyncRef.current = false
      return
    }
    if (!value || !value.startsWith('data:image/png')) return
    const img = new window.Image()
    img.onload = () => {
      const root = document.documentElement
      const bg =
        window.getComputedStyle(root).getPropertyValue('--background').trim() || 'oklch(1 0 0)'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, CSS_W, CSS_H)
      ctx.drawImage(img, 0, 0, CSS_W, CSS_H)
    }
    img.src = value
  }, [value])

  function emitSnapshot() {
    const canvas = canvasRef.current
    if (!canvas) return
    skipValueSyncRef.current = true
    onChange(canvas.toDataURL('image/png'))
  }

  function pointerPos(e) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function onPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId)
    const ctx = ctxRef.current
    if (!ctx) return
    drawingRef.current = true
    const { x, y } = pointerPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function onPointerMove(e) {
    if (!drawingRef.current) return
    const ctx = ctxRef.current
    if (!ctx) return
    const { x, y } = pointerPos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  function onPointerUp(e) {
    if (!drawingRef.current) return
    drawingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    emitSnapshot()
  }

  function clear() {
    const ctx = ctxRef.current
    if (!ctx) return
    const root = document.documentElement
    const bg =
      window.getComputedStyle(root).getPropertyValue('--background').trim() || 'oklch(1 0 0)'
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, CSS_W, CSS_H)
    onChange('')
  }

  return (
    <div className={cn('grid gap-2', className)}>
      <canvas
        ref={canvasRef}
        className='touch-none cursor-crosshair rounded-md border border-border bg-background'
        width={CSS_W}
        height={CSS_H}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <Button type='button' variant='outline' size='sm' className='w-fit' onClick={clear}>
        Clear canvas
      </Button>
    </div>
  )
}

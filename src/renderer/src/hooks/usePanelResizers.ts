import { useCallback, useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  MAX_TIMELINE_HEIGHT,
  MIN_TIMELINE_HEIGHT,
  TIMELINE_HEIGHT_KEY,
  getInitialTimelineHeight
} from '../lib/app-helpers'

export function usePanelResizers() {
  const [timelineHeight, setTimelineHeight] = useState<number>(getInitialTimelineHeight)
  const [leftWidth, setLeftWidth] = useState<number>(276)
  const [rightWidth, setRightWidth] = useState<number>(316)

  useEffect(() => {
    try {
      window.localStorage.setItem(TIMELINE_HEIGHT_KEY, String(timelineHeight))
    } catch {
      // ignore storage errors
    }
  }, [timelineHeight])

  const startLeftResize = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = leftWidth
      const onMove = (ev: PointerEvent) => {
        const next = Math.max(220, Math.min(380, Math.round(startW + (ev.clientX - startX))))
        setLeftWidth(next)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [leftWidth]
  )

  const startRightResize = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = rightWidth
      const onMove = (ev: PointerEvent) => {
        const next = Math.max(260, Math.min(420, Math.round(startW + (startX - ev.clientX))))
        setRightWidth(next)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [rightWidth]
  )

  const startTimelineResize = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const startY = e.clientY
      const startH = timelineHeight
      const onMove = (ev: PointerEvent) => {
        const dy = startY - ev.clientY
        const next = Math.max(
          MIN_TIMELINE_HEIGHT,
          Math.min(MAX_TIMELINE_HEIGHT, Math.round(startH + dy))
        )
        setTimelineHeight(next)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [timelineHeight]
  )

  return {
    leftWidth,
    setLeftWidth,
    rightWidth,
    setRightWidth,
    timelineHeight,
    setTimelineHeight,
    startLeftResize,
    startRightResize,
    startTimelineResize
  }
}

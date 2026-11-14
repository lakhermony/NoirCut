import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clipAt,
  clipGainAt,
  isLaneAudible,
  projectEnd,
  type LaneMap,
  type TimelineClip
} from '../../../shared/timeline'
import type { MediaItem } from '../../../shared/types'

export function getPlayableUrl(m: MediaItem | undefined | null): string | null {
  if (!m) return null
  if (m.proxyState === 'ready' && m.proxyUrl) return m.proxyUrl
  return m.url
}

/**
 * Sade, doğrudan ve kilitsiz Timeline Oynatıcı (V1, A1, A2).
 */
export function usePlayer(clips: TimelineClip[], lanes: LaneMap, mediaItems: MediaItem[]) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioA1Ref = useRef<HTMLAudioElement | null>(null)
  const audioA2Ref = useRef<HTMLAudioElement | null>(null)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const timeRef = useRef(0)
  timeRef.current = time
  const playingRef = useRef(false)
  playingRef.current = playing
  const scrubbingRef = useRef(false)
  const wasPlayingRef = useRef(false)
  const anchorWallRef = useRef(0)
  const anchorTimeRef = useRef(0)

  const mediaMap = useMemo(() => {
    const map = new Map<string, MediaItem>()
    for (const m of mediaItems) map.set(m.id, m)
    return map
  }, [mediaItems])

  const total = useMemo(() => projectEnd(clips), [clips])

  const activeVClip = useMemo(() => clipAt(clips, 'V1', time), [clips, time])
  const fallbackVClip = useMemo(
    () => clips.find((c) => c.lane === 'V1') ?? clips[0] ?? null,
    [clips]
  )
  const currentMedia = useMemo(() => {
    const c = activeVClip ?? fallbackVClip
    return c ? (mediaMap.get(c.mediaId) ?? null) : null
  }, [activeVClip, fallbackVClip, mediaMap])

  const videoSrc = getPlayableUrl(currentMedia)

  const syncElement = useCallback(
    (
      el: HTMLMediaElement | null,
      clip: TimelineClip | undefined,
      laneAudible: boolean,
      t: number,
      isPlaying: boolean,
      forceSeek = false
    ) => {
      if (!el) return
      if (!clip) {
        if (!el.paused) el.pause()
        el.muted = true
        el.volume = 0
        el.dataset.effectiveGain = '0'
        el.dataset.clipId = ''
        return
      }

      const m = mediaMap.get(clip.mediaId)
      const targetUrl = getPlayableUrl(m)
      if (targetUrl && el.getAttribute('src') !== targetUrl) {
        el.setAttribute('src', targetUrl)
        el.load()
      }

      const local = Math.max(0, Math.min(clip.duration, t - clip.start))
      const targetSourceTime = local + clip.in
      const drift = Math.abs(el.currentTime - targetSourceTime)

      if (forceSeek || drift > (isPlaying ? 0.35 : 0.02)) {
        try {
          el.currentTime = targetSourceTime
        } catch {
          // metadata henüz hazır değilse yoksay
        }
      }

      const embeddedMuted = clip.lane === 'V1' && clip.audioDetached
      const effectiveGain =
        !embeddedMuted && laneAudible && (m?.hasAudio ?? true) ? clipGainAt(clip, local) : 0

      el.muted = effectiveGain <= 0.0001
      el.volume = Math.max(0, Math.min(1, effectiveGain))
      el.dataset.effectiveGain = effectiveGain.toFixed(4)
      el.dataset.clipId = clip.id

      if (isPlaying) {
        if (el.paused) {
          el.play().catch(() => {})
        }
      } else if (!el.paused) {
        el.pause()
      }
    },
    [mediaMap]
  )

  const syncAllAt = useCallback(
    (t: number, isPlaying: boolean, forceSeek = false) => {
      const vClip = clipAt(clips, 'V1', t)
      const a1Clip = clipAt(clips, 'A1', t)
      const a2Clip = clipAt(clips, 'A2', t)

      syncElement(videoRef.current, vClip, isLaneAudible(lanes, 'V1'), t, isPlaying, forceSeek)
      syncElement(audioA1Ref.current, a1Clip, isLaneAudible(lanes, 'A1'), t, isPlaying, forceSeek)
      syncElement(audioA2Ref.current, a2Clip, isLaneAudible(lanes, 'A2'), t, isPlaying, forceSeek)
    },
    [clips, lanes, syncElement]
  )

  useEffect(() => {
    syncAllAt(timeRef.current, playing)
  }, [clips, lanes, playing, syncAllAt])

  // Doğrudan oynatma döngüsü
  useEffect(() => {
    if (!playing) return
    anchorWallRef.current = performance.now()
    anchorTimeRef.current = timeRef.current
    let raf = 0

    const tick = (now: number) => {
      if (scrubbingRef.current) {
        anchorWallRef.current = now
        anchorTimeRef.current = timeRef.current
        raf = requestAnimationFrame(tick)
        return
      }

      const nextT = anchorTimeRef.current + (now - anchorWallRef.current) / 1000

      if (total <= 0 || nextT >= total) {
        timeRef.current = total
        anchorTimeRef.current = total
        setTime(total)
        playingRef.current = false
        setPlaying(false)
        syncAllAt(total, false)
        return
      }

      timeRef.current = nextT
      setTime(nextT)
      syncAllAt(nextT, true)
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, total, syncAllAt])

  const toggle = useCallback(() => {
    if (total <= 0) return
    setError(null)
    const next = !playingRef.current
    playingRef.current = next
    setPlaying(next)

    if (next && timeRef.current >= total - 0.05) {
      timeRef.current = 0
      anchorTimeRef.current = 0
      anchorWallRef.current = performance.now()
      setTime(0)
      syncAllAt(0, true, true)
    } else {
      anchorTimeRef.current = timeRef.current
      anchorWallRef.current = performance.now()
      syncAllAt(timeRef.current, next)
    }
  }, [total, syncAllAt])

  const beginScrub = useCallback(() => {
    if (scrubbingRef.current) return
    wasPlayingRef.current = playingRef.current
    scrubbingRef.current = true
    if (wasPlayingRef.current) {
      playingRef.current = false
      setPlaying(false)
      syncAllAt(timeRef.current, false)
    }
  }, [syncAllAt])

  const endScrub = useCallback(() => {
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    anchorTimeRef.current = timeRef.current
    anchorWallRef.current = performance.now()
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false
      playingRef.current = true
      setPlaying(true)
      syncAllAt(timeRef.current, true)
    }
  }, [syncAllAt])

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(total, t))
      timeRef.current = clamped
      anchorTimeRef.current = clamped
      anchorWallRef.current = performance.now()
      setTime(clamped)
      syncAllAt(clamped, scrubbingRef.current ? false : playingRef.current, true)
    },
    [total, syncAllAt]
  )

  const videoProps: React.VideoHTMLAttributes<HTMLVideoElement> = {
    onLoadedMetadata: () => {
      syncAllAt(timeRef.current, playingRef.current, true)
    },
    onError: () => {
      if (currentMedia?.proxyState === 'building') {
        setError('Proxy hazırlanıyor, tamamlandığında otomatik oynatılacak…')
      } else {
        setError('Bu video oynatılamadı. Codec desteklenmiyor olabilir.')
      }
    }
  }

  useEffect(() => {
    if (currentMedia?.proxyState === 'ready') {
      setError(null)
    }
  }, [currentMedia?.proxyState])

  return {
    videoRef,
    audioA1Ref,
    audioA2Ref,
    videoProps,
    videoSrc,
    currentMedia,
    hasActiveVideoClip: Boolean(activeVClip),
    playing,
    time,
    duration: total,
    error,
    toggle,
    seek,
    beginScrub,
    endScrub
  }
}

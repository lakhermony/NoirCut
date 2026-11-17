import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clipAt,
  clipGainAt,
  computeAutoDuckMultiplierAt,
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
export function usePlayer(
  clips: TimelineClip[],
  lanes: LaneMap,
  mediaItems: MediaItem[],
  autoDucking = false
) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioA1Ref = useRef<HTMLAudioElement | null>(null)
  const audioA2Ref = useRef<HTMLAudioElement | null>(null)

  const [playing, setPlaying] = useState(false)
  const [shuttleRate, setShuttleRate] = useState<number>(0)
  const [time, setTime] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const timeRef = useRef(0)
  timeRef.current = time
  const playingRef = useRef(false)
  playingRef.current = playing
  const shuttleRateRef = useRef(0)
  shuttleRateRef.current = shuttleRate
  const scrubbingRef = useRef(false)
  const wasPlayingRef = useRef(false)
  const anchorWallRef = useRef(0)
  const anchorTimeRef = useRef(0)
  const seekQueueRef = useRef(
    new WeakMap<HTMLMediaElement, { pending: number | null; listenerAttached: boolean }>()
  )

  const scheduleSeek = useCallback((el: HTMLMediaElement, targetTime: number) => {
    const clamped = Math.max(
      0,
      Number.isFinite(el.duration) && el.duration > 0 ? Math.min(el.duration - 0.001, targetTime) : targetTime
    )
    if (!Number.isFinite(clamped)) return

    let entry = seekQueueRef.current.get(el)
    if (!entry) {
      entry = { pending: null, listenerAttached: false }
      seekQueueRef.current.set(el, entry)
    }

    if (!entry.listenerAttached) {
      entry.listenerAttached = true
      const flushPending = () => {
        const cur = seekQueueRef.current.get(el)
        if (!cur || cur.pending === null || el.readyState < 1) return
        const nextTarget = cur.pending
        cur.pending = null
        if (Math.abs(el.currentTime - nextTarget) > 0.015) {
          try {
            el.currentTime = nextTarget
          } catch {
            // yoksay
          }
        }
      }
      el.addEventListener('seeked', flushPending)
      el.addEventListener('loadedmetadata', flushPending)
    }

    if (el.readyState < 1 || el.seeking) {
      entry.pending = clamped
      return
    }

    entry.pending = null
    try {
      el.currentTime = clamped
    } catch {
      // metadata henüz hazır değilse yoksay
    }
  }, [])

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
      if (el === videoRef.current && (m?.mediaKind === 'image' || m?.mediaKind === 'audio')) {
        if (!el.paused) el.pause()
        el.muted = true
        el.volume = 0
        el.dataset.effectiveGain = '0'
        el.dataset.clipId = clip.id
        return
      }
      const targetUrl = getPlayableUrl(m)
      if (targetUrl && el.getAttribute('src') !== targetUrl) {
        el.setAttribute('src', targetUrl)
        el.load()
      }

      const local = Math.max(0, Math.min(clip.duration, t - clip.start))
      const speedFactor = Math.max(0.25, Math.min(4.0, (clip.speed ?? 100) / 100))
      const activeShuttle = isPlaying ? (shuttleRateRef.current || 1) : 1
      const isReverseShuttle = isPlaying && activeShuttle < 0
      const effectiveRate = Math.max(0.25, Math.min(8.0, speedFactor * Math.abs(activeShuttle)))

      try {
        if (!isReverseShuttle && Math.abs(el.playbackRate - effectiveRate) > 0.01) {
          el.playbackRate = effectiveRate
        }
      } catch {
        // yoksay
      }

      const targetSourceTime = clip.reverse
        ? Math.max(0, clip.in + Math.max(0, clip.duration - local) * speedFactor)
        : clip.in + local * speedFactor
      const drift = Math.abs(el.currentTime - targetSourceTime)

      const needSeek =
        forceSeek ||
        clip.reverse ||
        isReverseShuttle ||
        (isPlaying
          ? drift > Math.max(0.45, 0.45 * effectiveRate)
          : !scrubbingRef.current && el === videoRef.current
            ? drift > 0.25
            : drift > 0.04)

      if (needSeek) {
        if (!isReverseShuttle || drift > 0.025 || forceSeek) {
          scheduleSeek(el, targetSourceTime)
        }
      }

      const embeddedMuted = clip.lane === 'V1' && clip.audioDetached
      const duckMult =
        clip.lane === 'A2' && autoDucking
          ? computeAutoDuckMultiplierAt(clips, lanes, t, autoDucking)
          : 1
      const effectiveGain =
        !embeddedMuted && laneAudible && (m?.hasAudio ?? true)
          ? clipGainAt(clip, local) * duckMult
          : 0

      el.muted = effectiveGain <= 0.0001 || isReverseShuttle
      el.volume = Math.max(0, Math.min(1, effectiveGain))
      el.dataset.effectiveGain = effectiveGain.toFixed(4)
      el.dataset.clipId = clip.id

      if (isPlaying && !isReverseShuttle) {
        if (el.paused) {
          el.play().catch(() => {})
        }
      } else if (!el.paused) {
        el.pause()
      }
    },
    [autoDucking, clips, lanes, mediaMap, scheduleSeek]
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
  }, [clips, lanes, playing, shuttleRate, syncAllAt])

  // Doğrudan oynatma döngüsü (J/K/L shuttle hız çarpanı destekli)
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

      const rate = shuttleRateRef.current || 1
      let nextT = anchorTimeRef.current + ((now - anchorWallRef.current) / 1000) * rate

      // Normal ileri oynatmada V1 video saatini ana referans kabul et (duraklatmada kare atlaması önlenir)
      const vEl = videoRef.current
      const curVClip = rate > 0 ? clipAt(clips, 'V1', timeRef.current) : undefined
      if (
        rate > 0 &&
        curVClip &&
        !curVClip.reverse &&
        vEl &&
        !vEl.paused &&
        !vEl.seeking &&
        vEl.readyState >= 2
      ) {
        const vm = mediaMap.get(curVClip.mediaId)
        if (vm?.mediaKind !== 'image' && vm?.mediaKind !== 'audio') {
          const spd = Math.max(0.25, Math.min(4.0, (curVClip.speed ?? 100) / 100))
          const videoBasedT = curVClip.start + (vEl.currentTime - curVClip.in) / spd
          if (
            Number.isFinite(videoBasedT) &&
            videoBasedT >= curVClip.start - 0.05 &&
            videoBasedT <= curVClip.start + curVClip.duration + 0.05 &&
            Math.abs(videoBasedT - nextT) < 0.35
          ) {
            nextT = Math.max(0, videoBasedT)
            anchorTimeRef.current = nextT
            anchorWallRef.current = now
          }
        }
      }

      if (rate > 0 && (total <= 0 || nextT >= total)) {
        timeRef.current = total
        anchorTimeRef.current = total
        setTime(total)
        playingRef.current = false
        shuttleRateRef.current = 0
        setPlaying(false)
        setShuttleRate(0)
        syncAllAt(total, false)
        return
      }

      if (rate < 0 && nextT <= 0) {
        timeRef.current = 0
        anchorTimeRef.current = 0
        setTime(0)
        playingRef.current = false
        shuttleRateRef.current = 0
        setPlaying(false)
        setShuttleRate(0)
        syncAllAt(0, false, true)
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

  const snapPlayheadToCurrentVideoFrame = useCallback(() => {
    const curVClip = clipAt(clips, 'V1', timeRef.current)
    const vEl = videoRef.current
    if (curVClip && !curVClip.reverse && vEl && vEl.readyState >= 2) {
      const vm = mediaMap.get(curVClip.mediaId)
      if (vm?.mediaKind !== 'image' && vm?.mediaKind !== 'audio') {
        const spd = Math.max(0.25, Math.min(4.0, (curVClip.speed ?? 100) / 100))
        const exactT = Math.max(
          curVClip.start,
          Math.min(
            curVClip.start + curVClip.duration,
            curVClip.start + (vEl.currentTime - curVClip.in) / spd
          )
        )
        if (Number.isFinite(exactT)) {
          timeRef.current = exactT
          setTime(exactT)
        }
      }
    }
  }, [clips, mediaMap])

  const toggle = useCallback(() => {
    if (total <= 0) return
    setError(null)
    const next = !playingRef.current
    playingRef.current = next
    const nextRate = next ? 1 : 0
    shuttleRateRef.current = nextRate
    setPlaying(next)
    setShuttleRate(nextRate)

    if (next && timeRef.current >= total - 0.05) {
      timeRef.current = 0
      anchorTimeRef.current = 0
      anchorWallRef.current = performance.now()
      setTime(0)
      syncAllAt(0, true, true)
    } else if (!next) {
      snapPlayheadToCurrentVideoFrame()
      anchorTimeRef.current = timeRef.current
      anchorWallRef.current = performance.now()
      syncAllAt(timeRef.current, false)
    } else {
      anchorTimeRef.current = timeRef.current
      anchorWallRef.current = performance.now()
      syncAllAt(timeRef.current, true)
    }
  }, [snapPlayheadToCurrentVideoFrame, total, syncAllAt])

  /** NLE J Kısayolu: Geri sarma (-1x, tekrar basınca -2x) */
  const shuttleReverse = useCallback((): number => {
    if (total <= 0) return 0
    setError(null)
    const curRate = playingRef.current ? shuttleRateRef.current : 0
    const nextRate = curRate >= 0 ? -1 : -2
    if (timeRef.current <= 0.05) {
      timeRef.current = total
      setTime(total)
    }
    anchorTimeRef.current = timeRef.current
    anchorWallRef.current = performance.now()
    shuttleRateRef.current = nextRate
    playingRef.current = true
    setShuttleRate(nextRate)
    setPlaying(true)
    syncAllAt(timeRef.current, true, true)
    return nextRate
  }, [total, syncAllAt])

  /** NLE K Kısayolu: Durdurma (Pause) */
  const shuttlePause = useCallback(() => {
    playingRef.current = false
    shuttleRateRef.current = 0
    snapPlayheadToCurrentVideoFrame()
    anchorTimeRef.current = timeRef.current
    anchorWallRef.current = performance.now()
    setPlaying(false)
    setShuttleRate(0)
    syncAllAt(timeRef.current, false)
  }, [snapPlayheadToCurrentVideoFrame, syncAllAt])

  /** NLE L Kısayolu: İleri oynatma (1x, tekrar basınca 2x, 4x) */
  const shuttleForward = useCallback((): number => {
    if (total <= 0) return 0
    setError(null)
    const curRate = playingRef.current ? shuttleRateRef.current : 0
    const nextRate = curRate <= 0 ? 1 : curRate === 1 ? 2 : 4
    if (timeRef.current >= total - 0.05) {
      timeRef.current = 0
      setTime(0)
    }
    anchorTimeRef.current = timeRef.current
    anchorWallRef.current = performance.now()
    shuttleRateRef.current = nextRate
    playingRef.current = true
    setShuttleRate(nextRate)
    setPlaying(true)
    syncAllAt(timeRef.current, true, curRate <= 0)
    return nextRate
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
      syncAllAt(timeRef.current, true, true)
    } else {
      syncAllAt(timeRef.current, false, true)
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
    shuttleRate,
    time,
    duration: total,
    error,
    toggle,
    shuttleReverse,
    shuttlePause,
    shuttleForward,
    seek,
    beginScrub,
    endScrub
  }
}

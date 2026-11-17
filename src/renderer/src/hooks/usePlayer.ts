import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clipAt,
  clipGainAt,
  computeAutoDuckMultiplierAt,
  getOrderedAudioLanes,
  getOrderedVideoLanesAsc,
  isAudioLane,
  isCreditClip,
  isLaneAudible,
  isVideoLane,
  projectEnd,
  type LaneId,
  type LaneMap,
  type TimelineClip
} from '../../../shared/timeline'
import type { MediaItem } from '../../../shared/types'

export function getPlayableUrl(m: MediaItem | undefined | null): string | null {
  if (!m) return null
  if (m.proxyState === 'ready' && m.proxyUrl) return m.proxyUrl
  return m.url
}

export interface OverlayVisualLayer {
  clip: TimelineClip
  media: MediaItem
}

/**
 * Çok kanallı Timeline Oynatıcı (V1..Vn, A1..An).
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
  const extraAudioElsRef = useRef<Map<LaneId, HTMLAudioElement>>(new Map())
  const overlayVideoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map())

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

  const orderedVideoLanesAsc = useMemo(
    () => getOrderedVideoLanesAsc(lanes, clips),
    [lanes, clips]
  )
  const orderedAudioLanes = useMemo(
    () => getOrderedAudioLanes(lanes, clips),
    [lanes, clips]
  )

  const getVisualStackAt = useCallback(
    (t: number): TimelineClip[] => {
      const stack: TimelineClip[] = []
      for (const laneId of orderedVideoLanesAsc) {
        if (!isLaneAudible(lanes, laneId)) continue
        const c = clipAt(clips, laneId, t)
        if (c && !isCreditClip(c)) {
          stack.push(c)
        }
      }
      return stack
    },
    [clips, lanes, orderedVideoLanesAsc]
  )

  const total = useMemo(() => projectEnd(clips), [clips])

  const activeVisualStack = useMemo(() => getVisualStackAt(time), [getVisualStackAt, time])
  const activeVClip = activeVisualStack[0]
  const overlayVisualClips = useMemo<OverlayVisualLayer[]>(() => {
    const out: OverlayVisualLayer[] = []
    for (let i = 1; i < activeVisualStack.length; i++) {
      const c = activeVisualStack[i]
      const m = mediaMap.get(c.mediaId)
      if (m && m.mediaKind !== 'audio') {
        out.push({ clip: c, media: m })
      }
    }
    return out
  }, [activeVisualStack, mediaMap])

  const fallbackVClip = useMemo(() => {
    for (const laneId of orderedVideoLanesAsc) {
      const found = clips.find((c) => c.lane === laneId && !isCreditClip(c))
      if (found) return found
    }
    return clips.find((c) => !isCreditClip(c)) ?? clips[0] ?? null
  }, [clips, orderedVideoLanesAsc])
  const currentMedia = useMemo(() => {
    const c = activeVClip ?? fallbackVClip
    return c ? (mediaMap.get(c.mediaId) ?? null) : null
  }, [activeVClip, fallbackVClip, mediaMap])

  const videoSrc = getPlayableUrl(currentMedia)

  const registerAudioEl = useCallback((laneId: LaneId, el: HTMLAudioElement | null) => {
    if (laneId === 'A1') audioA1Ref.current = el
    else if (laneId === 'A2') audioA2Ref.current = el
    if (el) {
      extraAudioElsRef.current.set(laneId, el)
    } else {
      extraAudioElsRef.current.delete(laneId)
    }
  }, [])

  const registerOverlayVideoEl = useCallback((clipId: string, el: HTMLVideoElement | null) => {
    if (el) {
      overlayVideoElsRef.current.set(clipId, el)
    } else {
      overlayVideoElsRef.current.delete(clipId)
    }
  }, [])

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
          : !scrubbingRef.current && el.tagName === 'VIDEO'
            ? drift > 0.25
            : drift > 0.04)

      if (needSeek) {
        if (!isReverseShuttle || drift > 0.025 || forceSeek) {
          scheduleSeek(el, targetSourceTime)
        }
      }

      const embeddedMuted = isVideoLane(clip.lane) && clip.audioDetached
      const duckMult =
        isAudioLane(clip.lane) && clip.lane !== 'A1' && autoDucking
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
      const stack = getVisualStackAt(t)
      const baseVClip = stack[0]
      syncElement(
        videoRef.current,
        baseVClip,
        baseVClip ? isLaneAudible(lanes, baseVClip.lane) : true,
        t,
        isPlaying,
        forceSeek
      )

      const activeOverlayIds = new Set<string>()
      for (let i = 1; i < stack.length; i++) {
        const oc = stack[i]
        activeOverlayIds.add(oc.id)
        const ovEl = overlayVideoElsRef.current.get(oc.id) ?? null
        if (ovEl) {
          syncElement(ovEl, oc, isLaneAudible(lanes, oc.lane), t, isPlaying, forceSeek)
        }
      }
      for (const [cid, ovEl] of overlayVideoElsRef.current.entries()) {
        if (!activeOverlayIds.has(cid)) {
          syncElement(ovEl, undefined, false, t, false, false)
        }
      }

      for (const aLane of orderedAudioLanes) {
        const aClip = clipAt(clips, aLane, t)
        const aEl =
          extraAudioElsRef.current.get(aLane) ??
          (aLane === 'A1' ? audioA1Ref.current : aLane === 'A2' ? audioA2Ref.current : null)
        if (aEl) {
          syncElement(aEl, aClip, isLaneAudible(lanes, aLane), t, isPlaying, forceSeek)
        }
      }
    },
    [clips, getVisualStackAt, lanes, orderedAudioLanes, syncElement]
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

      // Normal ileri oynatmada alt video saatini ana referans kabul et (duraklatmada kare atlaması önlenir)
      const vEl = videoRef.current
      const curVClip = rate > 0 ? getVisualStackAt(timeRef.current)[0] : undefined
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
    const curVClip = getVisualStackAt(timeRef.current)[0]
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
  }, [getVisualStackAt, mediaMap])

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
    orderedAudioLanes,
    overlayVisualClips,
    registerAudioEl,
    registerOverlayVideoEl,
    videoProps,
    videoSrc,
    currentMedia,
    activePrimaryClip: activeVClip ?? null,
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

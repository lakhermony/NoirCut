import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GAPLESS_PRELOAD_SECONDS,
  clipAt,
  clipGainAt,
  clipSourceTimeAt,
  computeAutoDuckMultiplierAt,
  dbToGain,
  findNextBaseClip,
  getOrderedAudioLanes,
  getOrderedVideoLanesAsc,
  isAudioLane,
  isCreditClip,
  isLaneAudible,
  isSeamlessContinuation,
  isVideoLane,
  projectEnd,
  type LaneId,
  type LaneMap,
  type TimelineClip
} from '../../../shared/timeline'
import type { MediaItem } from '../../../shared/types'
import type { ProxyPlaybackMode } from '../types'

export function getPlayableUrl(
  m: MediaItem | undefined | null,
  mode: ProxyPlaybackMode = 'auto'
): string | null {
  if (!m) return null
  if (mode === 'original') return m.url
  if (m.proxyState === 'ready' && m.proxyUrl) return m.proxyUrl
  return m.url
}

export interface OverlayVisualLayer {
  clip: TimelineClip
  media: MediaItem
}

/** Program monitörü çift tamponu: biri ekranda (aktif), diğeri sıradaki klibi önceden yükler. */
export type VideoSlot = 'A' | 'B'
const otherSlot = (s: VideoSlot): VideoSlot => (s === 'A' ? 'B' : 'A')

/**
 * Çok kanallı Timeline Oynatıcı (V1..Vn, A1..An).
 *
 * Kesintisiz (gapless) geçiş: taban video iki <video> tamponu (A/B) ile çalışır.
 * Playhead bir sonraki klibe `GAPLESS_PRELOAD_SECONDS` kala, sıradaki klibin kaynağı ve giriş karesi
 * gizli tamponda hazırlanır; geçiş anında `videoRef.current` hazır tampona çevrilir (siyah kare yok).
 */
export function usePlayer(
  clips: TimelineClip[],
  lanes: LaneMap,
  mediaItems: MediaItem[],
  autoDucking = false,
  proxyPlaybackMode: ProxyPlaybackMode = 'auto',
  masterGainDb = 0
) {
  /** Her zaman EKRANDAKİ (aktif) tamponu gösterir; WebGL2 motoru ve skoplar bunu okur. */
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const slotElsRef = useRef<Record<VideoSlot, HTMLVideoElement | null>>({ A: null, B: null })
  const activeSlotRef = useRef<VideoSlot>('A')
  const swapPendingRef = useRef(false)
  const warmedImagesRef = useRef<Set<string>>(new Set())
  const syncAllAtRef = useRef<(t: number, isPlaying: boolean, forceSeek?: boolean) => void>(
    () => undefined
  )
  const audioA1Ref = useRef<HTMLAudioElement | null>(null)
  const audioA2Ref = useRef<HTMLAudioElement | null>(null)
  const extraAudioElsRef = useRef<Map<LaneId, HTMLAudioElement>>(new Map())
  const overlayVideoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map())

  const [playing, setPlaying] = useState(false)
  const [shuttleRate, setShuttleRate] = useState<number>(0)
  const [time, setTime] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const timeRef = useRef(0)
  const playingRef = useRef(false)
  playingRef.current = playing
  const shuttleRateRef = useRef(0)
  shuttleRateRef.current = shuttleRate
  const scrubbingRef = useRef(false)
  const wasPlayingRef = useRef(false)
  const anchorWallRef = useRef(0)
  const anchorTimeRef = useRef(0)
  const lastCommittedPrimaryIdRef = useRef<string | null>(null)
  const lastCommittedOverlayKeyRef = useRef<string>('')
  const lastCommittedCreditIdRef = useRef<string | null>(null)
  const timeListenersRef = useRef<Set<(t: number) => void>>(new Set())

  const notifyTimeListeners = useCallback((t: number) => {
    for (const cb of timeListenersRef.current) {
      try {
        cb(t)
      } catch {
        // yoksay
      }
    }
  }, [])

  const subscribeTime = useCallback((cb: (t: number) => void): (() => void) => {
    timeListenersRef.current.add(cb)
    return () => {
      timeListenersRef.current.delete(cb)
    }
  }, [])
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

  const videoSrc = getPlayableUrl(currentMedia, proxyPlaybackMode)

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

  /** Aktif tamponu görünür (opacity 1), diğerini gizli (opacity 0) yapar ve `videoRef`'i aktife bağlar. */
  const applyActiveSlotStyles = useCallback(() => {
    const act = activeSlotRef.current
    for (const s of ['A', 'B'] as const) {
      const el = slotElsRef.current[s]
      if (!el) continue
      el.style.opacity = s === act ? '1' : '0'
      el.style.zIndex = s === act ? '2' : '1'
    }
    videoRef.current = slotElsRef.current[act]
  }, [])

  /** Monitor, iki <video> tamponunu (A/B) buraya kaydeder (EDIT ve GRADE monitörleri aynı mantığı paylaşır). */
  const registerVideoBufferEl = useCallback(
    (slot: VideoSlot, el: HTMLVideoElement | null) => {
      const prev = slotElsRef.current[slot]
      slotElsRef.current[slot] = el
      applyActiveSlotStyles()
      if (el && el !== prev) {
        el.preload = 'auto'
        // Yeni (örn. sekme değişiminde yeniden oluşan) elemente kaynağı hemen yükle
        queueMicrotask(() => syncAllAtRef.current(timeRef.current, playingRef.current, true))
      }
    },
    [applyActiveSlotStyles]
  )

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
      if (el.tagName === 'VIDEO' && (m?.mediaKind === 'image' || m?.mediaKind === 'audio')) {
        if (!el.paused) el.pause()
        el.muted = true
        el.volume = 0
        el.dataset.effectiveGain = '0'
        el.dataset.clipId = clip.id
        el.dataset.preloadClipId = ''
        return
      }
      const targetUrl = getPlayableUrl(m, proxyPlaybackMode)
      let srcChanged = false
      if (targetUrl && el.getAttribute('src') !== targetUrl) {
        el.setAttribute('src', targetUrl)
        el.load()
        srcChanged = true
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
        srcChanged ||
        (!isPlaying &&
          (clip.reverse ||
            (!scrubbingRef.current && el.tagName === 'VIDEO' ? drift > 0.25 : drift > 0.04))) ||
        (isPlaying && (clip.reverse || isReverseShuttle))

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
      const masterMult = dbToGain(masterGainDb)
      const effectiveGain =
        !embeddedMuted && laneAudible && (m?.hasAudio ?? true)
          ? clipGainAt(clip, local) * duckMult * masterMult
          : 0

      el.muted = effectiveGain <= 0.0001 || isReverseShuttle
      el.volume = Math.max(0, Math.min(1, effectiveGain))
      el.dataset.effectiveGain = effectiveGain.toFixed(4)
      el.dataset.clipId = clip.id
      el.dataset.preloadClipId = ''

      if (isPlaying && !isReverseShuttle) {
        if (el.paused) {
          el.play().catch(() => {})
        }
      } else if (!el.paused) {
        el.pause()
      }
    },
    [autoDucking, clips, lanes, masterGainDb, mediaMap, proxyPlaybackMode, scheduleSeek]
  )

  const preloadStandbyVideo = useCallback(
    (standbyEl: HTMLVideoElement | null, curClip: TimelineClip | undefined, t: number) => {
      if (!standbyEl) return
      const upcoming = findNextBaseClip(
        clips,
        (qt) => getVisualStackAt(qt)[0],
        t,
        GAPLESS_PRELOAD_SECONDS
      )
      if (!upcoming) {
        if (!standbyEl.paused) standbyEl.pause()
        standbyEl.muted = true
        standbyEl.volume = 0
        return
      }
      const nextClip = upcoming.clip
      if (curClip && isSeamlessContinuation(curClip, nextClip)) {
        // Aynı dosyanın kesintisiz devamı (Razor kesiği): aktif tampon kesintisiz devam edecek
        if (!standbyEl.paused) standbyEl.pause()
        standbyEl.muted = true
        return
      }

      const m = mediaMap.get(nextClip.mediaId)
      const targetUrl = getPlayableUrl(m, proxyPlaybackMode)
      if (!m || !targetUrl) return

      if (m.mediaKind === 'image') {
        if (!warmedImagesRef.current.has(targetUrl)) {
          warmedImagesRef.current.add(targetUrl)
          const img = new Image()
          img.src = targetUrl
        }
        return
      }
      if (m.mediaKind === 'audio') return

      standbyEl.muted = true
      standbyEl.volume = 0
      standbyEl.preload = 'auto'
      if (!standbyEl.paused) standbyEl.pause()

      if (standbyEl.getAttribute('src') !== targetUrl) {
        standbyEl.setAttribute('src', targetUrl)
        standbyEl.dataset.preloadClipId = nextClip.id
        standbyEl.dataset.clipId = ''
        standbyEl.load()
      }

      const targetIn = clipSourceTimeAt(nextClip, upcoming.at)
      const spd = Math.max(0.25, Math.min(4.0, (nextClip.speed ?? 100) / 100))
      try {
        if (Math.abs(standbyEl.playbackRate - spd) > 0.01) {
          standbyEl.playbackRate = spd
        }
      } catch {
        // yoksay
      }

      const alreadyParked =
        standbyEl.dataset.preloadClipId === nextClip.id &&
        Math.abs(standbyEl.currentTime - targetIn) <= 0.03
      if (!alreadyParked) {
        standbyEl.dataset.preloadClipId = nextClip.id
        scheduleSeek(standbyEl, targetIn)
      }
    },
    [clips, getVisualStackAt, mediaMap, proxyPlaybackMode, scheduleSeek]
  )

  const syncAllAt = useCallback(
    (t: number, isPlaying: boolean, forceSeek = false) => {
      const stack = getVisualStackAt(t)
      const baseVClip = stack[0] ?? fallbackVClip ?? undefined

      const curSlot = activeSlotRef.current
      const stbySlot = otherSlot(curSlot)
      let activeEl = slotElsRef.current[curSlot] ?? videoRef.current
      let standbyEl = slotElsRef.current[stbySlot]

      // Sıradaki klibe geçildiyse ve yedek tamponda bu klip önceden hazırlanmışsa anında tampon değiştir
      if (
        baseVClip &&
        standbyEl &&
        activeEl &&
        activeEl.dataset.clipId !== baseVClip.id &&
        (standbyEl.dataset.preloadClipId === baseVClip.id ||
          standbyEl.dataset.clipId === baseVClip.id)
      ) {
        if (!activeEl.paused) activeEl.pause()
        activeEl.muted = true
        activeEl.volume = 0
        activeEl.dataset.effectiveGain = '0'
        activeEl.dataset.clipId = ''

        activeSlotRef.current = stbySlot
        swapPendingRef.current = true
        applyActiveSlotStyles()
        activeEl = standbyEl
        standbyEl = slotElsRef.current[curSlot]
      } else {
        videoRef.current = activeEl
      }

      const justSwapped = swapPendingRef.current
      swapPendingRef.current = false
      const prevClipId = activeEl?.dataset.clipId ?? ''
      const curClipId = stack[0]?.id ?? ''
      const clipChangedNotSeamless =
        Boolean(stack[0]) &&
        prevClipId !== '' &&
        prevClipId !== curClipId &&
        !justSwapped

      syncElement(
        activeEl,
        stack[0],
        stack[0] ? isLaneAudible(lanes, stack[0].lane) : true,
        t,
        isPlaying,
        (forceSeek && !justSwapped) || clipChangedNotSeamless
      )

      // Aktif klip yoksa ancak fallback klip varsa ilk karesini sessizce hazır tut
      if (!stack[0] && baseVClip && activeEl) {
        syncElement(activeEl, baseVClip, false, baseVClip.start, false, false)
      }

      // 1.5 sn önceden bir sonraki taban klibini yedek tamponda hazırla
      preloadStandbyVideo(standbyEl, stack[0], t)

      const activeOverlayIds = new Set<string>()
      for (let i = 1; i < stack.length; i++) {
        const oc = stack[i]
        activeOverlayIds.add(oc.id)
        const ovEl = overlayVideoElsRef.current.get(oc.id) ?? null
        if (ovEl) {
          const ovEntering = ovEl.dataset.clipId !== oc.id
          syncElement(
            ovEl,
            oc,
            isLaneAudible(lanes, oc.lane),
            t,
            isPlaying,
            forceSeek || ovEntering
          )
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
          const aEntering = Boolean(aClip) && aEl.dataset.clipId !== aClip!.id
          syncElement(
            aEl,
            aClip,
            isLaneAudible(lanes, aLane),
            t,
            isPlaying,
            forceSeek || aEntering
          )
        }
      }
    },
    [
      applyActiveSlotStyles,
      clips,
      fallbackVClip,
      getVisualStackAt,
      lanes,
      orderedAudioLanes,
      preloadStandbyVideo,
      syncElement
    ]
  )
  syncAllAtRef.current = syncAllAt

  const prevPlayingForEffectRef = useRef(false)
  const prevShuttleForEffectRef = useRef(0)
  useEffect(() => {
    const playStateChanged =
      prevPlayingForEffectRef.current !== playing ||
      prevShuttleForEffectRef.current !== shuttleRate
    prevPlayingForEffectRef.current = playing
    prevShuttleForEffectRef.current = shuttleRate
    // Oynatma zaten devam ediyorsa useEffect içinden tekrar seek/play tetikleme (oynatma RAF döngüsü yönetir)
    if (playing && !playStateChanged) return
    syncAllAt(timeRef.current, playing, false)
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

      // Normal ileri oynatmada alt video saatini ana referans kabul et (klip sınırında takılmaması için bitime 35ms kala serbest saat geçişi yap)
      const vEl = videoRef.current
      const curVClip = rate > 0 ? getVisualStackAt(nextT)[0] : undefined
      if (
        rate > 0 &&
        curVClip &&
        !curVClip.reverse &&
        vEl &&
        vEl.dataset.clipId === curVClip.id &&
        !vEl.paused &&
        !vEl.seeking &&
        vEl.readyState >= 2 &&
        nextT < curVClip.start + curVClip.duration - 0.035
      ) {
        const vm = mediaMap.get(curVClip.mediaId)
        if (vm?.mediaKind !== 'image' && vm?.mediaKind !== 'audio') {
          const spd = Math.max(0.25, Math.min(4.0, (curVClip.speed ?? 100) / 100))
          const videoBasedT = curVClip.start + (vEl.currentTime - curVClip.in) / spd
          if (
            Number.isFinite(videoBasedT) &&
            videoBasedT >= curVClip.start - 0.02 &&
            videoBasedT <= curVClip.start + curVClip.duration &&
            Math.abs(videoBasedT - nextT) < 1.25
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
        notifyTimeListeners(total)
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
        notifyTimeListeners(0)
        setTime(0)
        playingRef.current = false
        shuttleRateRef.current = 0
        setPlaying(false)
        setShuttleRate(0)
        syncAllAt(0, false, true)
        return
      }

      timeRef.current = nextT
      notifyTimeListeners(nextT)
      syncAllAt(nextT, true)

      // Oynatma sırasında yalnızca aktif taban klip veya üst katman (overlay/jenerik) sınır geçişinde React state'ini senkronize et
      const nextStack = getVisualStackAt(nextT)
      const nextPrimaryId = nextStack[0]?.id ?? null
      const nextOverlayKey = nextStack
        .slice(1)
        .map((c) => c.id)
        .join(',')
      let nextCreditId: string | null = null
      for (const laneId of orderedVideoLanesAsc) {
        if (!isLaneAudible(lanes, laneId)) continue
        const c = clipAt(clips, laneId, nextT)
        if (c && isCreditClip(c)) nextCreditId = c.id
      }
      if (
        nextPrimaryId !== lastCommittedPrimaryIdRef.current ||
        nextOverlayKey !== lastCommittedOverlayKeyRef.current ||
        nextCreditId !== lastCommittedCreditIdRef.current
      ) {
        lastCommittedPrimaryIdRef.current = nextPrimaryId
        lastCommittedOverlayKeyRef.current = nextOverlayKey
        lastCommittedCreditIdRef.current = nextCreditId
        setTime(nextT)
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, total, syncAllAt, getVisualStackAt, mediaMap, notifyTimeListeners, orderedVideoLanesAsc, lanes, clips])

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
          notifyTimeListeners(exactT)
          setTime(exactT)
        }
      }
    }
  }, [getVisualStackAt, mediaMap, notifyTimeListeners])

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
      notifyTimeListeners(0)
      setTime(0)
      syncAllAt(0, true, true)
    } else if (!next) {
      snapPlayheadToCurrentVideoFrame()
      notifyTimeListeners(timeRef.current)
      setTime(timeRef.current)
      anchorTimeRef.current = timeRef.current
      anchorWallRef.current = performance.now()
      syncAllAt(timeRef.current, false)
    } else {
      const stack = getVisualStackAt(timeRef.current)
      lastCommittedPrimaryIdRef.current = stack[0]?.id ?? null
      lastCommittedOverlayKeyRef.current = stack
        .slice(1)
        .map((c) => c.id)
        .join(',')
      anchorTimeRef.current = timeRef.current
      anchorWallRef.current = performance.now()
      syncAllAt(timeRef.current, true)
    }
  }, [snapPlayheadToCurrentVideoFrame, total, syncAllAt, getVisualStackAt, notifyTimeListeners])

  /** NLE J Kısayolu: Geri sarma (-1x, tekrar basınca -2x) */
  const shuttleReverse = useCallback((): number => {
    if (total <= 0) return 0
    setError(null)
    const curRate = playingRef.current ? shuttleRateRef.current : 0
    const nextRate = curRate >= 0 ? -1 : -2
    if (timeRef.current <= 0.05) {
      timeRef.current = total
      notifyTimeListeners(total)
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
  }, [total, syncAllAt, notifyTimeListeners])

  /** NLE K Kısayolu: Durdurma (Pause) */
  const shuttlePause = useCallback(() => {
    playingRef.current = false
    shuttleRateRef.current = 0
    snapPlayheadToCurrentVideoFrame()
    notifyTimeListeners(timeRef.current)
    setTime(timeRef.current)
    anchorTimeRef.current = timeRef.current
    anchorWallRef.current = performance.now()
    setPlaying(false)
    setShuttleRate(0)
    syncAllAt(timeRef.current, false)
  }, [snapPlayheadToCurrentVideoFrame, syncAllAt, notifyTimeListeners])

  /** NLE L Kısayolu: İleri oynatma (1x, tekrar basınca 2x, 4x) */
  const shuttleForward = useCallback((): number => {
    if (total <= 0) return 0
    setError(null)
    const curRate = playingRef.current ? shuttleRateRef.current : 0
    const nextRate = curRate <= 0 ? 1 : curRate === 1 ? 2 : 4
    if (timeRef.current >= total - 0.05) {
      timeRef.current = 0
      notifyTimeListeners(0)
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
  }, [total, syncAllAt, notifyTimeListeners])

  const beginScrub = useCallback(() => {
    if (scrubbingRef.current) return
    wasPlayingRef.current = playingRef.current
    scrubbingRef.current = true
    if (wasPlayingRef.current) {
      playingRef.current = false
      setPlaying(false)
      setTime(timeRef.current)
      syncAllAt(timeRef.current, false)
    }
  }, [syncAllAt])

  const endScrub = useCallback(() => {
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    anchorTimeRef.current = timeRef.current
    anchorWallRef.current = performance.now()
    setTime(timeRef.current)
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
      const stack = getVisualStackAt(clamped)
      lastCommittedPrimaryIdRef.current = stack[0]?.id ?? null
      lastCommittedOverlayKeyRef.current = stack
        .slice(1)
        .map((c) => c.id)
        .join(',')
      notifyTimeListeners(clamped)
      setTime(clamped)
      syncAllAt(clamped, scrubbingRef.current ? false : playingRef.current, true)
    },
    [total, syncAllAt, getVisualStackAt, notifyTimeListeners]
  )

  const videoProps: React.VideoHTMLAttributes<HTMLVideoElement> = {
    onLoadedMetadata: () => {
      syncAllAt(timeRef.current, playingRef.current, !playingRef.current)
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
      syncAllAt(timeRef.current, playingRef.current, true)
    }
  }, [currentMedia?.proxyState, currentMedia?.proxyUrl, proxyPlaybackMode, syncAllAt])

  return {
    videoRef,
    audioA1Ref,
    audioA2Ref,
    orderedAudioLanes,
    overlayVisualClips,
    registerAudioEl,
    registerOverlayVideoEl,
    registerVideoBufferEl,
    videoProps,
    videoSrc,
    currentMedia,
    activePrimaryClip: activeVClip ?? null,
    hasActiveVideoClip: Boolean(activeVClip),
    playing,
    shuttleRate,
    time,
    timeRef,
    subscribeTime,
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

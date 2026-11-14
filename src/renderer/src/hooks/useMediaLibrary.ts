import { useCallback, useEffect, useState } from 'react'
import type { MediaItem, PeaksResult } from '../../../shared/types'

/**
 * İçe aktarılan medyaların listesi, ses dalga formu (peaks) önbelleği
 * ve proxy durumu güncellemeleri.
 */
export function useMediaLibrary() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [peaksMap, setPeaksMap] = useState<Record<string, PeaksResult>>({})
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const loadPeaks = useCallback((list: MediaItem[]) => {
    for (const m of list) {
      window.noircut.getPeaks(m.id).then((res) => {
        if (res) {
          setPeaksMap((prev) => ({ ...prev, [m.id]: res }))
        }
      })
    }
  }, [])

  const add = useCallback(
    (incoming: MediaItem[]) => {
      if (incoming.length === 0) return
      setItems((prev) => {
        const known = new Set(prev.map((m) => m.id))
        const fresh = incoming.filter((m) => !known.has(m.id))
        return [...prev, ...fresh]
      })
      setActiveId((cur) => cur ?? incoming[0].id)
      loadPeaks(incoming)
    },
    [loadPeaks]
  )

  const importMedia = useCallback(async () => {
    setBusy(true)
    try {
      const res = await window.noircut.importMedia()
      if (res.canceled) return
      setErrors(res.errors)
      add(res.items)
      if (res.items.length > 0) setActiveId(res.items[0].id)
    } finally {
      setBusy(false)
    }
  }, [add])

  // Açılışta komut satırından/ortamdan gelen medya
  useEffect(() => window.noircut?.onMediaOpened(add), [add])

  // Arka planda üretilen proxy bildirimleri
  useEffect(() => {
    if (!window.noircut?.onProxyUpdate) return
    return window.noircut.onProxyUpdate((u) => {
      setItems((prev) =>
        prev.map((m) =>
          m.id === u.id
            ? {
                ...m,
                proxyState: u.state,
                proxyProgress: u.progress,
                proxyUrl: u.proxyUrl ?? m.proxyUrl
              }
            : m
        )
      )
    })
  }, [])

  const active = items.find((m) => m.id === activeId) ?? null

  const replaceAll = useCallback(
    (nextItems: MediaItem[], nextActiveId: string | null) => {
      setItems(nextItems)
      setActiveId(nextActiveId ?? nextItems[0]?.id ?? null)
      setPeaksMap({})
      if (nextItems.length > 0) loadPeaks(nextItems)
    },
    [loadPeaks]
  )

  return {
    items,
    active,
    activeId,
    setActiveId,
    peaksMap,
    importMedia,
    replaceAll,
    busy,
    errors,
    clearErrors: () => setErrors([])
  }
}

import type { CreditConfig, CustomFontRef } from '../../../shared/credits'

export interface CustomFontAsset extends CustomFontRef {
  label: string
  addedAt: number
}

const STORAGE_KEY = 'noircut:custom-fonts:v1'
const loadedFontNames = new Set<string>()
const loadingPromises = new Map<string, Promise<boolean>>()

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const commaIdx = dataUrl.indexOf(',')
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return bytes.buffer
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Font dosyası okunamadı'))
    reader.readAsDataURL(file)
  })
}

export function loadStoredCustomFonts(): CustomFontAsset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is CustomFontAsset =>
        Boolean(x && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.dataUrl === 'string')
    )
  } catch {
    return []
  }
}

export function saveStoredCustomFonts(fonts: CustomFontAsset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fonts))
  } catch {
    // localStorage doluysa bellek/proje oturumu çalışmaya devam eder
  }
}

export async function registerCustomFontFace(ref?: CustomFontRef | null): Promise<boolean> {
  if (!ref?.name || !ref.dataUrl || typeof FontFace === 'undefined') return false
  if (loadedFontNames.has(ref.name)) return true

  const existingPromise = loadingPromises.get(ref.name)
  if (existingPromise) return existingPromise

  const task = (async () => {
    try {
      const buf = dataUrlToArrayBuffer(ref.dataUrl)
      const face = new FontFace(ref.name, buf)
      const loaded = await face.load()
      document.fonts.add(loaded)
      loadedFontNames.add(ref.name)
      return true
    } catch {
      return false
    } finally {
      loadingPromises.delete(ref.name)
    }
  })()

  loadingPromises.set(ref.name, task)
  return task
}

export async function importCustomFontFile(file: File): Promise<CustomFontAsset> {
  const cleanLabel = file.name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '').trim() || 'Custom Font'
  const slug = cleanLabel.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 32) || 'Font'
  const uniqueSuffix = Math.random().toString(36).slice(2, 7)
  const familyName = `NoirCustom_${slug}_${uniqueSuffix}`

  const [buf, dataUrl] = await Promise.all([file.arrayBuffer(), fileToDataUrl(file)])
  const face = new FontFace(familyName, buf)
  const loaded = await face.load()
  document.fonts.add(loaded)
  loadedFontNames.add(familyName)

  const asset: CustomFontAsset = {
    id: `cfont-${Date.now().toString(36)}-${uniqueSuffix}`,
    label: cleanLabel,
    name: familyName,
    fileName: file.name,
    dataUrl,
    addedAt: Date.now()
  }

  const next = [asset, ...loadStoredCustomFonts().filter((f) => f.fileName !== file.name)].slice(0, 24)
  saveStoredCustomFonts(next)
  return asset
}

export function removeStoredCustomFont(id: string): CustomFontAsset[] {
  const next = loadStoredCustomFonts().filter((f) => f.id !== id)
  saveStoredCustomFonts(next)
  return next
}

/** Export öncesi tüm V2 kredilerindeki özel fontların ve Google Fonts'un hazır olmasını sağlar. */
export async function ensureCreditFontsReady(credits: CreditConfig[]): Promise<void> {
  const tasks: Array<Promise<unknown>> = []
  for (const c of credits) {
    if (c.font === 'custom' && c.customFont) {
      tasks.push(registerCustomFontFace(c.customFont))
    }
  }
  await Promise.all(tasks)
  try {
    await document.fonts.ready
  } catch {
    // sessiz geç
  }
}

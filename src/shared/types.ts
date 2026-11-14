/** Main <-> Renderer arasında paylaşılan tipler */
import type { Lut3D } from './lut'
import type { NoirCutProject } from './project'
import type { ExportRequest } from './timeline'

export interface EngineInfo {
  /** Kullanılan ffmpeg yürütülebilir dosyasının yolu */
  ffmpegPath: string
  /** Kullanılan ffprobe yürütülebilir dosyasının yolu */
  ffprobePath: string
  /** 'embedded' = ffmpeg-static (uygulamaya gömülü), 'system' = sistem PATH */
  source: 'embedded' | 'system' | 'missing'
  version: string | null
  platform: NodeJS.Platform
}

export type ProxyState = 'none' | 'building' | 'ready' | 'error'

/** İçe aktarılmış bir video dosyası */
export interface MediaItem {
  id: string
  /** Diskteki tam dosya yolu */
  path: string
  name: string
  /** saniye */
  duration: number
  width: number
  height: number
  codec: string
  fps: number
  hasAudio: boolean
  audioCodec: string | null
  /** data: URL (JPEG) – ffmpeg ile üretilir */
  thumbnail: string | null
  /** Oynatıcıda kullanılacak güvenli adres (noircut-media://) */
  url: string
  /** Codec Chromium'da oynamıyorsa true: oynatma için proxy kopya gerekir */
  needsProxy: boolean
  proxyState: ProxyState
  /** 0..1 */
  proxyProgress: number
  proxyUrl: string | null
}

export interface ProxyUpdate {
  id: string
  state: ProxyState
  progress: number
  proxyUrl: string | null
  error?: string
}

export interface ImportResult {
  items: MediaItem[]
  errors: string[]
  canceled: boolean
}

export interface PeaksResult {
  /** Her değer 0..255: ilgili zaman diliminin en yüksek genliği */
  peaks: Uint8Array
  perSecond: number
}

export interface ExportResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

export interface LutImportResult {
  canceled?: boolean
  lut?: Lut3D
  error?: string
}

export interface ProjectSaveResult {
  ok: boolean
  canceled?: boolean
  path?: string
  error?: string
}

export interface ProjectLoadResult {
  ok: boolean
  canceled?: boolean
  project?: NoirCutProject
  mediaItems?: MediaItem[]
  mediaErrors?: string[]
  path?: string
  error?: string
}

export interface NoirCutApi {
  getEngineInfo: () => Promise<EngineInfo>
  /** Dosya seçici açar, seçilen videoları analiz edip döndürür */
  importMedia: () => Promise<ImportResult>
  /** Uygulama başlarken komut satırı / ortam değişkeniyle açılan medya */
  onMediaOpened: (cb: (items: MediaItem[]) => void) => () => void
  /** Proxy üretimi ilerlemesi */
  onProxyUpdate: (cb: (u: ProxyUpdate) => void) => () => void
  /** Gerçek ses dalga formu verisi (ffmpeg ile çıkarılır) */
  getPeaks: (mediaId: string) => Promise<PeaksResult | null>
  /** Timeline'ı FFmpeg ile MP4'e aktarır (kaydetme penceresi açar) */
  exportProject: (req: ExportRequest) => Promise<ExportResult>
  cancelExport: () => Promise<void>
  onExportProgress: (cb: (percent: number) => void) => () => void
  /** Bilgisayardan .cube 3D LUT dosyası içe aktarır */
  importLut: () => Promise<LutImportResult>
  /** Dosyayı işletim sistemi dosya yöneticisinde gösterir */
  revealInFolder: (filePath: string) => Promise<void>
  /** Projeyi .noircut dosyası olarak kaydeder */
  saveProject: (project: NoirCutProject) => Promise<ProjectSaveResult>
  /** .noircut proje dosyasını açar ve medyaları geri yükler */
  loadProject: () => Promise<ProjectLoadResult>
}

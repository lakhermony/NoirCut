/** Main <-> Renderer arasında paylaşılan tipler */
import type { Lut3D } from './lut'
import type { NoirCutProject } from './project'
import type { ExportRequest, NoirSoundscapeId } from './timeline'

export type VideoEncoderId =
  | 'libx264'
  | 'libx265'
  | 'h264_nvenc'
  | 'hevc_nvenc'
  | 'h264_vaapi'
  | 'h264_qsv'
  | 'h264_amf'

export interface EngineInfo {
  /** Kullanılan ffmpeg yürütülebilir dosyasının yolu */
  ffmpegPath: string
  /** Kullanılan ffprobe yürütülebilir dosyasının yolu */
  ffprobePath: string
  /** 'embedded' = ffmpeg-static (uygulamaya gömülü), 'system' = sistem PATH */
  source: 'embedded' | 'system' | 'missing'
  version: string | null
  platform: NodeJS.Platform
  /** Algılanan donanım / yazılım H.264 kodlayıcıları */
  availableEncoders?: VideoEncoderId[]
  /** Donanım kodlayıcı sağlayan sistem ffmpeg yolu (varsa) */
  gpuFfmpegPath?: string | null
}

export type ProxyState = 'none' | 'building' | 'ready' | 'error'
export type MediaKind = 'video' | 'audio' | 'image'

/** İçe aktarılmış bir video, ses veya görsel dosyası */
export interface MediaItem {
  id: string
  /** Diskteki tam dosya yolu */
  path: string
  name: string
  /** Medya türü ('video' varsayılan) */
  mediaKind?: MediaKind
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

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  state: UpdaterState
  currentVersion: string
  latestVersion?: string
  progress?: number
  releaseNotes?: string
  message?: string
  lastCheckedAt?: string
  isSimulated?: boolean
}

export interface RecentProjectEntry {
  name: string
  path: string
  openedAt: string
}

export interface AutosaveEntry {
  id: string
  savedAt: string
  clipCount: number
  duration: number
  label: string
}

export interface AutosaveStatus {
  hasUncleanExit: boolean
  latest: AutosaveEntry | null
  snapshots: AutosaveEntry[]
}

export interface ProxyConfig {
  resolutionScale: '1/2' | '1/4' | '1/8'
  playbackMode: 'auto' | 'proxy' | 'original'
  proxyDir: string
}

export interface SilenceRegion {
  id: string
  start: number
  end: number
  duration: number
  avgDb: number
}

export interface TranscribeSegment {
  start: number
  end: number
  text: string
}

export type TranscribeStage = 'extract' | 'transcribe' | 'parse'

export interface TranscribeProgress {
  stage: TranscribeStage
  percent?: number
}

export interface TranscribeResult {
  ok: boolean
  engine?: string
  engineMissing?: boolean
  canceled?: boolean
  segments?: TranscribeSegment[]
  error?: string
}

export interface ArchiveProjectResult {
  ok: boolean
  canceled?: boolean
  dirPath?: string
  copiedFiles?: number
  error?: string
}

export interface ClipMetadataInfo {
  mediaId: string
  name: string
  cameraOrEncoder: string
  width: number
  height: number
  fps: number
  colorPrimaries: string
  codec: string
}

export interface SceneDetectResult {
  ok: boolean
  timestamps: number[]
  error?: string
}

export interface TransientDetectResult {
  ok: boolean
  timestamps: number[]
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
  /** Prosedürel sinematik ses efekti (Noir Soundscape) WAV üretir ve MediaItem olarak döndürür */
  generateSoundscape: (presetId: NoirSoundscapeId) => Promise<MediaItem | null>
  /** Metin dosyasını (.noirlook, .cube) kaydetme iletişim kutusu ile dışa aktarır */
  saveTextFile: (
    defaultName: string,
    content: string,
    filterName: string,
    extension: string
  ) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  /** .noirlook veya .cube dosyasını okur */
  openLookFile: () => Promise<{
    canceled?: boolean
    ext?: 'noirlook' | 'cube'
    name?: string
    content?: string
    error?: string
  }>
  /** Belirli dosya yolundan .noircut projesi açar (Son Projeler için) */
  loadProjectByPath: (filePath: string) => Promise<ProjectLoadResult>
  /** Uygulama güncelleme denetimi (electron-updater) */
  checkForUpdates: () => Promise<UpdateStatus>
  /** Güncellemeyi indirir */
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>
  /** İndirilen güncellemeyi kurup yeniden başlatır */
  quitAndInstallUpdate: () => Promise<void>
  /** Güncelleme durum olaylarını dinler */
  onUpdateStatus: (cb: (status: UpdateStatus) => void) => () => void
  /** Aktif uygulama sürümünü döndürür */
  getAppVersion: () => Promise<string>
  /** Kuyruklu dışa aktarma için hedef dosya yolu seçtirir */
  selectExportPath: (format: 'mp4' | 'mov', defaultName?: string) => Promise<string | null>
  /** Otomatik yedek (autosave) yazar */
  writeAutosave: (project: NoirCutProject, label?: string) => Promise<{ ok: boolean }>
  /** Kurtarma ve sürüm anlık görüntü durumunu sorgular */
  getAutosaveStatus: () => Promise<AutosaveStatus>
  /** Otomatik yedek anlık görüntüsünü geri yükler */
  restoreAutosave: (snapshotId: string) => Promise<ProjectLoadResult>
  /** Çökme kurtarma uyarısını yoksayar */
  dismissAutosave: () => Promise<void>
  /** Proxy sistem ayarlarını getirir / günceller */
  getProxyConfig?: () => Promise<ProxyConfig>
  setProxyConfig?: (patch: Partial<ProxyConfig>) => Promise<ProxyConfig>
  selectProxyDir?: () => Promise<string | null>
  generateBatchProxies?: (mediaIds?: string[], scale?: '1/2' | '1/4' | '1/8') => Promise<{ started: number }>
  reconnectMedia?: (mediaId: string) => Promise<MediaItem | null>
  /** Render kuyruğunu duraklatır / devam ettirir */
  pauseExport?: () => Promise<boolean>
  resumeExport?: () => Promise<boolean>
  /** Çevrimdışı Whisper CLI (whisper.cpp / faster-whisper) ile konuşma deşifresi */
  transcribeMedia?: (mediaId: string, language: string) => Promise<TranscribeResult>
  cancelTranscribe?: () => Promise<boolean>
  onTranscribeProgress?: (cb: (progress: TranscribeProgress) => void) => () => void
  /** Projeyi ve tüm medya dosyalarını taşınabilir tek klasörde paketler */
  archiveProject?: (project: NoirCutProject) => Promise<ArchiveProjectResult>
  /** Monitörden alınan kare anlık görüntüsünü PNG olarak kaydeder */
  saveSnapshot?: (
    dataUrl: string,
    defaultName: string
  ) => Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>
  /** GNU GPL v3 LICENSE ve THIRD-PARTY-LICENSES.txt içeriklerini okur */
  getLicenseInfo?: () => Promise<{ gplText: string; thirdPartyText: string }>
  /** Timeline kliplerinin FFprobe teknik meta verilerini çıkarır (jenerik üretimi için) */
  extractClipsMetadata?: (mediaIds: string[]) => Promise<ClipMetadataInfo[]>
  /** FFmpeg scene filtresi ile sert sahne kesim zamanlarını algılar */
  detectSceneCuts?: (mediaId: string, threshold?: number) => Promise<SceneDetectResult>
  /** Çözülmüş PCM ses üzerinde RMS / enerji akısı (transient) tepe noktalarını algılar */
  detectAudioTransients?: (mediaId: string, sensitivity?: number) => Promise<TransientDetectResult>
}

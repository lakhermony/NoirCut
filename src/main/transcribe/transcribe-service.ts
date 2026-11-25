import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { mkdir, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { TranscribeProgress, TranscribeResult, TranscribeSegment } from '../../shared/types'

export interface RunProcessOptions {
  signal?: AbortSignal
  onStderr?: (chunk: string) => void
  onStdout?: (chunk: string) => void
}

export interface RunProcessResult {
  code: number | null
  stdout: string
  stderr: string
  aborted: boolean
}

export function killChildProcessTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    } catch {
      // yoksay
    }
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // yoksay
  }
  setTimeout(() => {
    try {
      if (!child.killed) child.kill('SIGKILL')
    } catch {
      // yoksay
    }
  }, 300).unref?.()
}

export function runProcess(
  bin: string,
  args: string[],
  options: RunProcessOptions = {}
): Promise<RunProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({ code: null, stdout: '', stderr: '', aborted: true })
      return
    }

    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let aborted = false
    let settled = false

    const cleanup = () => {
      if (options.signal) {
        options.signal.removeEventListener('abort', onAbort)
      }
    }

    const onAbort = () => {
      aborted = true
      killChildProcessTree(child)
    }

    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString('utf-8')
      stdout += s
      options.onStdout?.(s)
    })

    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString('utf-8')
      stderr += s
      options.onStderr?.(s)
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      cleanup()
      if (aborted) {
        resolve({ code: null, stdout, stderr, aborted: true })
      } else {
        reject(err)
      }
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ code, stdout, stderr, aborted })
    })
  })
}

export function defaultFindBin(names: string[]): string | null {
  for (const n of names) {
    const chk = spawnSync(process.platform === 'win32' ? 'where' : 'which', [n], {
      encoding: 'utf-8',
      windowsHide: true
    })
    if (chk.status === 0 && chk.stdout.trim()) return n
  }
  return null
}

export function defaultFindModel(): string | null {
  if (process.env.NOIRCUT_WHISPER_MODEL && existsSync(process.env.NOIRCUT_WHISPER_MODEL)) {
    return process.env.NOIRCUT_WHISPER_MODEL
  }
  const home = process.env.HOME || ''
  const dirs = [
    join(home, '.local/share/whisper'),
    join(home, '.cache/whisper'),
    join(home, 'models'),
    '/usr/share/whisper'
  ]
  for (const d of dirs) {
    if (!existsSync(d)) continue
    try {
      const match = readdirSync(d).find((f) => f.includes('ggml') && f.endsWith('.bin'))
      if (match) return join(d, match)
    } catch {
      // yoksay
    }
  }
  return null
}

export function parseSrt(srt: string): TranscribeSegment[] {
  const toSec = (ts: string) => {
    const [h, m, s] = ts.trim().replace(',', '.').split(':').map(Number)
    return Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)
      ? h * 3600 + m * 60 + s
      : NaN
  }
  const segs: TranscribeSegment[] = []
  for (const block of srt.replace(/\r\n/g, '\n').split('\n\n')) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const idx = lines.findIndex((l) => l.includes('-->'))
    if (idx < 0) continue
    const [a, b] = lines[idx].split('-->')
    const start = toSec(a)
    const end = toSec(b)
    const text = lines
      .slice(idx + 1)
      .join(' ')
      .trim()
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) {
      segs.push({ start, end, text })
    }
  }
  return segs
}

export interface TranscribeMediaOptions {
  ffmpegPath: string
  mediaPath: string
  language: string
  workDir?: string
  onProgress?: (progress: TranscribeProgress) => void
  findBin?: (names: string[]) => string | null
  findModel?: () => string | null
}

let activeController: AbortController | null = null

export function isTranscriptionActive(): boolean {
  return activeController !== null
}

export function cancelActiveTranscription(): boolean {
  if (!activeController) return false
  activeController.abort()
  return true
}

function parseWhisperProgressPercent(text: string): number | undefined {
  const m = text.match(/(\d{1,3})\s*%/)
  if (!m) return undefined
  const val = Number(m[1])
  if (!Number.isFinite(val) || val < 0 || val > 100) return undefined
  return val
}

export async function transcribeMediaFile(opts: TranscribeMediaOptions): Promise<TranscribeResult> {
  if (activeController) {
    return { ok: false, engineMissing: false, error: 'busy' }
  }
  if (!opts.mediaPath || !existsSync(opts.mediaPath)) {
    return { ok: false, engineMissing: false, error: 'Medya öğesi bulunamadı' }
  }

  const controller = new AbortController()
  activeController = controller

  const workDir = opts.workDir ?? join(tmpdir(), 'noircut-whisper')
  await mkdir(workDir, { recursive: true })
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const wavPath = join(workDir, `audio-${stamp}.wav`)
  const outPrefix = join(workDir, `out-${stamp}`)
  const srtPath = `${outPrefix}.srt`
  const pySrt = join(workDir, `audio-${stamp}.srt`)

  const lang = opts.language?.toLowerCase().startsWith('tr')
    ? 'tr'
    : opts.language?.toLowerCase().startsWith('en')
      ? 'en'
      : 'auto'

  const findBin = opts.findBin ?? defaultFindBin
  const findModel = opts.findModel ?? defaultFindModel

  try {
    opts.onProgress?.({ stage: 'extract' })
    const ff = await runProcess(
      opts.ffmpegPath,
      ['-y', '-i', opts.mediaPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', wavPath],
      { signal: controller.signal }
    )
    if (ff.aborted || controller.signal.aborted) {
      return { ok: false, engineMissing: false, canceled: true, error: 'İptal edildi' }
    }
    if (ff.code !== 0 || !existsSync(wavPath)) {
      return { ok: false, engineMissing: false, error: 'FFmpeg ile 16kHz ses çıkarılamadı' }
    }

    const cppBin = findBin(['whisper-cli', 'whisper-cpp'])
    const model = findModel()
    if (cppBin && model) {
      opts.onProgress?.({ stage: 'transcribe' })
      const handleOutput = (chunk: string) => {
        const pct = parseWhisperProgressPercent(chunk)
        if (pct !== undefined) {
          opts.onProgress?.({ stage: 'transcribe', percent: pct })
        }
      }
      const res = await runProcess(
        cppBin,
        ['-m', model, '-l', lang, '-osrt', '-of', outPrefix, '-f', wavPath],
        {
          signal: controller.signal,
          onStderr: handleOutput,
          onStdout: handleOutput
        }
      )
      if (res.aborted || controller.signal.aborted) {
        return { ok: false, engineMissing: false, canceled: true, error: 'İptal edildi' }
      }
      if (res.code === 0 && existsSync(srtPath)) {
        opts.onProgress?.({ stage: 'parse' })
        const srt = await readFile(srtPath, 'utf-8')
        return {
          ok: true,
          engine: `whisper.cpp (${cppBin})`,
          engineMissing: false,
          segments: parseSrt(srt)
        }
      }
    }

    const pyBin = findBin(['whisper', 'faster-whisper'])
    if (pyBin) {
      opts.onProgress?.({ stage: 'transcribe' })
      const wArgs = [wavPath, '--output_format', 'srt', '--output_dir', workDir]
      if (lang !== 'auto') wArgs.push('--language', lang)
      const handleOutput = (chunk: string) => {
        const pct = parseWhisperProgressPercent(chunk)
        if (pct !== undefined) {
          opts.onProgress?.({ stage: 'transcribe', percent: pct })
        }
      }
      const res = await runProcess(pyBin, wArgs, {
        signal: controller.signal,
        onStderr: handleOutput,
        onStdout: handleOutput
      })
      if (res.aborted || controller.signal.aborted) {
        return { ok: false, engineMissing: false, canceled: true, error: 'İptal edildi' }
      }
      if (res.code === 0 && existsSync(pySrt)) {
        opts.onProgress?.({ stage: 'parse' })
        const srt = await readFile(pySrt, 'utf-8')
        return { ok: true, engine: pyBin, engineMissing: false, segments: parseSrt(srt) }
      }
    }

    return {
      ok: false,
      engineMissing: true,
      error: 'Sistemde whisper-cli (+ ggml model) veya whisper bulunamadı; ses zarfı (VAD) ile devam edildi.'
    }
  } finally {
    if (activeController === controller) {
      activeController = null
    }
    await rm(wavPath, { force: true }).catch(() => {})
    await rm(srtPath, { force: true }).catch(() => {})
    await rm(pySrt, { force: true }).catch(() => {})
  }
}

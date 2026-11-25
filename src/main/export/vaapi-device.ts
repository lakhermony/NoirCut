import { spawn } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

export function listVaapiRenderDevices(driDir = '/dev/dri'): string[] {
  if (!existsSync(driDir)) return []
  try {
    return readdirSync(driDir)
      .filter((name) => /^renderD\d+$/.test(name))
      .sort((a, b) => {
        const na = Number(a.slice('renderD'.length))
        const nb = Number(b.slice('renderD'.length))
        return na - nb
      })
      .map((name) => join(driDir, name))
  } catch {
    return []
  }
}

export function probeVaapiDevice(
  ffmpegBin: string,
  devicePath: string,
  timeoutMs = 4000
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }

    const child = spawn(
      ffmpegBin,
      [
        '-y',
        '-v',
        'error',
        '-vaapi_device',
        devicePath,
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=64x64:d=0.1',
        '-vf',
        'format=nv12,hwupload',
        '-c:v',
        'h264_vaapi',
        '-f',
        'null',
        '-'
      ],
      { windowsHide: true, stdio: 'ignore' }
    )

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // yoksay
      }
      finish(false)
    }, timeoutMs)

    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
  })
}

export interface ResolveVaapiDeviceOptions {
  ffmpegBin: string
  envDevice?: string
  listDevices?: () => string[]
  probeDevice?: (ffmpegBin: string, devicePath: string) => Promise<boolean>
  useCache?: boolean
}

let cachedVaapiDevice: string | null | undefined = undefined

export function clearVaapiDeviceCache(): void {
  cachedVaapiDevice = undefined
}

export async function resolveVaapiDevice(
  options: ResolveVaapiDeviceOptions
): Promise<string | null> {
  const useCache = options.useCache !== false
  const envOverride =
    options.envDevice !== undefined ? options.envDevice : process.env.NOIRCUT_VAAPI_DEVICE

  if (useCache && cachedVaapiDevice !== undefined && !envOverride) {
    return cachedVaapiDevice
  }

  const probe = options.probeDevice ?? probeVaapiDevice
  const candidates = envOverride
    ? [envOverride.trim()].filter(Boolean)
    : (options.listDevices ?? listVaapiRenderDevices)()

  for (const dev of candidates) {
    try {
      if (await probe(options.ffmpegBin, dev)) {
        if (useCache && !envOverride) cachedVaapiDevice = dev
        return dev
      }
    } catch {
      // sonraki adayı dene
    }
  }

  if (useCache && !envOverride) cachedVaapiDevice = null
  return null
}

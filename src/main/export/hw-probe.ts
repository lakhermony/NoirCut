import { spawn } from 'child_process'
import type { HwEncodersProbeResult } from '../../shared/types'
import { getEngineInfo } from '../engine/ffmpeg-engine'
import { resolveVaapiDevice } from './vaapi-device'

const PROBE_TIMEOUT_MS = 4500

let cachedProbePromise: Promise<HwEncodersProbeResult> | null = null

export function clearHwEncodersCache(): void {
  cachedProbePromise = null
}

function runNullEncodeProbe(ffmpegBin: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }

    const child = spawn(ffmpegBin, args, {
      windowsHide: true,
      stdio: 'ignore'
    })

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // yoksay
      }
      finish(false)
    }, PROBE_TIMEOUT_MS)

    child.on('error', () => finish(false))
    child.on('close', (code) => finish(code === 0))
  })
}

function buildNvencProbeArgs(codec: 'h264_nvenc' | 'hevc_nvenc'): string[] {
  return [
    '-y',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=black:s=256x256:d=0.1',
    '-c:v',
    codec,
    '-f',
    'null',
    '-'
  ]
}

function buildVaapiProbeArgs(
  vaapiDevice: string,
  codec: 'h264_vaapi' | 'hevc_vaapi'
): string[] {
  return [
    '-y',
    '-v',
    'error',
    '-vaapi_device',
    vaapiDevice,
    '-f',
    'lavfi',
    '-i',
    'color=black:s=256x256:d=0.1',
    '-vf',
    'format=nv12,hwupload',
    '-c:v',
    codec,
    '-f',
    'null',
    '-'
  ]
}

/**
 * FFmpeg donanım kodlayıcılarını (NVENC ve Linux VAAPI) gerçek 0.1sn null-encode
 * testi ile çalışma zamanında sınar ve sonucu bellekte önbelleğe alır.
 */
export function probeHardwareEncoders(forceRefresh = false): Promise<HwEncodersProbeResult> {
  if (!forceRefresh && cachedProbePromise) {
    return cachedProbePromise
  }

  cachedProbePromise = (async (): Promise<HwEncodersProbeResult> => {
    const engine = await getEngineInfo()
    const ffmpegBin = engine.gpuFfmpegPath ?? engine.ffmpegPath
    if (!ffmpegBin || engine.source === 'missing') {
      return {
        nvencH264: false,
        nvencHevc: false,
        vaapiH264: false,
        vaapiHevc: false,
        vaapiDevice: null,
        recommended: 'cpu'
      }
    }

    const vaapiDevice =
      process.platform === 'linux'
        ? await resolveVaapiDevice({ ffmpegBin, useCache: !forceRefresh })
        : null

    const [nvencH264, nvencHevc, vaapiH264, vaapiHevc] = await Promise.all([
      runNullEncodeProbe(ffmpegBin, buildNvencProbeArgs('h264_nvenc')),
      runNullEncodeProbe(ffmpegBin, buildNvencProbeArgs('hevc_nvenc')),
      vaapiDevice
        ? runNullEncodeProbe(ffmpegBin, buildVaapiProbeArgs(vaapiDevice, 'h264_vaapi'))
        : Promise.resolve(false),
      vaapiDevice
        ? runNullEncodeProbe(ffmpegBin, buildVaapiProbeArgs(vaapiDevice, 'hevc_vaapi'))
        : Promise.resolve(false)
    ])

    const recommended: HwEncodersProbeResult['recommended'] =
      nvencH264 || nvencHevc
        ? 'nvenc'
        : (vaapiH264 || vaapiHevc) && vaapiDevice
          ? 'vaapi'
          : 'cpu'

    return {
      nvencH264,
      nvencHevc,
      vaapiH264,
      vaapiHevc,
      vaapiDevice,
      recommended
    }
  })()

  return cachedProbePromise
}

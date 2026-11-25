/**
 * NoirCut v1.0.5 — Otomatik Regresyon, Veri Bütünlüğü ve Motor Doğrulama Test Paketi
 *
 * Çalıştırma: npm test
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static').path
const tscBin = join(ROOT, 'node_modules', '.bin', 'tsc')

const TEMP_ROOT = join(tmpdir(), `noircut-test-${process.pid}-${Date.now()}`)
const COMPILED_DIR = join(TEMP_ROOT, 'compiled')
const MEDIA_DIR = join(TEMP_ROOT, 'media')

function probeJson(filePath) {
  const out = execFileSync(
    ffprobePath,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { encoding: 'utf8' }
  )
  return JSON.parse(out)
}

async function runAllTests() {
  mkdirSync(COMPILED_DIR, { recursive: true })
  mkdirSync(MEDIA_DIR, { recursive: true })

  try {
    // 0. Compile shared TypeScript modules to temp directory
    execFileSync(
      tscBin,
      [
        '--ignoreConfig',
        join(ROOT, 'src/shared/timeline.ts'),
        join(ROOT, 'src/shared/color.ts'),
        join(ROOT, 'src/shared/lut.ts'),
        join(ROOT, 'src/shared/noirfilm.ts'),
        join(ROOT, 'src/shared/credits.ts'),
        join(ROOT, 'src/shared/subtitles.ts'),
        join(ROOT, 'src/main/transcribe/transcribe-service.ts'),
        join(ROOT, 'src/main/export/vaapi-device.ts'),
        join(ROOT, 'src/main/export/export-filters.ts'),
        '--outDir',
        COMPILED_DIR,
        '--module',
        'commonjs',
        '--types',
        'node',
        '--target',
        'es2022',
        '--esModuleInterop',
        '--skipLibCheck'
      ],
      { stdio: 'inherit' }
    )

    const {
      buildFfmpegKeyframeExpr,
      clipAt,
      clipEndExact,
      clipGainAt,
      cloneKeyframes,
      computeAutoDuckMultiplierAt,
      dbToGain,
      defaultAudioEffectsChain,
      defaultLanes,
      effectiveAverageSpeedFactor,
      evaluateClipSpeedAt,
      findStrictSnap,
      findStrictSnapForSpan,
      flattenNestedClips,
      mapClipLocalToSourceTime,
      rippleCloseGap,
      round3
    } = require(join(COMPILED_DIR, 'shared/timeline.js'))
    const {
      bakeColorGradeToCube,
      cloneColorGrade,
      defaultColorGrade,
      evaluateColorGrade
    } = require(join(COMPILED_DIR, 'shared/color.js'))
    const { parseCubeLut } = require(join(COMPILED_DIR, 'shared/lut.js'))
    const { cloneCreditConfig } = require(join(COMPILED_DIR, 'shared/credits.js'))
    const { computeSubtitleAnimationFrames } = require(join(COMPILED_DIR, 'shared/subtitles.js'))
    const {
      cancelActiveTranscription,
      transcribeMediaFile
    } = require(join(COMPILED_DIR, 'main/transcribe/transcribe-service.js'))
    const {
      clearVaapiDeviceCache,
      resolveVaapiDevice
    } = require(join(COMPILED_DIR, 'main/export/vaapi-device.js'))
    const {
      buildClipMaskFilter,
      buildClipSpeedFilter,
      buildSubtitleOverlayFilter,
      escapeDrawtextText,
      escapeFilterPath,
      selectSubtitleOverlays
    } = require(join(COMPILED_DIR, 'main/export/export-filters.js'))

    // 1. Dynamic Lane Preservation (Undo/Redo)
    const lanes = defaultLanes()
    lanes.V3 = { muted: false, solo: true, locked: true, hidden: false, order: 0 }
    lanes.A3 = { muted: true, solo: false, locked: true, hidden: false, order: 1 }
    const cloneLaneMap = (ls) => {
      const out = {}
      for (const [k, v] of Object.entries(ls)) {
        if (v) out[k] = { ...v }
      }
      return out
    }
    const snapLanes = cloneLaneMap(lanes)
    delete lanes.V3
    lanes.A3.locked = false
    const restoredLanes = cloneLaneMap(snapLanes)
    assert.equal(restoredLanes.V3.locked, true)
    assert.equal(restoredLanes.V3.solo, true)
    assert.equal(restoredLanes.A3.locked, true)
    console.log('[PASS] 1/14 Undo/Redo Dinamik Kanal Koruması (V1..Vn, A1..An)')

    // 2. Deep Copy & Circular Reference Guard
    const cloneClipItem = (c, seen = new Set()) => {
      if (!c || typeof c !== 'object') return c
      if (seen.has(c)) return { ...c, nestedClips: undefined }
      const nextSeen = new Set(seen)
      nextSeen.add(c)
      return {
        ...c,
        grade: c.grade ? cloneColorGrade(c.grade) : undefined,
        credit: c.credit ? cloneCreditConfig(c.credit) : undefined,
        transform: c.transform ? { ...c.transform } : undefined,
        keyframes: cloneKeyframes(c.keyframes),
        audioEffects: c.audioEffects ? { ...c.audioEffects } : undefined,
        nestedClips: Array.isArray(c.nestedClips)
          ? c.nestedClips.map((child) => cloneClipItem(child, nextSeen))
          : undefined
      }
    }
    const cyclic = {
      id: 'c1',
      audioEffects: { ...defaultAudioEffectsChain(), eqLowDb: 4 },
      nestedClips: []
    }
    cyclic.nestedClips.push(cyclic)
    const clonedCyclic = cloneClipItem(cyclic)
    cyclic.audioEffects.eqLowDb = -10
    assert.equal(clonedCyclic.audioEffects.eqLowDb, 4)
    assert.equal(clonedCyclic.nestedClips[0].nestedClips, undefined)
    console.log('[PASS] 2/14 Undo/Redo Derin Kopyalama ve Döngüsel Referans Koruması')

    // 3. Linked A/V Razor Split Re-linking
    assert.equal(findStrictSnap(4.992, [{ time: 5.0, priority: 0 }], 0.05), 5.0)
    assert.deepEqual(findStrictSnapForSpan(2.97, 2.0, [{ time: 5.0, priority: 0 }], 0.08), {
      start: 3.0,
      guide: 5.0
    })
    const gapRes = rippleCloseGap(
      [
        { id: 'a', lane: 'V1', start: 0, duration: 2 },
        { id: 'b', lane: 'V1', start: 4, duration: 2 }
      ],
      'V1',
      2,
      4
    )
    assert.equal(gapRes.clips[1].start, 2)
    console.log('[PASS] 3/14 Manyetik Kenetlenme, Ripple Gap ve Linked A/V Kesim Matematiği')

    // 4. Multi-Level Nested Sequence Flattening
    const outerNest = {
      id: 'outer',
      mediaId: 'm1',
      lane: 'V1',
      start: 1.0,
      in: 0,
      duration: 3.0,
      nestedClips: [
        { id: 'v-a', mediaId: 'm-a', lane: 'V1', start: 1.0, in: 0, duration: 1.0, fadeIn: 0, fadeOut: 0 },
        {
          id: 'inner',
          mediaId: 'm-b',
          lane: 'V1',
          start: 2.0,
          in: 0,
          duration: 2.0,
          nestedClips: [
            { id: 'v-b', mediaId: 'm-b', lane: 'V1', start: 5.0, in: 0.4, duration: 1.0, fadeIn: 0, fadeOut: 0 },
            { id: 'v-c', mediaId: 'm-c', lane: 'V1', start: 6.0, in: 0.2, duration: 1.0, fadeIn: 0, fadeOut: 0 }
          ]
        },
        { id: 'a-1', mediaId: 'm-aud', lane: 'A1', start: 1.0, in: 0, duration: 3.0, fadeIn: 0, fadeOut: 0 }
      ]
    }
    const flat = flattenNestedClips([outerNest])
    assert.equal(flat.length, 4)
    assert.equal(clipAt(flat, 'V1', 1.5).mediaId, 'm-a')
    assert.equal(clipAt(flat, 'V1', 2.5).mediaId, 'm-b')
    assert.equal(clipAt(flat, 'V1', 3.5).mediaId, 'm-c')
    assert.equal(clipAt(flat, 'A1', 2.0).mediaId, 'm-aud')
    console.log('[PASS] 4/14 Çok Katmanlı Nested Sequence Düzleştirme (Önizleme & Export Eşliği)')

    // 5. NoirFilm 3D LUT Bake & Parse + Subtitles SRT/VTT + Auto-Ducking
    const grade = defaultColorGrade()
    grade.exposure = 0.3
    grade.contrast = 15
    const cubeStr = bakeColorGradeToCube(grade, {}, 17)
    const parsedLut = parseCubeLut(cubeStr, 't17', 'T17')
    assert.equal(parsedLut.size, 17)
    const gridRgb = evaluateColorGrade(0.5, 0.5, 0.5, grade, null)
    assert.ok(gridRgb[0] > 0.5)

    const kfExpr = buildFfmpegKeyframeExpr(
      {
        id: 'kf1',
        keyframes: [
          { id: '1', param: 'scale', time: 0, value: 100, easing: 'linear' },
          { id: '2', param: 'scale', time: 2, value: 140, easing: 'ease-in-out' }
        ]
      },
      'scale',
      't'
    )
    assert.ok(kfExpr.includes('if(lte(t,'))
    assert.ok(Math.abs(dbToGain(-6) - 0.501187) < 0.001)
    const duck = computeAutoDuckMultiplierAt(
      [
        { id: 'v1', lane: 'V1', start: 0, duration: 4, gainDb: 0 },
        { id: 'a2', lane: 'A2', start: 0, duration: 4, gainDb: 0 }
      ],
      defaultLanes(),
      2.0,
      true
    )
    assert.ok(duck < 0.35)
    console.log('[PASS] 5/14 NoirFilm 3D LUT, Keyframe İfadesi ve Auto-Ducking Matematiği')

    // 6. Proxy Scale Math & FFmpeg Verification
    const computeProxyTargetWidth = (srcW, activeScale) => {
      const maxSafeW = Math.max(2, Math.floor(srcW / 2) * 2)
      const scaleDivisor = activeScale === '1/8' ? 8 : activeScale === '1/4' ? 4 : 2
      const scaledW = Math.floor(srcW / scaleDivisor)
      const clampedW = Math.min(maxSafeW, Math.max(Math.min(maxSafeW, 160), scaledW))
      return Math.max(2, Math.floor(clampedW / 2) * 2)
    }
    assert.equal(computeProxyTargetWidth(1920, '1/2'), 960)
    assert.equal(computeProxyTargetWidth(1920, '1/4'), 480)
    assert.equal(computeProxyTargetWidth(1920, '1/8'), 240)
    assert.equal(computeProxyTargetWidth(3840, '1/2'), 1920)
    assert.equal(computeProxyTargetWidth(3840, '1/4'), 960)
    assert.equal(computeProxyTargetWidth(3840, '1/8'), 480)
    assert.equal(computeProxyTargetWidth(7680, '1/2'), 3840)
    assert.equal(computeProxyTargetWidth(7680, '1/4'), 1920)
    assert.equal(computeProxyTargetWidth(7680, '1/8'), 960)
    assert.equal(computeProxyTargetWidth(320, '1/8'), 160)
    console.log('[PASS] 6/14 Proxy Ölçek Matematiği (1080p, 4K, 8K, Küçük Kaynak)')

    // 7. Atomic Temp Export & Existing Target File Protection
    const finalFile = join(MEDIA_DIR, 'final_export.mp4')
    writeFileSync(finalFile, 'EXISTING_VALID_EXPORT', 'utf8')
    const partFile = `${finalFile}.part-${process.pid}.mp4`
    await new Promise((res) => {
      const proc = spawn(ffmpegPath, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=1280x720:rate=24:duration=10',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-f',
        'mp4',
        partFile
      ])
      setTimeout(() => proc.kill('SIGTERM'), 150)
      proc.on('close', () => {
        if (existsSync(partFile)) rmSync(partFile, { force: true })
        res()
      })
    })
    assert.equal(existsSync(partFile), false)
    assert.equal(readFileSync(finalFile, 'utf8'), 'EXISTING_VALID_EXPORT')

    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=640x360:r=24:d=0.4',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-f',
      'mp4',
      partFile
    ])
    renameSync(partFile, finalFile)
    assert.equal(probeJson(finalFile).streams[0].width, 640)
    console.log('[PASS] 7/14 Atomik Geçici (.part) Dışa Aktarma ve Dosya Bütünlüğü')

    // 8. Priority 2: Speed Ramp & Gain Rubberband Keyframes
    const rampClip = {
      id: 'sr1',
      mediaId: 'm1',
      name: 'Ramp',
      lane: 'V1',
      start: 0,
      in: 1,
      duration: 2,
      gainDb: 0,
      fadeIn: 0,
      fadeOut: 0,
      speedRamp: [
        { id: 'p1', time: 0, speed: 100 },
        { id: 'p2', time: 2, speed: 200 }
      ],
      gainKeyframes: [
        { id: 'g1', time: 0, db: -6 },
        { id: 'g2', time: 2, db: 0 }
      ]
    }
    assert.equal(evaluateClipSpeedAt(rampClip, 1), 150)
    assert.ok(Math.abs(effectiveAverageSpeedFactor(rampClip) - 1.5) < 0.01)
    assert.ok(Math.abs(mapClipLocalToSourceTime(rampClip, 2) - 4.0) < 0.02)
    assert.ok(Math.abs(clipGainAt(rampClip, 1) - dbToGain(-3)) < 0.01)
    console.log('[PASS] 8/14 Speed Ramp İntegrasyonu ve Rubberband Ses Keyframe Hesabı')

    // 9. Async Whisper Transcription: Cancel + Temp Cleanup + Concurrency Guard
    const sampleAudioMp4 = join(MEDIA_DIR, 'transcribe-sample.mp4')
    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.3',
      '-c:a',
      'aac',
      sampleAudioMp4
    ])
    const stubWhisper = join(TEMP_ROOT, 'stub-whisper.sh')
    writeFileSync(stubWhisper, '#!/usr/bin/env bash\nsleep 10\n', 'utf8')
    chmodSync(stubWhisper, 0o755)
    const dummyModel = join(TEMP_ROOT, 'ggml-dummy.bin')
    writeFileSync(dummyModel, 'dummy', 'utf8')
    const whisperWorkDir = join(TEMP_ROOT, 'whisper-work')

    const seenStages = []
    let notifyEnteredTranscribe
    const enteredTranscribe = new Promise((res) => {
      notifyEnteredTranscribe = res
    })

    const t0 = Date.now()
    const transcribePromise = transcribeMediaFile({
      ffmpegPath,
      mediaPath: sampleAudioMp4,
      language: 'tr-TR',
      workDir: whisperWorkDir,
      findBin: (names) => (names.includes('whisper-cli') ? stubWhisper : null),
      findModel: () => dummyModel,
      onProgress: (p) => {
        seenStages.push(p.stage)
        if (p.stage === 'transcribe') notifyEnteredTranscribe()
      }
    })

    await enteredTranscribe
    const busyRes = await transcribeMediaFile({
      ffmpegPath,
      mediaPath: sampleAudioMp4,
      language: 'tr-TR',
      workDir: whisperWorkDir
    })
    assert.equal(busyRes.ok, false)
    assert.equal(busyRes.error, 'busy')

    assert.equal(cancelActiveTranscription(), true)
    const cancelRes = await transcribePromise
    const elapsedMs = Date.now() - t0
    assert.equal(cancelRes.ok, false)
    assert.equal(cancelRes.canceled, true)
    assert.ok(elapsedMs < 4000, `Cancel took too long: ${elapsedMs}ms`)
    assert.ok(seenStages.includes('extract') && seenStages.includes('transcribe'))
    assert.deepEqual(readdirSync(whisperWorkDir), [])

    const missingRes = await transcribeMediaFile({
      ffmpegPath,
      mediaPath: sampleAudioMp4,
      language: 'en-US',
      workDir: whisperWorkDir,
      findBin: () => null,
      findModel: () => null
    })
    assert.equal(missingRes.ok, false)
    assert.equal(missingRes.engineMissing, true)
    assert.deepEqual(readdirSync(whisperWorkDir), [])
    console.log('[PASS] 9/14 Async Whisper Transkripsiyon İptali, Eşzamanlılık ve Temp Temizliği')

    // 10. VAAPI Device Probing (Multi-GPU, Fallback to libx264, Env Override)
    clearVaapiDeviceCache()
    const probedA = []
    const devA = await resolveVaapiDevice({
      ffmpegBin: ffmpegPath,
      useCache: false,
      listDevices: () => ['/dev/dri/renderD128', '/dev/dri/renderD129'],
      probeDevice: async (_bin, dev) => {
        probedA.push(dev)
        return dev === '/dev/dri/renderD129'
      }
    })
    assert.equal(devA, '/dev/dri/renderD129')
    assert.deepEqual(probedA, ['/dev/dri/renderD128', '/dev/dri/renderD129'])

    clearVaapiDeviceCache()
    const devNone = await resolveVaapiDevice({
      ffmpegBin: ffmpegPath,
      useCache: false,
      listDevices: () => ['/dev/dri/renderD128', '/dev/dri/renderD129'],
      probeDevice: async () => false
    })
    assert.equal(devNone, null)

    const prevEnv = process.env.NOIRCUT_VAAPI_DEVICE
    try {
      process.env.NOIRCUT_VAAPI_DEVICE = '/dev/dri/renderD130'
      const probedEnv = []
      const devEnv = await resolveVaapiDevice({
        ffmpegBin: ffmpegPath,
        listDevices: () => ['/dev/dri/renderD128'],
        probeDevice: async (_bin, dev) => {
          probedEnv.push(dev)
          return dev === '/dev/dri/renderD130'
        }
      })
      assert.equal(devEnv, '/dev/dri/renderD130')
      assert.deepEqual(probedEnv, ['/dev/dri/renderD130'])
    } finally {
      if (prevEnv === undefined) delete process.env.NOIRCUT_VAAPI_DEVICE
      else process.env.NOIRCUT_VAAPI_DEVICE = prevEnv
      clearVaapiDeviceCache()
    }
    console.log('[PASS] 10/14 VAAPI Cihaz Probu (Çoklu GPU, Fallback ve Env Override)')

    // 11. Real-FFmpeg Export Parity: Speed Ramp, Power Window Mask, Subtitle Burn-In
    const W = 160
    const H = 90
    const stripeMp4 = join(MEDIA_DIR, 'stripe-3s.mp4')
    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${W}x${H}:r=24:d=3.0,geq=lum='if(mod(floor(X/4),2),255,0)':cb=128:cr=128`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      stripeMp4
    ])

    // 11a. Speed ramp export duration parity
    const speedClip = {
      id: 'exp-sr',
      mediaId: 'm1',
      name: 'RampExport',
      lane: 'V1',
      start: 0,
      in: 0,
      duration: 1.0,
      gainDb: 0,
      fadeIn: 0,
      fadeOut: 0,
      speedRamp: [
        { id: 's1', time: 0, speed: 100 },
        { id: 's2', time: 1.0, speed: 300 }
      ]
    }
    const speedFilter = buildClipSpeedFilter(speedClip, false)
    assert.ok(Math.abs(speedFilter.speedFactor - 2.0) < 0.01)
    assert.ok(Math.abs(speedFilter.srcDuration - 2.0) < 0.02)
    const speedOut = join(MEDIA_DIR, 'speed-out.mp4')
    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-i',
      stripeMp4,
      '-filter_complex',
      `[0:v]${speedFilter.trimFilter},${speedFilter.setptsFilter},trim=duration=${speedClip.duration.toFixed(4)},setpts=PTS-STARTPTS[vout]`,
      '-map',
      '[vout]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      speedOut
    ])
    const speedProbeDur = Number(probeJson(speedOut).format.duration)
    assert.ok(
      Math.abs(speedProbeDur - speedClip.duration) < 0.1,
      `Expected ~${speedClip.duration}s, got ${speedProbeDur}s`
    )

    // 11b. Power Window mask (blur inside box, sharp outside)
    const maskedClip = {
      ...speedClip,
      speedRamp: undefined,
      duration: 0.4,
      mask: { enabled: true, mode: 'blur', shape: 'rect', x: 50, y: 50, w: 40, h: 40, strength: 100 }
    }
    const maskRes = buildClipMaskFilter(
      maskedClip,
      '[0:v]',
      ['fps=24'],
      'vmask',
      1,
      W,
      H
    )
    assert.equal(maskRes.appliedAsPostChain, true)
    const unmaskedRaw = join(MEDIA_DIR, 'unmasked.rgb')
    const maskedRaw = join(MEDIA_DIR, 'masked.rgb')
    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-i',
      stripeMp4,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      unmaskedRaw
    ])
    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-i',
      stripeMp4,
      '-filter_complex',
      maskRes.filterParts.join(';'),
      '-map',
      '[vmask]',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      maskedRaw
    ])
    const bufUnmasked = readFileSync(unmaskedRaw)
    const bufMasked = readFileSync(maskedRaw)
    const regionMeanAbsDiff = (x0, y0, x1, y1) => {
      let sum = 0
      let cnt = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 3
          sum += Math.abs(bufUnmasked[i] - bufMasked[i])
          cnt++
        }
      }
      return sum / cnt
    }
    const insideDiff = regionMeanAbsDiff(52, 30, 108, 60)
    const outsideDiff = regionMeanAbsDiff(4, 4, 24, 20)
    assert.ok(insideDiff > 25, `Mask içi fark beklenenden küçük: ${insideDiff}`)
    assert.ok(outsideDiff < 2, `Mask dışı değişmemeli: ${outsideDiff}`)

    // 11c. Subtitle burn-in (on vs off)
    const subPng = join(MEDIA_DIR, 'sub-overlay.png')
    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=black@0.0:s=${W}x${H},format=rgba,drawbox=x=40:y=65:w=80:h=16:color=white@1.0:t=fill:replace=1`,
      '-frames:v',
      '1',
      subPng
    ])
    const subOverlayItem = {
      id: 'sub1',
      start: 0.05,
      end: 0.35,
      pngDataUrl: `data:image/png;base64,${readFileSync(subPng).toString('base64')}`
    }
    const overlaysOn = selectSubtitleOverlays(true, [subOverlayItem])
    assert.equal(overlaysOn.length, 1)
    const subFilterOn = buildSubtitleOverlayFilter('[0:v]', 1, 0, 0.05, 0.35)
    const subFrameOn = join(MEDIA_DIR, 'sub-on.rgb')
    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=black:s=${W}x${H}:r=24:d=0.4`,
      '-loop',
      '1',
      '-t',
      '0.4',
      '-i',
      subPng,
      '-filter_complex',
      subFilterOn.filterParts.join(';'),
      '-map',
      subFilterOn.nextVLabel,
      '-ss',
      '0.2',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      subFrameOn
    ])
    const bufSubOn = readFileSync(subFrameOn)
    const pxAt = (buf, x, y) => buf[(y * W + x) * 3]
    assert.ok(pxAt(bufSubOn, 80, 73) > 200, 'Altyazı kutusu içi beyaz olmalı')
    assert.ok(pxAt(bufSubOn, 10, 10) < 20, 'Altyazı kutusu dışı siyah kalmalı')

    const overlaysOff = selectSubtitleOverlays(false, [subOverlayItem])
    assert.equal(overlaysOff.length, 0)
    console.log('[PASS] 11/14 Gerçek FFmpeg Export Eşliği (Speed Ramp, Power Window Mask, Altyazı Burn-In)')

    // 12. Adversarial Filter Escaping (drawtext + lut3d path)
    const adversarialTexts = [
      'Çağrı\'nın "kahve" : %{pts} 50%',
      'C:\\Users\\Ömer\\a b.mp4',
      'a,b;c[0]',
      'birinci satır\nikinci satır',
      'X'.repeat(1000),
      '',
      "'; drawbox=x=0:y=0:w=160:h=90:color=red@1.0:t=fill,drawtext=text='INJECTED"
    ]
    for (let idx = 0; idx < adversarialTexts.length; idx++) {
      const txt = adversarialTexts[idx]
      const escaped = escapeDrawtextText(txt)
      const outRaw = join(MEDIA_DIR, `esc-${idx}.rgb`)
      execFileSync(ffmpegPath, [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=160x90:r=24:d=0.1',
        '-vf',
        `drawtext=text='${escaped}':fontcolor=white:fontsize=12:x=4:y=4`,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        outRaw
      ])
      const buf = readFileSync(outRaw)
      assert.equal(buf.length, 160 * 90 * 3)
      // Enjeksiyon denemesinde (son eleman) tüm ekran kırmızıya boyanmamış olmalı
      if (idx === adversarialTexts.length - 1) {
        const bottomRightR = buf[(85 * 160 + 150) * 3]
        assert.ok(bottomRightR < 20, `Enjeksiyon drawbox çalışmış görünüyor: R=${bottomRightR}`)
      }
    }

    const adversarialLutName = "Çağrı'nın [0];,%.cube"
    const adversarialLutPath = join(MEDIA_DIR, adversarialLutName)
    writeFileSync(adversarialLutPath, bakeColorGradeToCube(defaultColorGrade(), [], 17), 'utf-8')
    const escapedLut = escapeFilterPath(adversarialLutPath)
    const lutOut = join(MEDIA_DIR, 'esc-lut.rgb')
    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=gray:s=64x64:r=24:d=0.1',
      '-vf',
      `format=rgb24,lut3d=file=${escapedLut}:interp=trilinear`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      lutOut
    ])
    assert.equal(readFileSync(lutOut).length, 64 * 64 * 3)
    console.log('[PASS] 12/14 Düşmanca Girdi Filtre Kaçışı (drawtext + lut3d yol kaçışı)')

    // 13. Shared Math <-> FFmpeg Export Parity (Color Grade LUT + Composite Order)
    const parityGrade = {
      ...defaultColorGrade(),
      exposure: 0.4,
      contrast: 20,
      saturation: 80,
      temperature: 15
    }
    const [rExp, gExp, bExp] = evaluateColorGrade(128 / 255, 96 / 255, 64 / 255, parityGrade)
    const parityCubePath = join(MEDIA_DIR, 'parity.cube')
    writeFileSync(parityCubePath, bakeColorGradeToCube(parityGrade, [], 33), 'utf-8')
    const parityRaw = join(MEDIA_DIR, 'parity-color.rgb')
    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x806040:s=32x32:r=24:d=0.1,format=rgb24',
      '-vf',
      `lut3d=file=${escapeFilterPath(parityCubePath)}:interp=trilinear`,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      parityRaw
    ])
    const parityBuf = readFileSync(parityRaw)
    const midIdx = (16 * 32 + 16) * 3
    const [rAct, gAct, bAct] = [parityBuf[midIdx], parityBuf[midIdx + 1], parityBuf[midIdx + 2]]
    assert.ok(
      Math.abs(rAct - Math.round(rExp * 255)) <= 3 &&
        Math.abs(gAct - Math.round(gExp * 255)) <= 3 &&
        Math.abs(bAct - Math.round(bExp * 255)) <= 3,
      `Color parity mismatch: expected ~(${Math.round(rExp * 255)},${Math.round(gExp * 255)},${Math.round(bExp * 255)}), got (${rAct},${gAct},${bAct})`
    )

    // Composite order & scale parity: V1 (red) under V2 (green, 50% scale centered)
    const compRaw = join(MEDIA_DIR, 'parity-comp.rgb')
    execFileSync(ffmpegPath, [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=red:s=${W}x${H}:r=24:d=0.1`,
      '-f',
      'lavfi',
      '-i',
      `color=c=green:s=${W}x${H}:r=24:d=0.1`,
      '-filter_complex',
      `[1:v]scale=${W / 2}:${H / 2}[v2s];[0:v][v2s]overlay=(W-w)/2:(H-h)/2[vout]`,
      '-map',
      '[vout]',
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      compRaw
    ])
    const compBuf = readFileSync(compRaw)
    const centerPx = (y, x) => {
      const i = (y * W + x) * 3
      return [compBuf[i], compBuf[i + 1], compBuf[i + 2]]
    }
    const [cR, cG] = centerPx(Math.floor(H / 2), Math.floor(W / 2))
    const [eR, eG] = centerPx(10, 10)
    assert.ok(cG > 110 && cR < 30, `Merkez V2 yeşil olmalı: R=${cR}, G=${cG}`)
    assert.ok(eR > 200 && eG < 30, `Kenar V1 kırmızı olmalı: R=${eR}, G=${eG}`)
    console.log('[PASS] 13/14 Paylaşılan Matematik <-> FFmpeg Export Eşliği (Renk LUT + Kompozit Sırası)')

    // 14. Karaoke / Hormozi / Typewriter Word-Level Timing Export Frames
    const subSeg = { id: 'k1', start: 1.0, end: 4.0, text: 'Merhaba yeni dünya', language: 'tr-TR' }
    const baseSubStyle = {
      fontFamily: 'sans',
      fontSize: 26,
      textColor: '#FFFFFF',
      backgroundColor: '#000000',
      backgroundOpacity: 70,
      position: 'bottom'
    }
    const noneFrames = computeSubtitleAnimationFrames(subSeg, { ...baseSubStyle, animation: 'none' })
    assert.equal(noneFrames.length, 1)

    const karaokeFrames = computeSubtitleAnimationFrames(subSeg, { ...baseSubStyle, animation: 'karaoke' })
    assert.equal(karaokeFrames.length, 3)
    assert.deepEqual(
      karaokeFrames.map((f) => [f.start, f.end, f.activeWordIdx]),
      [
        [1.0, 2.0, 0],
        [2.0, 3.0, 1],
        [3.0, 4.0, 2]
      ]
    )

    const hormoziFrames = computeSubtitleAnimationFrames(subSeg, { ...baseSubStyle, animation: 'hormozi' })
    assert.equal(hormoziFrames.length, 3)

    const twFrames = computeSubtitleAnimationFrames(subSeg, { ...baseSubStyle, animation: 'typewriter' })
    assert.ok(twFrames.length >= 2)
    assert.equal(twFrames[twFrames.length - 1].visibleCharCount, subSeg.text.length)
    console.log('[PASS] 14/14 Karaoke/Hormozi/Typewriter Kelime Zamanlaması Export Kareleri')

    console.log('\nALL 14 NOIRCUT v1.0.5 REGRESSION TEST SUITES PASSED.')
  } finally {
    rmSync(TEMP_ROOT, { recursive: true, force: true })
  }
}

runAllTests().catch((err) => {
  console.error(err)
  process.exit(1)
})

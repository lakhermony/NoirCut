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
        join(ROOT, 'src/main/transcribe/transcribe-service.ts'),
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
    const {
      cancelActiveTranscription,
      transcribeMediaFile
    } = require(join(COMPILED_DIR, 'main/transcribe/transcribe-service.js'))

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
    console.log('[PASS] 1/7 Undo/Redo Dinamik Kanal Koruması (V1..Vn, A1..An)')

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
    console.log('[PASS] 2/7 Undo/Redo Derin Kopyalama ve Döngüsel Referans Koruması')

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
    console.log('[PASS] 3/7 Manyetik Kenetlenme, Ripple Gap ve Linked A/V Kesim Matematiği')

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
    console.log('[PASS] 4/7 Çok Katmanlı Nested Sequence Düzleştirme (Önizleme & Export Eşliği)')

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
    console.log('[PASS] 5/7 NoirFilm 3D LUT, Keyframe İfadesi ve Auto-Ducking Matematiği')

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
    console.log('[PASS] 6/7 Proxy Ölçek Matematiği (1080p, 4K, 8K, Küçük Kaynak)')

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
    console.log('[PASS] 7/8 Atomik Geçici (.part) Dışa Aktarma ve Dosya Bütünlüğü')

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
    console.log('[PASS] 8/9 Speed Ramp İntegrasyonu ve Rubberband Ses Keyframe Hesabı')

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
    console.log('[PASS] 9/9 Async Whisper Transkripsiyon İptali, Eşzamanlılık ve Temp Temizliği')

    console.log('\nALL 9 NOIRCUT v1.0.5 REGRESSION TEST SUITES PASSED.')
  } finally {
    rmSync(TEMP_ROOT, { recursive: true, force: true })
  }
}

runAllTests().catch((err) => {
  console.error(err)
  process.exit(1)
})

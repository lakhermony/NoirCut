/**
 * NoirAudio Engine — Web Audio API tabanlı gerçek zamanlı NLE ses işleme motoru.
 *
 * Özellikler:
 * - Tekil (singleton) 48kHz AudioContext yönetimi ve otomatik resume()
 * - WeakMap tabanlı HTMLMediaElement -> MediaElementAudioSourceNode önbelleği (InvalidStateError korumalı)
 * - Kanal/Slot bazlı DSP şeridi:
 *   1) Pre-Gain (+12 dB'ye kadar gerçek kazanç ve üçgen Fade In/Out zarfı)
 *   2) Noise Reduction (85Hz Highpass + 11.5kHz Lowpass + 4.5kHz Presence/Hiss yumuşatma)
 *   3) 3-Bant Parametrik EQ (100Hz Low · 1kHz Mid · 8kHz High + Bass Boost preset desteği)
 *   4) Compressor (DynamicsCompressorNode: threshold, ratio, 15ms attack, 180ms release)
 *   5) Reverb (60ms & 110ms çift kademeli yankı + 3.8kHz sönümleme, FFmpeg aecho uyumlu)
 *   6) Brickwall Limiter (Fast 20:1 DynamicsCompressorNode)
 *   7) Stereo Pan (StereoPannerNode: -100 Sol .. +100 Sağ)
 *   8) Post-Gain (Auto-Ducking, Mute/Solo ve A/B tampon geçişleri için 12ms yumuşatmalı)
 * - Master Bus (Master Fader -36..+12 dB + gerçek zamanlı AnalyserNode tepe/RMS ölçümü)
 */
import {
  dbToGain,
  defaultAudioEffectsChain,
  type AudioEffectsChain,
  type AudioFxPreset,
  type TimelineClip
} from '../../../shared/timeline'

interface ChannelStripNodes {
  source: MediaElementAudioSourceNode
  preGain: GainNode
  hpf: BiquadFilterNode
  lpf: BiquadFilterNode
  hissDip: BiquadFilterNode
  eqLow: BiquadFilterNode
  eqMid: BiquadFilterNode
  eqHigh: BiquadFilterNode
  compressor: DynamicsCompressorNode
  dryGain: GainNode
  wetGain: GainNode
  delay60: DelayNode
  delay110: DelayNode
  fb60: GainNode
  fb110: GainNode
  reverbDamp: BiquadFilterNode
  limiter: DynamicsCompressorNode
  panner: StereoPannerNode
  postGain: GainNode
  analyser: AnalyserNode
  meterBuf: Float32Array<ArrayBuffer>
}

export class NoirAudioEngine {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private masterAnalyser: AnalyserNode | null = null
  private masterMeterBuf: Float32Array<ArrayBuffer> | null = null
  private failed = false

  /** Bir HTMLMediaElement üzerinde createMediaElementSource yalnızca bir kez çağrılabilir */
  private readonly stripMap = new WeakMap<HTMLMediaElement, ChannelStripNodes>()
  /** Kanal kimliği (V1, A1, A2...) -> o kanalda en son aktif olan şerit (canlı VU/Peak okuması için) */
  private readonly activeLaneStrips = new Map<string, ChannelStripNodes>()

  private ensureContext(): AudioContext | null {
    if (this.failed) return null
    if (this.ctx) return this.ctx
    if (typeof window === 'undefined') return null
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) {
      this.failed = true
      return null
    }
    try {
      const ctx = new AudioCtx({ latencyHint: 'interactive', sampleRate: 48000 })
      const masterGain = ctx.createGain()
      masterGain.gain.value = 1

      const masterAnalyser = ctx.createAnalyser()
      masterAnalyser.fftSize = 256
      masterAnalyser.smoothingTimeConstant = 0.65

      masterGain.connect(masterAnalyser)
      masterAnalyser.connect(ctx.destination)

      this.ctx = ctx
      this.masterGain = masterGain
      this.masterAnalyser = masterAnalyser
      this.masterMeterBuf = new Float32Array(new ArrayBuffer(masterAnalyser.fftSize * 4))
      return ctx
    } catch {
      this.failed = true
      return null
    }
  }

  public resume(): void {
    const ctx = this.ensureContext()
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {})
    }
  }

  private getOrCreateStrip(el: HTMLMediaElement): ChannelStripNodes | null {
    const existing = this.stripMap.get(el)
    if (existing) return existing

    const ctx = this.ensureContext()
    if (!ctx || !this.masterGain) return null

    try {
      // crossOrigin özniteliği yoksa yerel noircut-media:// için güvenli olarak ata
      if (!el.crossOrigin) {
        el.crossOrigin = 'anonymous'
      }
      const source = ctx.createMediaElementSource(el)
      const preGain = ctx.createGain()
      preGain.gain.value = 1

      // 1) Noise Reduction filtreleri (varsayılan: şeffaf bypass)
      const hpf = ctx.createBiquadFilter()
      hpf.type = 'highpass'
      hpf.frequency.value = 10
      hpf.Q.value = 0.707

      const lpf = ctx.createBiquadFilter()
      lpf.type = 'lowpass'
      lpf.frequency.value = 22050
      lpf.Q.value = 0.707

      const hissDip = ctx.createBiquadFilter()
      hissDip.type = 'peaking'
      hissDip.frequency.value = 4500
      hissDip.Q.value = 1.8
      hissDip.gain.value = 0

      // 2) 3-Bant Parametrik EQ (100Hz, 1kHz, 8kHz — FFmpeg equalizer ile uyumlu)
      const eqLow = ctx.createBiquadFilter()
      eqLow.type = 'peaking'
      eqLow.frequency.value = 100
      eqLow.Q.value = 0.85
      eqLow.gain.value = 0

      const eqMid = ctx.createBiquadFilter()
      eqMid.type = 'peaking'
      eqMid.frequency.value = 1000
      eqMid.Q.value = 1.2
      eqMid.gain.value = 0

      const eqHigh = ctx.createBiquadFilter()
      eqHigh.type = 'peaking'
      eqHigh.frequency.value = 8000
      eqHigh.Q.value = 1.0
      eqHigh.gain.value = 0

      // 3) Compressor
      const compressor = ctx.createDynamicsCompressor()
      compressor.threshold.value = 0
      compressor.knee.value = 6
      compressor.ratio.value = 1
      compressor.attack.value = 0.015
      compressor.release.value = 0.18

      // 4) Reverb (60ms & 110ms çift kademeli yankı — FFmpeg aecho=0.8:outG:60|110:dec1|dec2)
      const dryGain = ctx.createGain()
      dryGain.gain.value = 1

      const wetGain = ctx.createGain()
      wetGain.gain.value = 0

      const delay60 = ctx.createDelay(0.5)
      delay60.delayTime.value = 0.06

      const delay110 = ctx.createDelay(0.5)
      delay110.delayTime.value = 0.11

      const fb60 = ctx.createGain()
      fb60.gain.value = 0.25

      const fb110 = ctx.createGain()
      fb110.gain.value = 0.18

      const reverbDamp = ctx.createBiquadFilter()
      reverbDamp.type = 'lowpass'
      reverbDamp.frequency.value = 3800

      // 5) Brickwall Limiter (hızlı 20:1 kompresör)
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = 0
      limiter.knee.value = 0
      limiter.ratio.value = 1
      limiter.attack.value = 0.001
      limiter.release.value = 0.06

      // 6) Stereo Pan & Post-Gain & Kanal Analyser
      const panner = ctx.createStereoPanner()
      panner.pan.value = 0

      const postGain = ctx.createGain()
      postGain.gain.value = 1

      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.65

      // Bağlantı Topolojisi
      source.connect(preGain)
      preGain.connect(hpf)
      hpf.connect(lpf)
      lpf.connect(hissDip)
      hissDip.connect(eqLow)
      eqLow.connect(eqMid)
      eqMid.connect(eqHigh)
      eqHigh.connect(compressor)

      // Kuru (Dry) hat
      compressor.connect(dryGain)
      dryGain.connect(limiter)

      // Islak (Wet Reverb) hat
      compressor.connect(delay60)
      compressor.connect(delay110)
      delay60.connect(fb60)
      delay110.connect(fb110)
      fb60.connect(reverbDamp)
      fb110.connect(reverbDamp)
      reverbDamp.connect(wetGain)
      // Hafif geri besleme döngüsü
      reverbDamp.connect(delay110)
      wetGain.connect(limiter)

      limiter.connect(panner)
      panner.connect(postGain)
      postGain.connect(analyser)
      analyser.connect(this.masterGain)

      const strip: ChannelStripNodes = {
        source,
        preGain,
        hpf,
        lpf,
        hissDip,
        eqLow,
        eqMid,
        eqHigh,
        compressor,
        dryGain,
        wetGain,
        delay60,
        delay110,
        fb60,
        fb110,
        reverbDamp,
        limiter,
        panner,
        postGain,
        analyser,
        meterBuf: new Float32Array(new ArrayBuffer(analyser.fftSize * 4))
      }
      this.stripMap.set(el, strip)
      return strip
    } catch {
      return null
    }
  }

  /**
   * Her RAF / syncElement adımında ilgili HTMLMediaElement'in kazanç, pan, fade,
   * auto-ducking, DSP zinciri ve master bus parametrelerini tıklamasız (smoothed) günceller.
   * Web Audio bağlanabilmişse `true`, fallback (HTML5 el.volume) gerekiyorsa `false` döner.
   */
  public syncElementAudio(
    el: HTMLMediaElement,
    clip: TimelineClip | undefined,
    clipLinearGain: number,
    postMultiplier: number,
    masterGainDb: number,
    isSilent: boolean
  ): boolean {
    const strip = this.getOrCreateStrip(el)
    if (!strip || !this.ctx || !this.masterGain) return false

    const now = this.ctx.currentTime
    const tau = 0.012 // 12ms tıklama önleyici yumuşatma sabiti

    // Master Bus kazancını güncelle (-36..+12 dB)
    const masterLin = dbToGain(masterGainDb)
    this.masterGain.gain.setTargetAtTime(masterLin, now, tau)

    if (!clip || isSilent) {
      strip.postGain.gain.setTargetAtTime(0, now, 0.008)
      return true
    }

    // HTML5 medya elementinin kendi sesini 1.0'da sabit tut (+12 dB headroom Web Audio preGain üzerinden sağlanır)
    el.muted = false
    if (Math.abs(el.volume - 1) > 0.01) {
      el.volume = 1
    }

    this.activeLaneStrips.set(clip.lane, strip)

    const fx: AudioEffectsChain = clip.audioEffects ?? defaultAudioEffectsChain()
    const preset: AudioFxPreset = clip.audioPreset ?? 'none'

    // 1) Pre-Gain (klip gainDb + fadeIn/fadeOut zarfı, 0..4x)
    const safePreGain = Math.max(0, Math.min(4.5, clipLinearGain))
    strip.preGain.gain.setTargetAtTime(safePreGain, now, tau)

    // 2) Noise Reduction (85Hz HPF + 11.5kHz LPF + 4.5kHz Hiss Dip)
    const denoiseOn = Boolean(fx.noiseReduction || preset === 'denoise')
    strip.hpf.frequency.setTargetAtTime(denoiseOn ? 85 : 10, now, tau)
    strip.lpf.frequency.setTargetAtTime(denoiseOn ? 11500 : 22050, now, tau)
    strip.hissDip.gain.setTargetAtTime(denoiseOn ? -2.5 : 0, now, tau)

    // 3) 3-Bant Parametrik EQ + Bass Boost Preset
    const lowBoost = preset === 'bass-boost' ? 7 : 0
    strip.eqLow.gain.setTargetAtTime(
      Math.max(-18, Math.min(18, (fx.eqLowDb || 0) + lowBoost)),
      now,
      tau
    )
    strip.eqMid.gain.setTargetAtTime(Math.max(-18, Math.min(18, fx.eqMidDb || 0)), now, tau)
    strip.eqHigh.gain.setTargetAtTime(Math.max(-18, Math.min(18, fx.eqHighDb || 0)), now, tau)

    // 4) Compressor
    if (fx.compressorEnabled) {
      strip.compressor.threshold.setTargetAtTime(
        Math.max(-60, Math.min(0, fx.compressorThresholdDb ?? -18)),
        now,
        tau
      )
      strip.compressor.ratio.setTargetAtTime(
        Math.max(1, Math.min(20, fx.compressorRatio ?? 3)),
        now,
        tau
      )
    } else {
      strip.compressor.threshold.setTargetAtTime(0, now, tau)
      strip.compressor.ratio.setTargetAtTime(1, now, tau)
    }

    // 5) Reverb (FFmpeg aecho=0.8:outG:60|110:dec1|dec2 eşleşmesi)
    const revMix = Math.max(0, Math.min(100, fx.reverbMix ?? 0))
    if (revMix > 1) {
      const dry = Math.max(0.3, 1 - (revMix / 100) * 0.35)
      const dec = Math.max(0.05, Math.min(0.85, (revMix / 100) * 0.65))
      strip.dryGain.gain.setTargetAtTime(dry, now, tau)
      strip.wetGain.gain.setTargetAtTime(dec * 0.85, now, tau)
      strip.fb60.gain.setTargetAtTime(dec, now, tau)
      strip.fb110.gain.setTargetAtTime(dec * 0.7, now, tau)
    } else {
      strip.dryGain.gain.setTargetAtTime(1, now, tau)
      strip.wetGain.gain.setTargetAtTime(0, now, tau)
    }

    // 6) Brickwall Limiter
    if (fx.limiterEnabled) {
      strip.limiter.threshold.setTargetAtTime(
        Math.max(-24, Math.min(0, fx.limiterCeilingDb ?? -1)),
        now,
        tau
      )
      strip.limiter.ratio.setTargetAtTime(20, now, tau)
    } else {
      strip.limiter.threshold.setTargetAtTime(0, now, tau)
      strip.limiter.ratio.setTargetAtTime(1, now, tau)
    }

    // 7) Stereo Pan (-100..+100 -> -1..+1)
    const panNorm = Math.max(-1, Math.min(1, (clip.pan ?? 0) / 100))
    strip.panner.pan.setTargetAtTime(panNorm, now, tau)

    // 8) Post-Gain (Auto-Ducking & Kanal Audibility)
    strip.postGain.gain.setTargetAtTime(Math.max(0, Math.min(2, postMultiplier)), now, tau)

    return true
  }

  /** İlgili kanalın gerçek zamanlı DSP sonrası tepe (peak dBFS) değerini okur (yoksa null). */
  public readLanePeakDb(laneId: string): number | null {
    const strip = this.activeLaneStrips.get(laneId)
    if (!strip || !this.ctx || this.ctx.state !== 'running') return null
    strip.analyser.getFloatTimeDomainData(strip.meterBuf)
    let peak = 0
    for (let i = 0; i < strip.meterBuf.length; i++) {
      const abs = Math.abs(strip.meterBuf[i])
      if (abs > peak) peak = abs
    }
    if (peak <= 0.0001) return -60
    return Math.max(-60, Math.min(6, 20 * Math.log10(peak)))
  }

  /** Master Bus gerçek zamanlı DSP sonrası tepe (peak dBFS) değerini okur (yoksa null). */
  public readMasterPeakDb(): number | null {
    if (!this.masterAnalyser || !this.masterMeterBuf || !this.ctx || this.ctx.state !== 'running') {
      return null
    }
    this.masterAnalyser.getFloatTimeDomainData(this.masterMeterBuf)
    let peak = 0
    for (let i = 0; i < this.masterMeterBuf.length; i++) {
      const abs = Math.abs(this.masterMeterBuf[i])
      if (abs > peak) peak = abs
    }
    if (peak <= 0.0001) return -60
    return Math.max(-60, Math.min(6, 20 * Math.log10(peak)))
  }
}

export const noirAudioEngine = new NoirAudioEngine()

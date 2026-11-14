/**
 * Web Audio API ile gerçek zamanlı Foley SFX sentez motoru.
 * Harici ses dosyasına ihtiyaç duymadan daktilo tuş/zil sesi ve 35mm projektör uğultusu üretir.
 */

class FoleyEngine {
  private ctx: AudioContext | null = null
  private noiseBuf: AudioBuffer | null = null
  private projectorActive = false
  private projectorGain: GainNode | null = null
  private projectorStoppers: Array<() => void> = []

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return null
      this.ctx = new Ctx()
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {})
    }
    if (!this.noiseBuf && this.ctx) {
      const len = Math.floor(this.ctx.sampleRate * 0.5)
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1
      }
      this.noiseBuf = buf
    }
    return this.ctx
  }

  triggerTypewriterKey(volume01: number, isLineEnd = false): void {
    const vol = Math.max(0, Math.min(1, volume01))
    if (vol <= 0.005) return
    const ctx = this.ensureContext()
    if (!ctx || !this.noiseBuf) return

    const now = ctx.currentTime

    // 1) Mekanik tuş darbesi (bandpass gürültü)
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(1600 + Math.random() * 900, now)
    filter.Q.setValueAtTime(1.8, now)

    const clickGain = ctx.createGain()
    clickGain.gain.setValueAtTime(0.32 * vol, now)
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022)

    src.connect(filter)
    filter.connect(clickGain)
    clickGain.connect(ctx.destination)
    src.start(now, Math.random() * 0.25, 0.025)

    // 2) Gövde tok sesi
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(175 + Math.random() * 35, now)
    osc.frequency.exponentialRampToValueAtTime(65, now + 0.024)

    const bodyGain = ctx.createGain()
    bodyGain.gain.setValueAtTime(0.22 * vol, now)
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.026)

    osc.connect(bodyGain)
    bodyGain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.028)

    // 3) Satır sonu hafif şaryo/zil tınısı
    if (isLineEnd) {
      const bell1 = ctx.createOscillator()
      const bell2 = ctx.createOscillator()
      bell1.type = 'sine'
      bell2.type = 'sine'
      bell1.frequency.setValueAtTime(2420, now)
      bell2.frequency.setValueAtTime(3630, now)

      const bellGain = ctx.createGain()
      bellGain.gain.setValueAtTime(0.09 * vol, now)
      bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)

      bell1.connect(bellGain)
      bell2.connect(bellGain)
      bellGain.connect(ctx.destination)
      bell1.start(now)
      bell2.start(now)
      bell1.stop(now + 0.32)
      bell2.stop(now + 0.32)
    }
  }

  setProjectorRunning(active: boolean, volume01: number): void {
    const vol = Math.max(0, Math.min(1, volume01))
    if (!active || vol <= 0.005) {
      this.stopProjector()
      return
    }
    const ctx = this.ensureContext()
    if (!ctx || !this.noiseBuf) return

    if (this.projectorActive && this.projectorGain) {
      this.projectorGain.gain.setTargetAtTime(0.14 * vol, ctx.currentTime, 0.05)
      return
    }

    this.projectorActive = true
    const now = ctx.currentTime
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.0001, now)
    master.gain.linearRampToValueAtTime(0.14 * vol, now + 0.15)
    master.connect(ctx.destination)
    this.projectorGain = master

    // Sıcak motor uğultusu (58Hz + 116Hz)
    const hum1 = ctx.createOscillator()
    hum1.type = 'sine'
    hum1.frequency.setValueAtTime(58, now)
    const hum2 = ctx.createOscillator()
    hum2.type = 'triangle'
    hum2.frequency.setValueAtTime(116, now)

    const humFilter = ctx.createBiquadFilter()
    humFilter.type = 'lowpass'
    humFilter.frequency.setValueAtTime(190, now)

    const humGain = ctx.createGain()
    humGain.gain.setValueAtTime(0.35, now)

    hum1.connect(humFilter)
    hum2.connect(humFilter)
    humFilter.connect(humGain)
    humGain.connect(master)
    hum1.start(now)
    hum2.start(now)

    // 24fps organik mekanik tıkırtı döngüsü
    const noiseSrc = ctx.createBufferSource()
    noiseSrc.buffer = this.noiseBuf
    noiseSrc.loop = true

    const noiseFilter = ctx.createBiquadFilter()
    noiseFilter.type = 'bandpass'
    noiseFilter.frequency.setValueAtTime(620, now)
    noiseFilter.Q.setValueAtTime(1.2, now)

    const lfo = ctx.createOscillator()
    lfo.type = 'sawtooth'
    lfo.frequency.setValueAtTime(24, now)

    const lfoGain = ctx.createGain()
    lfoGain.gain.setValueAtTime(0.22, now)

    const shutterGain = ctx.createGain()
    shutterGain.gain.setValueAtTime(0.18, now)

    lfo.connect(lfoGain)
    lfoGain.connect(shutterGain.gain)
    noiseSrc.connect(noiseFilter)
    noiseFilter.connect(shutterGain)
    shutterGain.connect(master)

    lfo.start(now)
    noiseSrc.start(now)

    this.projectorStoppers = [
      () => {
        try {
          hum1.stop()
          hum2.stop()
          lfo.stop()
          noiseSrc.stop()
          master.disconnect()
        } catch {
          // yoksay
        }
      }
    ]
  }

  stopProjector(): void {
    if (!this.projectorActive) return
    this.projectorActive = false
    for (const stop of this.projectorStoppers) stop()
    this.projectorStoppers = []
    this.projectorGain = null
  }
}

export const foleyAudio = new FoleyEngine()

export type Mixer = { context: AudioContext; bus: AudioNode; noise: AudioBuffer; startAt: number }

type Envelope = { at?: number; attack?: number; hold?: number; decay: number; peak: number }

export type ToneVoice = Envelope & { frequency: number; glideTo?: number; wave?: OscillatorType }

export type NoiseVoice = Envelope & { frequency: number; glideTo?: number; q?: number; filter?: BiquadFilterType }

const SILENT = 0.0001
const TAIL_SECONDS = 0.02

function shapeGain(gain: GainNode, start: number, attack: number, hold: number, decay: number, peak: number): void {
  gain.gain.setValueAtTime(SILENT, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + attack)
  if (hold) gain.gain.setValueAtTime(peak, start + attack + hold)
  gain.gain.exponentialRampToValueAtTime(SILENT, start + attack + hold + decay)
}

export function tone({ context, bus, startAt }: Mixer, { frequency, glideTo, wave = "sine", at = 0, attack = 0.003, hold = 0, decay, peak }: ToneVoice): void {
  const start = startAt + at
  const end = start + attack + hold + decay
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = wave
  oscillator.frequency.setValueAtTime(frequency, start)
  if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, end)
  shapeGain(gain, start, attack, hold, decay, peak)
  oscillator.connect(gain).connect(bus)
  oscillator.start(start)
  oscillator.stop(end + TAIL_SECONDS)
}

export function noise({ context, bus, noise: buffer, startAt }: Mixer, { frequency, glideTo, q = 1, filter = "bandpass", at = 0, attack = 0.001, hold = 0, decay, peak }: NoiseVoice): void {
  const start = startAt + at
  const end = start + attack + hold + decay
  const source = context.createBufferSource()
  const band = context.createBiquadFilter()
  const gain = context.createGain()
  source.buffer = buffer
  source.loop = true
  band.type = filter
  band.Q.value = q
  band.frequency.setValueAtTime(frequency, start)
  if (glideTo) band.frequency.exponentialRampToValueAtTime(glideTo, end)
  shapeGain(gain, start, attack, hold, decay, peak)
  source.connect(band).connect(gain).connect(bus)
  source.start(start, Math.random() * 0.3)
  source.stop(end + TAIL_SECONDS)
}

export function bell(mixer: Mixer, frequency: number, at: number, peak: number, decay = 0.4): void {
  tone(mixer, { frequency, at, attack: 0.004, decay, peak })
  tone(mixer, { frequency: frequency * 2.01, at, attack: 0.002, decay: decay * 0.45, peak: peak * 0.18 })
}

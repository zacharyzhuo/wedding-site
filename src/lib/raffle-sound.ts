// Programmatic raffle sound effects for the /screen big-screen view.
//
// Why synthesised (Web Audio) rather than <audio src="*.mp3">:
//   * zero assets — nothing to fetch, so a flaky venue Wi-Fi can't mute the
//     draw. The screen already tolerates network blips (it swallows failed
//     polls); the sound shouldn't be the one thing that hard-depends on a GET.
//   * perfect sync — fired inline with the reveal animation, no load/decode
//     latency between "winner picked" and the fanfare.
//   * no codec/format concerns, tiny, committable.
//
// Browser autoplay policy blocks all sound until a user gesture, so /screen
// shows a one-time "tap to start" overlay whose click calls unlock(). Every
// function below no-ops safely until then and NEVER throws into the render
// loop — audio is a nice-to-have, a muted draw must still look right.

let ctx: AudioContext | null = null
let master: GainNode | null = null

// Master level for all SFX. The venue PA / laptop system volume is the real
// loudness control; this just keeps the mix from clipping.
const MASTER_GAIN = 0.32

type AudioCtor = typeof AudioContext

function audioCtor(): AudioCtor | undefined {
  if (typeof window === 'undefined') return undefined
  return window.AudioContext
    || (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext
}

// Must be called from inside a user-gesture handler (the tap-to-start click).
export function unlock(): void {
  try {
    if (!ctx) {
      const Ctor = audioCtor()
      if (!Ctor) return
      ctx = new Ctor()
      master = ctx.createGain()
      master.gain.value = MASTER_GAIN
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    // Silent 10ms blip so iOS/Safari fully arms the context inside the gesture.
    const g = ctx.createGain()
    g.gain.value = 0
    const o = ctx.createOscillator()
    o.connect(g)
    g.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.01)
  } catch {
    // never let audio setup break the screen
  }
}

export function isUnlocked(): boolean {
  return !!ctx && ctx.state === 'running'
}

// One shaped tone: attack to `peak`, exponential decay to silence over `dur`.
// `startAt` is an offset (seconds) from now, so a caller can schedule a whole
// arpeggio in one synchronous pass.
function tone(
  startAt: number,
  freq: number,
  dur: number,
  peak: number,
  type: OscillatorType = 'triangle',
): void {
  if (!ctx || !master) return
  const t0 = ctx.currentTime + startAt
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g)
  g.connect(master)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

// Per-spin slot-machine tick. The roll decelerates (spins space out), so the
// ticks naturally slow down too — that spacing is the tension, no pitch trick
// needed. Fires ~20-25× over the ~3s roll.
export function playTick(): void {
  try {
    tone(0, 1000, 0.045, 0.4, 'square')
  } catch {
    // noop
  }
}

// Winner reveal: rising C-major arpeggio (C5-E5-G5-C6), a held triad under it,
// and a high sparkle on top. The celebratory "叮叮叮～登！".
export function playReveal(): void {
  try {
    const arp = [523.25, 659.25, 783.99, 1046.5]
    arp.forEach((f, i) => tone(i * 0.11, f, 0.5, 0.5, 'triangle'))
    const chordAt = arp.length * 0.11
    ;[523.25, 659.25, 783.99].forEach(f => tone(chordAt, f, 1.4, 0.3, 'sine'))
    tone(chordAt + 0.05, 1567.98, 1.2, 0.2, 'sine') // shimmer
  } catch {
    // noop
  }
}

// Gentle two-note chime when raffle mode turns on (抽獎時間 appears) — a soft
// "get ready" cue, deliberately not startling.
export function playStandby(): void {
  try {
    tone(0, 783.99, 0.5, 0.35, 'sine')   // G5
    tone(0.16, 1046.5, 0.7, 0.35, 'sine') // C6
  } catch {
    // noop
  }
}

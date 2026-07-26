import { useEffect, useRef, useState, useCallback } from 'react'

interface Props {
  videoEl: HTMLVideoElement | null
  muted?: boolean
  className?: string
}

const BARS = 16
const PEAK_HOLD_MS = 1000

function dbToBar(db: number): number {
  const clamped = Math.max(-60, Math.min(0, db))
  return Math.round(((clamped + 60) / 60) * (BARS - 1))
}

function segColor(i: number): string {
  if (i >= BARS - 2) return '#ef4444'
  if (i >= BARS - 5) return '#f59e0b'
  return '#22c55e'
}

function Bar({ db, peak, label }: { db: number; peak: number; label: string }) {
  const active = dbToBar(db)
  const peakIdx = dbToBar(peak)
  return (
    <div className="flex items-center gap-0.5">
      <span className="text-[8px] text-gray-600 font-mono w-2 leading-none">{label}</span>
      <div className="flex gap-px items-center">
        {Array.from({ length: BARS }, (_, i) => (
          <div
            key={i}
            style={{
              width: 3,
              height: i === peakIdx ? 5 : 4,
              borderRadius: 0.5,
              backgroundColor:
                i === peakIdx
                  ? segColor(i)
                  : i <= active
                    ? segColor(i)
                    : 'rgba(255,255,255,0.07)',
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function VuMeter({ videoEl, muted = true, className }: Props) {
  const [levels, setLevels] = useState<[number, number]>([-60, -60])
  const [peaks, setPeaks] = useState<[number, number]>([-60, -60])

  const ctxRef      = useRef<AudioContext | null>(null)
  const gainRef     = useRef<GainNode | null>(null)
  const sourceRef   = useRef<MediaElementAudioSourceNode | null>(null)
  const analyserL   = useRef<AnalyserNode | null>(null)
  const analyserR   = useRef<AnalyserNode | null>(null)
  const rafRef      = useRef<number>(0)
  const peakTimers  = useRef<[number, number]>([0, 0])
  const peakVals    = useRef<[number, number]>([-60, -60])

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    try { sourceRef.current?.disconnect() } catch {}
    try { ctxRef.current?.close() } catch {}
    ctxRef.current    = null
    sourceRef.current = null
    gainRef.current   = null
    analyserL.current = null
    analyserR.current = null
  }, [])

  useEffect(() => {
    if (!videoEl) return
    teardown()

    let alive = true
    const ctx = new AudioContext()
    ctxRef.current = ctx

    const resume = () => { if (ctx.state === 'suspended') ctx.resume() }
    videoEl.addEventListener('play', resume)

    const src = ctx.createMediaElementSource(videoEl)
    sourceRef.current = src

    const splitter = ctx.createChannelSplitter(2)
    const aL = ctx.createAnalyser()
    const aR = ctx.createAnalyser()
    aL.fftSize = 256
    aR.fftSize = 256
    analyserL.current = aL
    analyserR.current = aR

    const gain = ctx.createGain()
    gain.gain.value = muted ? 0 : 1
    gainRef.current = gain

    // signal chain: src → splitter → analysers (for VU, always active)
    //                             → gain → destination (for monitoring, mutable)
    src.connect(splitter)
    splitter.connect(aL, 0)
    splitter.connect(aR, 1)
    src.connect(gain)
    gain.connect(ctx.destination)

    const buf = new Float32Array(aL.fftSize)

    function getRms(analyser: AnalyserNode): number {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      if (rms === 0) return -60
      return Math.max(-60, Math.min(0, 20 * Math.log10(rms)))
    }

    function tick() {
      if (!alive) return
      if (!analyserL.current || !analyserR.current) return
      const now = performance.now()
      const dbL = getRms(analyserL.current)
      const dbR = getRms(analyserR.current)

      // Peak hold
      if (dbL > peakVals.current[0]) { peakVals.current[0] = dbL; peakTimers.current[0] = now }
      if (dbR > peakVals.current[1]) { peakVals.current[1] = dbR; peakTimers.current[1] = now }
      if (now - peakTimers.current[0] > PEAK_HOLD_MS) peakVals.current[0] = dbL
      if (now - peakTimers.current[1] > PEAK_HOLD_MS) peakVals.current[1] = dbR

      setLevels([dbL, dbR])
      setPeaks([peakVals.current[0], peakVals.current[1]])
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    if (ctx.state === 'running') resume()

    return () => {
      alive = false
      videoEl.removeEventListener('play', resume)
      teardown()
    }
  }, [videoEl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Controla volume sem recriar o grafo
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = muted ? 0 : 1
  }, [muted])

  return (
    <div className={`flex flex-col gap-px ${className ?? ''}`}>
      <Bar db={levels[0]} peak={peaks[0]} label="L" />
      <Bar db={levels[1]} peak={peaks[1]} label="R" />
    </div>
  )
}

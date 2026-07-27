import { useEffect, useRef, useState, useCallback } from 'react'

interface Props {
  videoEl: HTMLVideoElement | null
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
                i === peakIdx ? segColor(i) : i <= active ? segColor(i) : 'rgba(255,255,255,0.07)',
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function VuMeter({ videoEl, className }: Props) {
  const [levels, setLevels] = useState<[number, number]>([-60, -60])
  const [peaks, setPeaks] = useState<[number, number]>([-60, -60])

  const ctxRef      = useRef<AudioContext | null>(null)
  const sourceRef   = useRef<MediaElementAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef      = useRef<number>(0)
  const peakTimers  = useRef<[number, number]>([0, 0])
  const peakVals    = useRef<[number, number]>([-60, -60])
  const aliveRef    = useRef(false)

  const teardown = useCallback(() => {
    aliveRef.current = false
    cancelAnimationFrame(rafRef.current)
    try { sourceRef.current?.disconnect() } catch {}
    try { ctxRef.current?.close() } catch {}
    ctxRef.current      = null
    sourceRef.current   = null
    analyserRef.current = null
  }, [])

  useEffect(() => {
    if (!videoEl) { teardown(); return }
    teardown()
    aliveRef.current = true

    const ctx = new AudioContext()
    ctxRef.current = ctx

    const resumeCtx = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}) }
    videoEl.addEventListener('play', resumeCtx)

    let src: MediaElementAudioSourceNode
    try {
      src = ctx.createMediaElementSource(videoEl)
    } catch {
      teardown()
      return
    }
    sourceRef.current = src

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyserRef.current = analyser

    // Análise pura — não conecta ao destination, não afeta volume do player
    src.connect(analyser)
    resumeCtx()

    const buf = new Float32Array(analyser.fftSize)
    function getRms(): number {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      return rms < 1e-6 ? -60 : Math.max(-60, Math.min(0, 20 * Math.log10(rms)))
    }

    function tick() {
      if (!aliveRef.current) return
      const now = performance.now()
      const db = getRms()
      if (db > peakVals.current[0]) { peakVals.current[0] = db; peakTimers.current[0] = now }
      if (db > peakVals.current[1]) { peakVals.current[1] = db; peakTimers.current[1] = now }
      if (now - peakTimers.current[0] > PEAK_HOLD_MS) peakVals.current[0] = db
      if (now - peakTimers.current[1] > PEAK_HOLD_MS) peakVals.current[1] = db
      setLevels([db, db])
      setPeaks([peakVals.current[0], peakVals.current[1]])
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      videoEl.removeEventListener('play', resumeCtx)
      teardown()
    }
  }, [videoEl]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`flex flex-col gap-px ${className ?? ''}`}>
      <Bar db={levels[0]} peak={peaks[0]} label="L" />
      <Bar db={levels[1]} peak={peaks[1]} label="R" />
    </div>
  )
}

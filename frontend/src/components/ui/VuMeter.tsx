import { useEffect, useRef, useState, useCallback } from 'react'

interface Props {
  videoEl: HTMLVideoElement | null
  className?: string
}

const BARS = 16
const PEAK_HOLD_MS = 1200

function dbToBar(db: number): number {
  const clamped = Math.max(-60, Math.min(0, db))
  return Math.round(((clamped + 60) / 60) * (BARS - 1))
}

function segColor(i: number): string {
  if (i >= BARS - 2) return '#ef4444'   // vermelho: ~0 dBFS
  if (i >= BARS - 5) return '#f59e0b'   // amarelo: ~ -9 dBFS
  return '#22c55e'                       // verde
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

export function VuMeter({ videoEl, className }: Props) {
  const [levels, setLevels] = useState<[number, number]>([-60, -60])
  const [peaks, setPeaks] = useState<[number, number]>([-60, -60])
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserLRef = useRef<AnalyserNode | null>(null)
  const analyserRRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number>(0)
  const peakTimerRef = useRef<[number, number]>([0, 0])

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    ctxRef.current?.close()
    ctxRef.current = null
    analyserLRef.current = null
    analyserRRef.current = null
  }, [])

  useEffect(() => {
    if (!videoEl) { teardown(); return }

    const ctx = new AudioContext()
    ctxRef.current = ctx

    const source = ctx.createMediaElementSource(videoEl)
    const splitter = ctx.createChannelSplitter(2)
    const aL = ctx.createAnalyser()
    const aR = ctx.createAnalyser()
    aL.fftSize = 1024
    aR.fftSize = 1024
    analyserLRef.current = aL
    analyserRRef.current = aR

    source.connect(splitter)
    splitter.connect(aL, 0)
    splitter.connect(aR, 1)
    source.connect(ctx.destination)

    const bufL = new Float32Array(aL.fftSize)
    const bufR = new Float32Array(aR.fftSize)

    function rms(buf: Float32Array): number {
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const v = Math.sqrt(sum / buf.length)
      return v < 1e-9 ? -60 : Math.max(-60, 20 * Math.log10(v))
    }

    function tick() {
      rafRef.current = requestAnimationFrame(tick)
      if (ctx.state === 'suspended') ctx.resume()
      aL.getFloatTimeDomainData(bufL)
      aR.getFloatTimeDomainData(bufR)
      const dbL = rms(bufL)
      const dbR = rms(bufR)
      const t = performance.now()
      setLevels([dbL, dbR])
      setPeaks(prev => {
        const nL = dbL >= prev[0] ? dbL : (t - peakTimerRef.current[0] > PEAK_HOLD_MS ? Math.max(dbL, prev[0] - 1) : prev[0])
        const nR = dbR >= prev[1] ? dbR : (t - peakTimerRef.current[1] > PEAK_HOLD_MS ? Math.max(dbR, prev[1] - 1) : prev[1])
        if (dbL >= prev[0]) peakTimerRef.current[0] = t
        if (dbR >= prev[1]) peakTimerRef.current[1] = t
        return [nL, nR]
      })
    }
    tick()

    return teardown
  }, [videoEl, teardown])

  return (
    <div className={`flex flex-col gap-px ${className ?? ''}`}>
      <Bar db={levels[0]} peak={peaks[0]} label="L" />
      <Bar db={levels[1]} peak={peaks[1]} label="R" />
    </div>
  )
}

// Placeholder SMPTE-style colorbars, usado quando um slot do multi-viewer
// não tem canal/entrada correspondente para exibir.
const BARS = [
  '#c0c0c0', // branco/cinza
  '#c0c000', // amarelo
  '#00c0c0', // ciano
  '#00c000', // verde
  '#c000c0', // magenta
  '#c00000', // vermelho
  '#0000c0', // azul
]

export function ColorBars({ label }: { label?: string }) {
  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <div className="flex w-full" style={{ height: '75%' }}>
        {BARS.map((color) => (
          <div key={color} className="flex-1" style={{ backgroundColor: color }} />
        ))}
      </div>
      <div className="flex w-full" style={{ height: '25%' }}>
        {BARS.map((color) => (
          <div key={color} className="flex-1" style={{ backgroundColor: color, filter: 'brightness(0.3)' }} />
        ))}
      </div>
      {label && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center">
          <span className="px-2 py-0.5 rounded bg-black/70 text-[11px] font-semibold text-gray-300 tracking-wide">
            {label}
          </span>
        </div>
      )}
    </div>
  )
}

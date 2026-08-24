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

// viewBox 16:9 (1344/756) com largura divisível por 7 (192px por barra).
const VB_W = 1344
const VB_H = 756
const BAR_W = VB_W / BARS.length
const TOP_H = VB_H * 0.75

export function ColorBars({ label }: { label?: string }) {
  return (
    // SVG (elemento substituído, como <video>) preserva o 16:9 do viewBox e
    // faz letterbox/pillarbox sozinho via preserveAspectRatio — diferente de
    // divs comuns, não precisa (nem se beneficia) de nenhum cálculo CSS de
    // aspect-ratio no wrapper, que é frágil demais em células de formatos
    // muito variados (ex.: linha de 4 entradas vs. linha de 2 canais).
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full bg-black">
      {BARS.map((color, i) => (
        <rect key={`t-${color}`} x={i * BAR_W} y={0} width={BAR_W} height={TOP_H} fill={color} />
      ))}
      {BARS.map((color, i) => (
        <rect key={`b-${color}`} x={i * BAR_W} y={TOP_H} width={BAR_W} height={VB_H - TOP_H} fill={color} fillOpacity={0.35} />
      ))}
      {label && (
        <text
          x={VB_W / 2}
          y={VB_H - 32}
          textAnchor="middle"
          fontSize={34}
          fontWeight={700}
          letterSpacing={1}
          fill="#d1d5db"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          {label}
        </text>
      )}
    </svg>
  )
}

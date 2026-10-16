import './chartMaterial.css'

// Shared lighting, not a shared palette: every series keeps its semantic color.
export function ChartMaterial({ id, color }: { id: string; color: string }) {
  return <defs>
    <linearGradient id={`${id}-surface`} x1="0" y1="0" x2=".35" y2="1" style={{ color }}>
      <stop className="insight-material-cap"/>
      <stop offset=".18" className="insight-material-shoulder"/>
      <stop offset=".52" stopColor="currentColor"/>
      <stop offset="1" className="insight-material-base"/>
    </linearGradient>
    <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="white" stopOpacity=".65"/>
      <stop offset=".22" stopColor="white" stopOpacity=".08"/>
      <stop offset=".48" stopColor="white" stopOpacity="0"/>
      <stop offset=".72" stopColor="white" stopOpacity=".18"/>
      <stop offset="1" stopColor="white" stopOpacity="0"/>
    </linearGradient>
    <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1" style={{ color }}>
      <stop stopColor="currentColor" className="insight-material-area-top"/>
      <stop offset=".55" stopColor="currentColor" className="insight-material-area-mid"/>
      <stop offset="1" stopColor="currentColor" stopOpacity=".015"/>
    </linearGradient>
  </defs>
}

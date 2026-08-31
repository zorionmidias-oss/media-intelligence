import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// Tooltip de vidro (usado pelo AreaTrend).
function GlassTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass" style={{ padding: '10px 12px', fontSize: 12, minWidth: 140 }}>
      <div style={{ color: 'var(--fg-2)', marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <i style={{ width: 9, height: 9, borderRadius: 3, background: p.color, display: 'inline-block' }} />
          <span style={{ color: 'var(--fg-2)' }}>{p.name}</span>
          <span className="num" style={{ marginLeft: 'auto', fontWeight: 600 }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// Gráfico de área com gradiente (estilo Apple).
// data: array de objetos; series: [{ key, color, label }]; xKey: chave do eixo X.
export function AreaTrend({ data = [], series = [], xKey = 'date', height = 220 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity="0.3" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--hair-soft)" />
        <XAxis dataKey={xKey} tick={{ fill: 'var(--fg-3)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis tick={{ fill: 'var(--fg-3)', fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
        <Tooltip content={<GlassTooltip />} cursor={{ stroke: 'var(--hair)' }} />
        {series.map((s) => (
          <Area
            key={s.key} type="monotone" dataKey={s.key} name={s.label}
            stroke={s.color} strokeWidth={2.5} fill={`url(#grad-${s.key})`} dot={false} activeDot={{ r: 4 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Lista de barras horizontais (ex.: receita por país). items: [{ label, value, pct }].
export function BarList({ items = [] }) {
  return (
    <div className="ds-bars">
      {items.map((it, i) => (
        <div className="ds-bar" key={i}>
          <div className="bl"><b>{it.label}</b><span className="num">{it.value}</span></div>
          <div className="track"><div className="fill" style={{ width: `${it.pct}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

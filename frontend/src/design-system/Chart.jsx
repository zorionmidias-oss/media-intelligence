import { useId } from 'react';
import { AreaChart, Area, ComposedChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

// Tooltip de vidro (usado pelo AreaTrend e pelo HourLines).
// `formatValue`: formatador opcional por valor (ex.: BRL/PCT) — sem ele, mostra o valor cru (comportamento anterior).
function GlassTooltip({ active, payload, label, formatValue }) {
  if (!active || !payload?.length) return null;
  const fmt = formatValue || ((v) => v);
  return (
    <div className="glass" style={{ padding: '10px 12px', fontSize: 12, minWidth: 140 }}>
      <div style={{ color: 'var(--fg-2)', marginBottom: 6 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <i style={{ width: 9, height: 9, borderRadius: 3, background: p.color, display: 'inline-block' }} />
          <span style={{ color: 'var(--fg-2)' }}>{p.name}</span>
          <span className="num" style={{ marginLeft: 'auto', fontWeight: 600 }}>{p.value == null ? '—' : fmt(p.value)}</span>
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

// Cor por sinal (menta ≥0, vermelho <0) — usada no marcador "agora", no dot ativo do
// hover e no swatch do tooltip da série Hoje (ver GlassTooltip mais abaixo).
const signColor = (v) => (v == null || Number(v) >= 0 ? 'var(--pos)' : 'var(--neg)');

// Offset (0=topo/valor máximo, 1=base/valor mínimo) onde y=0 cai dentro do bounding box
// da própria área "Hoje" — mesma receita oficial do Recharts p/ "area fill by value"
// (offset = yMax / (yMax - yMin)). yMax<=0 → tudo vermelho; yMin>=0 → tudo menta.
function zeroOffset(values) {
  const nums = values.filter((v) => v != null).map(Number).filter((v) => !Number.isNaN(v));
  if (!nums.length) return 1;
  const yMax = Math.max(...nums);
  const yMin = Math.min(...nums);
  if (yMax <= 0) return 0;
  if (yMin >= 0) return 1;
  return Math.min(1, Math.max(0, yMax / (yMax - yMin)));
}

// Gráfico por hora: hoje (área suave, menta/vermelho por sinal) vs ontem (linha tracejada
// cinza, suave, sem preenchimento). hoje/ontem: [{ hora, [metricKey] }].
// `nowHour`: hora atual (SP) — desenha marcador "agora Xh" (ReferenceLine + ponto na área de hoje).
// `valueFormatter`: formata o valor no tooltip (BRL/PCT/etc. — ver frontend/src/lib/format.js).
export function HourLines({ hoje = [], ontem = [], metricKey, color: _color = 'var(--rev)', height = 240, nowHour = null, valueFormatter }) {
  const gradId = `hl-grad-${useId()}`;
  const byH = {};
  for (const r of ontem) byH[r.hora] = { hora: r.hora, ontem: r[metricKey] };
  for (const r of hoje) byH[r.hora] = { ...(byH[r.hora] || { hora: r.hora }), hoje: r[metricKey] };
  const data = Object.values(byH).sort((a, b) => a.hora - b.hora)
    .map((d) => ({ ...d, hora: String(d.hora).padStart(2, '0') + 'h' }));
  const nowX = nowHour != null ? String(nowHour).padStart(2, '0') + 'h' : null;

  // Split do gradiente no y=0: menta esvaindo p/ transparente perto do zero, sólida no
  // topo (valor máximo); vermelho esvaindo p/ transparente perto do zero, sólido na base
  // (valor mínimo). Se não cruza zero, vira um fade simples de 2 stops numa cor só.
  const off = zeroOffset(data.map((d) => d.hoje));
  const FADE = 0.38; // opacidade "sólida" nos extremos (topo/base), some perto do zero
  const stops = off >= 1
    ? [{ o: 0, c: 'var(--pos)', a: FADE }, { o: 1, c: 'var(--pos)', a: 0 }]
    : off <= 0
      ? [{ o: 0, c: 'var(--neg)', a: 0 }, { o: 1, c: 'var(--neg)', a: FADE }]
      : [
          { o: 0, c: 'var(--pos)', a: FADE },
          { o: off, c: 'var(--pos)', a: 0 },
          { o: off, c: 'var(--neg)', a: 0 },
          { o: 1, c: 'var(--neg)', a: FADE },
        ];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            {stops.map((s, i) => <stop key={i} offset={s.o} stopColor={s.c} stopOpacity={s.a} />)}
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--bd2)" />
        <XAxis dataKey="hora" tick={{ fill: 'var(--mut)', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={18} />
        <YAxis tick={{ fill: 'var(--mut)', fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          content={(props) => (
            <GlassTooltip
              {...props}
              payload={props.payload?.map((p) => (p.dataKey === 'hoje' ? { ...p, color: signColor(p.value) } : p))}
              formatValue={valueFormatter}
            />
          )}
          cursor={{ stroke: 'var(--bd)' }}
        />
        {nowX && (
          <ReferenceLine
            x={nowX}
            stroke="var(--acc)"
            strokeOpacity={0.5}
            strokeWidth={1.1}
            strokeDasharray="3 3"
            label={{ value: `agora ${nowHour}h`, position: 'insideTopRight', fill: 'var(--acc)', fontSize: 10.5, fontWeight: 600 }}
          />
        )}
        <Line type="monotone" dataKey="ontem" name="Ontem" stroke="var(--spend)" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls />
        <Area
          type="monotone"
          dataKey="hoje"
          name="Hoje"
          stroke={`url(#${gradId})`}
          strokeWidth={2.5}
          fill={`url(#${gradId})`}
          fillOpacity={1}
          connectNulls
          dot={(props) => (nowX && props.payload?.hora === nowX
            ? <circle key={props.key ?? `now-${props.cx}-${props.cy}`} cx={props.cx} cy={props.cy} r={3} fill={signColor(props.payload?.hoje)} stroke="none" />
            : null)}
          activeDot={(props) => (
            <circle
              key={props.key ?? `act-${props.cx}-${props.cy}`}
              cx={props.cx} cy={props.cy} r={4}
              fill={signColor(props.payload?.hoje)} stroke="var(--panel)" strokeWidth={1.5}
            />
          )}
        />
      </ComposedChart>
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

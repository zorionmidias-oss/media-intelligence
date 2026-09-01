import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { BRL, PCT } from '../../lib/format.js';

// Tooltip com o mesmo trio de séries do gráfico (rev/spd/roi), estilo painel (tokens do theme).
function DailyTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const byKey = Object.fromEntries(payload.map((p) => [p.dataKey, p.value]));
  return (
    <div className="daily-tip">
      <div className="daily-tip-date">{label}</div>
      <div className="daily-tip-row"><i className="rev" />Receita<b>{BRL(byKey.faturamento)}</b></div>
      <div className="daily-tip-row"><i className="spd" />Gasto<b>{BRL(byKey.investimento)}</b></div>
      <div className="daily-tip-row"><i className="roi" />ROI %<b>{PCT(byKey.roi, 1)}</b></div>
    </div>
  );
}

/**
 * Barras Receita/Gasto (eixo esquerdo, oculto) + linha ROI% (eixo direito, 0–120%+).
 * Porta #daily-svg de overview-v3.html — Recharts em vez de SVG manual à mão, mesmas cores
 * via tokens (`--rev` receita, `--spend` gasto, `--warn` linha ROI — protótipo usa `--roi`,
 * que não existe em theme/tokens.css; `--warn` é o token âmbar equivalente já disponível).
 *
 * @param {{date:string, faturamento:number, investimento:number, roas:number}[]} trend - data.trend (API /api/overview)
 * @param {number} [height] - altura do gráfico em px
 */
export default function DailyChart({ trend = [], height = 240 }) {
  const data = trend.map((t) => ({
    date: t.date,
    day: String(t.date || '').slice(8, 10),
    faturamento: Number(t.faturamento) || 0,
    investimento: Number(t.investimento) || 0,
    roi: ((Number(t.roas) || 0) - 1) * 100,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barGap={2} barCategoryGap="26%">
        <CartesianGrid xAxisId={0} yAxisId="left" horizontal vertical={false} stroke="var(--bd)" />
        <XAxis
          dataKey="day"
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--mut)', fontSize: 11 }}
          interval="preserveStartEnd"
        />
        <YAxis yAxisId="left" hide domain={[0, (max) => Math.ceil(max * 1.15)]} />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[0, (max) => Math.max(120, Math.ceil(max / 20) * 20)]}
          axisLine={false}
          tickLine={false}
          tick={{ fill: 'var(--mut)', fontSize: 11 }}
          tickFormatter={(v) => `${v}%`}
          width={38}
        />
        <Tooltip content={<DailyTooltip />} cursor={{ fill: 'color-mix(in srgb, var(--fg2) 8%, transparent)' }} />
        <Bar yAxisId="left" dataKey="faturamento" name="Receita" fill="var(--rev)" radius={[2, 2, 0, 0]} maxBarSize={16} />
        <Bar yAxisId="left" dataKey="investimento" name="Gasto" fill="var(--spend)" radius={[2, 2, 0, 0]} maxBarSize={16} />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="roi"
          name="ROI %"
          stroke="var(--warn)"
          strokeWidth={2.3}
          dot={{ r: 2.5, fill: 'var(--warn)', strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

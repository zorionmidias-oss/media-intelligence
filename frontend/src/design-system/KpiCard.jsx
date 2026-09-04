import GlassCard from './GlassCard.jsx';
import Val from './Val.jsx';

// Gera os pontos de um sparkline a partir de um array de números.
function sparkPoints(data, w = 120, h = 26, pad = 3) {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data), max = Math.max(...data), span = (max - min) || 1;
  return data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

// Cartão de KPI: rótulo, valor grande (tabular), chip de variação e sparkline.
// tone: 'pos' | 'neg' | undefined (cor do valor e da linha). deltaTone: 'up' | 'down'.
export default function KpiCard({ label, value, delta, deltaTone = 'up', spark = [], tone }) {
  const stroke = tone === 'pos' ? 'var(--pos)' : tone === 'neg' ? 'var(--neg)' : 'var(--accent)';
  return (
    <GlassCard className="ds-kpi">
      <div className="lbl">{label}</div>
      <div className={`val num ${tone || ''}`}><Val>{value}</Val></div>
      {delta != null && (
        <div className="foot">
          <span className={`chip ${deltaTone}`}>{deltaTone === 'up' ? '▲' : '▼'} {delta}</span>
          <span>vs. período anterior</span>
        </div>
      )}
      {spark.length > 1 && (
        <svg className="spark" viewBox="0 0 120 26" preserveAspectRatio="none">
          <polyline fill="none" stroke={stroke} strokeWidth="2" points={sparkPoints(spark)} />
        </svg>
      )}
    </GlassCard>
  );
}

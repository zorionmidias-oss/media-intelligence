import GlassCard from './GlassCard.jsx';

// Tile compacto para linhas densas de métricas (label + valor + variação opcional).
export default function StatTile({ label, value, delta, deltaTone = 'up', tone, hint, badge }) {
  return (
    <GlassCard className="ds-stat" title={hint}>
      <div className="lbl">{label}{badge && <span className="ds-stat-badge">{badge}</span>}</div>
      <div className={`val num ${tone || ''}`}>{value}</div>
      {delta != null && <div className={`chip ${deltaTone}`}>{deltaTone === 'up' ? '▲' : '▼'} {delta}</div>}
    </GlassCard>
  );
}

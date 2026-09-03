import { useState } from 'react';
import { DDMM } from '../../lib/format.js';
import { roiCls, roiTxt } from './columns.js';

// Chip de ROI com semáforo (menta/âmbar/vermelho) — o destaque da tabela.
export function RoiChip({ roi }) {
  return <span className={`roi-chip ${roiCls(roi)}`}>{roiTxt(roi)}</span>;
}

// Curva suavizada ponto-a-ponto (mesmo smooth() de MetricCard/overview-v3).
function smooth(pts) {
  if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const mx = (x1 + x2) / 2;
    d += ` C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
  }
  return d;
}

const fmtRoi = (v) => (v >= 0 ? '' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + '%';

// Hook de hover comum (crosshair → índice mais próximo) reaproveitado pelos gráficos.
function useHover(n) {
  const [hi, setHi] = useState(null);
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const fr = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHi(Math.round(fr * (n - 1)));
  };
  return [hi, move, () => setHi(null)];
}

// Sparkline de tendência de ROI: área+linha, VERMELHA quando o último ponto < o
// primeiro (queda). Hover mostra valor% + data. Porta sparkSvg()+cwWrap de campanhas-a.
export function Sparkline({ vals = [], dates = [] }) {
  const n = vals.length;
  const [hi, move, leave] = useHover(n);
  if (n < 2) return <span className="cspark-empty">—</span>;
  const col = vals[n - 1] < vals[0] ? 'var(--neg)' : 'var(--acc)';
  const mn = Math.min(...vals), mx = Math.max(...vals), sp = (mx - mn) || 1;
  const pts = vals.map((x, i) => [(100 * i) / (n - 1), 30 - ((x - mn) / sp) * 26 + 2]);
  const line = smooth(pts);
  const fx = hi != null ? (100 * hi) / (n - 1) : 0;
  return (
    <span className={`cw${hi != null ? ' hov' : ''}`} onMouseMove={move} onMouseLeave={leave}>
      <svg className="spark" viewBox="0 0 100 34" preserveAspectRatio="none">
        <path d={`${line} L100 34 L0 34 Z`} fill={col} opacity="0.13" />
        <path d={line} fill="none" stroke={col} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {hi != null && (
        <div className="chtip" style={{ left: `${Math.max(14, Math.min(86, fx))}%` }}>
          <b>{fmtRoi(vals[hi])}</b> <span>{DDMM(dates[hi])}</span>
        </div>
      )}
    </span>
  );
}

// Barras finas de tendência (com zero baseline) — porta tbarsSvg(). Hover valor%+data.
export function TrendBars({ vals = [], dates = [] }) {
  const n = vals.length;
  const [hi, move, leave] = useHover(n);
  if (n < 1) return <span className="cspark-empty">—</span>;
  const mn = Math.min(0, ...vals), mx = Math.max(0, ...vals), sp = (mx - mn) || 1;
  const y = (x) => 3 + ((mx - x) / sp) * 30;
  const zero = y(0), bw = (100 / n) * 0.5;
  const col = vals[n - 1] < vals[0] ? 'var(--neg)' : 'var(--acc)';
  const fx = hi != null ? (100 * (hi + 0.5)) / n : 0;
  return (
    <span className={`cw${hi != null ? ' hov' : ''}`} onMouseMove={move} onMouseLeave={leave}>
      <svg className="tbars" viewBox="0 0 100 36" preserveAspectRatio="none">
        {vals.map((x, i) => {
          const cx = (100 * (i + 0.5)) / n - bw / 2;
          const yy = y(x);
          const top = x < 0 ? zero : yy;
          const h = Math.abs(yy - zero) || 1;
          return <rect key={i} x={cx.toFixed(1)} y={top.toFixed(1)} width={bw.toFixed(1)} height={h.toFixed(1)} rx="0.8" fill={col} />;
        })}
      </svg>
      {hi != null && (
        <div className="chtip" style={{ left: `${Math.max(14, Math.min(86, fx))}%` }}>
          <b>{fmtRoi(vals[hi])}</b> {dates[hi] && <span>{DDMM(dates[hi])}</span>}
        </div>
      )}
    </span>
  );
}

// ROI · 4 dias: barras com o valor FIXO acima, cor por dia (semáforo) — porta roi4dBlock().
export function Roi4d({ vals = [], dates = [] }) {
  if (!vals.length) return <span className="cspark-empty">—</span>;
  const mx = Math.max(...vals.map((a) => Math.abs(a))) || 1;
  return (
    <span className="roi4d">
      {vals.map((x, i) => {
        const h = Math.max(3, (Math.abs(x) / mx) * 26);
        const col = x >= 20 ? 'var(--acc)' : x >= 0 ? 'var(--warn)' : 'var(--neg)';
        return (
          <span className="r4c" key={i}>
            <em style={{ color: col }}>{Math.round(x)}%</em>
            <i style={{ height: `${h.toFixed(0)}px`, background: col }} />
            <small>{dates[i] ? DDMM(dates[i]) : ''}</small>
          </span>
        );
      })}
    </span>
  );
}

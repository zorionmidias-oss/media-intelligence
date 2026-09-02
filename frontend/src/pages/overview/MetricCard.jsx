import { useState } from 'react';
import { PCT, DDMM } from '../../lib/format.js';

const f2 = (v) => v.toFixed(2);

// Mesma escala vertical (viewBox 0..100) usada por curvePaths() — reaproveitada
// no cálculo do hover (porta yT/yB de hoverCard() de overview-v3.html).
const Y_TOP = 12, Y_BOTTOM = 86;

// Curva suavizada (Catmull-Rom-ish via bezier ponto-a-ponto) — porta smooth(pts) de
// overview-v3.html, usada por metricSVG(series,'curva',...) para o sparkline do lado
// direito dos cards pequenos (`.sright`/`.spark`).
function smooth(pts) {
  if (pts.length < 2) return pts.length ? `M ${f2(pts[0][0])} ${f2(pts[0][1])}` : '';
  let d = `M ${f2(pts[0][0])} ${f2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const mx = (x1 + x2) / 2;
    d += ` C ${f2(mx)} ${f2(y1)} ${f2(mx)} ${f2(y2)} ${f2(x2)} ${f2(y2)}`;
  }
  return d;
}

// Normaliza a série (min/max) num viewBox 0..100 e devolve o path da linha + área
// preenchida embaixo — mesma matemática de metricSVG(series,'curva') de overview-v3.html.
function curvePaths(vals) {
  const n = vals.length;
  if (n < 2) return null;
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const sp = mx - mn || 1;
  const yT = 12, yB = 86;
  const X = (i) => (100 * i) / (n - 1);
  const Y = (v) => yB - ((v - mn) / sp) * (yB - yT);
  const pts = vals.map((v, i) => [X(i), Y(v)]);
  const line = smooth(pts);
  return { line, area: `${line} L100 100 L0 100 Z` };
}

/**
 * Card pequeno de métrica: label + delta opcional (▲/▼) + valor + sparkline (série diária real).
 * Porta `.scard` (`.sleft` + `.sright`/`.spark`) de overview-v3.html.
 *
 * @param {string} label - título do card (ex.: "eCPM")
 * @param {string} value - valor já formatado (ex.: "R$ 16,62")
 * @param {number|null} [deltaPct] - variação vs. período anterior, em pontos percentuais;
 *   omitido/null quando a API não fornece comparação para essa métrica (não renderiza delta)
 * @param {boolean} [up] - direção do delta (cor/seta); só usado quando `deltaPct` é informado
 * @param {number[]} [series] - série diária real da métrica (vinda de trend[]); se vazia/ausente
 *   ou com menos de 2 pontos, o card degrada limpo SEM sparkline (nada de dado fabricado)
 * @param {string[]} [dates] - datas (ISO, `trend[].date`) casadas 1:1 com `series`, para o tooltip de hover
 * @param {(v:number)=>string} [fmt] - formata um ponto de `series` no tooltip de hover (mesmo estilo de `value`)
 */
export default function MetricCard({ label, value, deltaPct, up, series = [], dates = [], fmt = String }) {
  const hasDelta = deltaPct != null;
  const paths = curvePaths(series);
  const n = series.length;

  // Hover (crosshair + ponto + tooltip) — porta hoverCard(region,series,fmt) de
  // overview-v3.html: cursor x → índice mais próximo → valor/data da série real.
  const [hoverIdx, setHoverIdx] = useState(null);
  const mn = paths ? Math.min(...series) : 0;
  const mx = paths ? Math.max(...series) : 0;
  const sp = mx - mn || 1;

  function handleMove(e) {
    if (!paths) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const fr = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(fr * (n - 1)));
  }
  function handleLeave() {
    setHoverIdx(null);
  }

  const hover = hoverIdx != null && paths
    ? {
        fx: (100 * hoverIdx) / (n - 1),
        fy: Y_BOTTOM - ((series[hoverIdx] - mn) / sp) * (Y_BOTTOM - Y_TOP),
      }
    : null;

  return (
    <div className="scard">
      <div className="sleft">
        <div className="stop">
          <span className="sname">{label}</span>
          {hasDelta && (
            <span className={`schg ${up ? 'pos' : 'neg'}`}>
              {up ? '▲' : '▼'} {PCT(Math.abs(deltaPct), 1)}
            </span>
          )}
        </div>
        <div className="sval">{value}</div>
      </div>
      {paths && (
        <div className={`sright${hover ? ' hov' : ''}`} onMouseMove={handleMove} onMouseLeave={handleLeave}>
          <svg className="spark" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path className="parea" d={paths.area} />
            <path className="pline" d={paths.line} />
          </svg>
          {hover && (
            <>
              <div className="hcross" style={{ left: `${hover.fx}%` }} />
              <div className="hdot" style={{ left: `${hover.fx}%`, top: `${hover.fy}%` }} />
              <div className="htip" style={{ left: `${Math.max(16, Math.min(84, hover.fx))}%`, top: `${hover.fy}%` }}>
                <b>{fmt(series[hoverIdx])}</b>
                <span>{DDMM(dates[hoverIdx])}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

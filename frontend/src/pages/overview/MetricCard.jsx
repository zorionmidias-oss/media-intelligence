import { PCT } from '../../lib/format.js';

const f2 = (v) => v.toFixed(2);

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
 */
export default function MetricCard({ label, value, deltaPct, up, series = [] }) {
  const hasDelta = deltaPct != null;
  const paths = curvePaths(series);

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
        <div className="sright">
          <svg className="spark" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path className="parea" d={paths.area} />
            <path className="pline" d={paths.line} />
          </svg>
        </div>
      )}
    </div>
  );
}

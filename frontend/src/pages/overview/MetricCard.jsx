import { PCT } from '../../lib/format.js';

/**
 * Card pequeno de métrica: label + delta opcional (▲/▼) + valor.
 * Porta o lado esquerdo (`.sleft`) de `.scard` de overview-v3.html — SEM a
 * região `.sright`/sparkline (decisão do dono, 01/09: sem série diária real
 * para essas métricas ainda, nada de dado fabricado).
 *
 * @param {string} label - título do card (ex.: "eCPM")
 * @param {string} value - valor já formatado (ex.: "R$ 16,62")
 * @param {number|null} [deltaPct] - variação vs. período anterior, em pontos percentuais;
 *   omitido/null quando a API não fornece comparação para essa métrica (não renderiza delta)
 * @param {boolean} [up] - direção do delta (cor/seta); só usado quando `deltaPct` é informado
 */
export default function MetricCard({ label, value, deltaPct, up }) {
  const hasDelta = deltaPct != null;

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
    </div>
  );
}

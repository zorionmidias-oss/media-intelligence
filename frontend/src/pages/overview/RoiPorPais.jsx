import { useApi } from '../../hooks/useApi.js';
import { hojeBR, addDias } from '../../lib/datas.js';
import { PCT, filterQs } from '../../lib/format.js';

/**
 * ROI por país — grade de mini gráficos de barras (7 dias). Porta `.paisgrid`/
 * `.pcard2`/`.pcchart` de overview-v3.html (`roi4dBlock`/`paisgrid`, adaptado
 * de 4 para 7 dias): sem hover — valor fixo ACIMA de cada barra, cor por
 * semáforo (verde ≥20%, âmbar 0–20%, vermelho <0), badge de tendência
 * (média 7d vs. 7d anteriores) e data sob cada barra.
 *
 * Consome `GET /api/roi-por-pais` — [{ pais, roi7d:[7 números], deltaPct }],
 * já ordenado por ROI médio desc pelo backend. Recebe domain do App (refiltra o
 * país); Task 14: janela é SEMPRE os últimos 7 dias, fixa e desacoplada do
 * calendário — não recebe/envia since/until (ver src/app/api/roi-por-pais/route.js).
 */

// Sigla → nome de exibição. `pais_sigla` de ads_consolidados é normalmente ISO-2,
// exceto África do Sul, que o cliente grava como "AFS" (ver src/lib/parser.js
// COUNTRY_OVERRIDES) — daí o alias 'za'/'afs' apontando para o mesmo nome.
const PAIS_NOMES = {
  br: 'Brasil',
  za: 'África do Sul', afs: 'África do Sul',
  ng: 'Nigéria', ke: 'Quênia', gh: 'Gana',
  tz: 'Tanzânia', ug: 'Uganda', zm: 'Zâmbia', mz: 'Moçambique',
};
const nomePais = (sigla) => PAIS_NOMES[String(sigla || '').toLowerCase()] || String(sigla || '').toUpperCase();

// Semáforo de ROI: verde ≥20%, âmbar 0–20%, vermelho <0 (mesma régua do resto do dashboard).
const roiCor = (v) => (v >= 20 ? 'var(--pos)' : v >= 0 ? 'var(--warn)' : 'var(--neg)');

// Rótulos dd/mm dos últimos N dias (oldest→newest) — mesma janela padrão do
// backend (últimos 7 dias no fuso BR, hoje inclusive; ver src/lib/datas.js).
function diaLabels(n) {
  const hoje = hojeBR();
  return Array.from({ length: n }, (_, i) => {
    const iso = addDias(hoje, -(n - 1 - i));
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  });
}

// Mini gráfico de barras (1 por país): eixo compartilhado (0 incluso), barra
// colorida por semáforo, valor fixo acima e data do dia sob a barra.
function PaisChart({ roi7d }) {
  const n = roi7d.length;
  const W = 220, H = 108;
  const P = { l: 4, r: 4, t: 18, b: 16 };
  const iw = W - P.l - P.r;
  const ih = H - P.t - P.b;
  const mn = Math.min(0, ...roi7d);
  const mx = Math.max(0, ...roi7d);
  const sp = (mx - mn) || 1;
  const y = (v) => P.t + ih * (1 - (v - mn) / sp);
  const zero = y(0);
  const bw = (iw / n) * 0.62;
  const labels = diaLabels(n);

  return (
    <svg className="pcchart" viewBox={`0 0 ${W} ${H}`}>
      {roi7d.map((v, i) => {
        const cx = P.l + iw * ((i + 0.5) / n) - bw / 2;
        const neg = v < 0;
        const top = neg ? zero : y(v);
        const h = Math.max(Math.abs(y(v) - zero), 0.5);
        const cor = roiCor(v);
        return (
          <g key={i}>
            <rect className="pcbar" x={cx} y={top} width={bw} height={h} rx="1.5" style={{ fill: cor }} />
            <text className="pcval" x={cx + bw / 2} y={top - 3} textAnchor="middle" style={{ fill: cor }}>
              {Math.round(v)}%
            </text>
            <text className="pcaxis" x={cx + bw / 2} y={H - 5} textAnchor="middle">
              {labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function PaisCard({ pais, roi7d, deltaPct }) {
  const up = deltaPct >= 0;
  return (
    <div className="pcard2">
      <div className="pc-hd">
        <span className="pc-title">{nomePais(pais)}</span>
        <span className={`pc-badge ${up ? '' : 'neg'}`} title="média dos últimos 7 dias vs. 7 dias anteriores">
          {up ? '▲' : '▼'} {PCT(Math.abs(deltaPct), 1)}
        </span>
      </div>
      <div className="pc-desc">ROI · últimos {roi7d.length} dias</div>
      <PaisChart roi7d={roi7d} />
    </div>
  );
}

function PaisGridSkeleton() {
  return (
    <div className="paisgrid">
      {[0, 1, 2, 3].map((i) => <div key={i} className="ov-skel pc-skel" />)}
    </div>
  );
}

export default function RoiPorPais({ domain }) {
  // Task 14: janela fixa de 7 dias no backend — não passamos since/until (só domain).
  const qs = filterQs({ domain });
  const { data, loading, error } = useApi(`/roi-por-pais${qs}`, [domain]);
  const paises = data || [];

  return (
    <>
      <div className="sec">ROI por país · últimos 7 dias</div>

      {loading && <PaisGridSkeleton />}

      {!loading && error && <p className="ov-error">Erro ao carregar: {error}</p>}

      {!loading && !error && paises.length === 0 && (
        <div className="panel pc-empty">Sem dados de país no período.</div>
      )}

      {!loading && !error && paises.length > 0 && (
        <div className="paisgrid">
          {paises.map((p) => <PaisCard key={p.pais} {...p} />)}
        </div>
      )}
    </>
  );
}

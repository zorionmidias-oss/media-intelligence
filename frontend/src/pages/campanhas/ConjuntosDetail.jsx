import { useApi } from '../../hooks/useApi.js';
import { fmtCell } from './columns.js';
import { RoiChip, Roi4d, TrendBars } from './charts.jsx';

// Valor de cada coluna visível a partir de um conjunto (adset) do /api/drilldown.
// roi vem como RAZÃO (fat/gasto) → ROI% = (roi−1)×100. Campos não medidos por
// conjunto (eCPM/PAR/criada/otim) e sem receita casada por id retornam null → "—".
function conjVal(a, k) {
  switch (k) {
    case 'roi': return a.roi != null ? (a.roi - 1) * 100 : null;
    case 'gasto': return a.spend;
    case 'rec': return a.faturamento_real;
    case 'lucro': return a.faturamento_real != null ? a.faturamento_real - a.spend : null;
    case 'roas': return a.roi; // fat ÷ gasto = ROAS
    case 'rps': return a.rps;
    case 'cpc': return a.cpc;
    case 'ctr': return a.ctr;
    case 'impr': return a.impressions;
    case 'sess': return a.resultado_vc;
    case 'sesslead': return a.conversas > 0 ? a.resultado_vc / a.conversas : null;
    case 'custores': return a.cost_per_result;
    case 'result': return a.results;
    case 'be': return a.breakeven;
    default: return null; // ecpm, par, criada, otim — não disponível por conjunto
  }
}

export default function ConjuntosDetail({ c, cols, period }) {
  const utm = encodeURIComponent(c.ad_utm || '');
  const p = new URLSearchParams({ adsets_only: '1' });
  if (c.campaign_id) p.set('campaign_id', c.campaign_id);
  if (period?.since) p.set('since', period.since);
  if (period?.until) p.set('until', period.until);
  if (c.rps) p.set('rps', String(c.rps));
  const { data, loading, error } = useApi(`/drilldown/${utm}?${p.toString()}`, [utm, c.campaign_id, period?.since, period?.until]);

  const adsets = data?.adsets || [];

  return (
    <div className="detail">
      <h5>Conjuntos ativos · {c.ad_utm}</h5>
      {loading && <div className="cj-msg">Carregando conjuntos…</div>}
      {error && <div className="cj-msg err">Erro: {error}</div>}
      {!loading && !error && adsets.length === 0 && <div className="cj-msg">Nenhum conjunto ativo no período.</div>}
      {!loading && !error && adsets.length > 0 && (
        <div className="cjwrap">
          <table className="cjtbl">
            <thead>
              <tr>
                <th>Conjunto</th>
                {cols.map((col) => <th key={col.k} className="r">{col.k === 'roi' ? 'ROI · 4 dias' : col.lb}</th>)}
                <th className="r">Tendência</th>
              </tr>
            </thead>
            <tbody>
              {adsets.map((a) => {
                const serie = a.roi_serie || [];
                const svals = serie.map((s) => Number(s.roi) || 0);
                const sdates = serie.map((s) => s.data);
                const r4 = serie.slice(-4);
                return (
                  <tr key={a.adset_id}>
                    <td className="cj-name">{a.adset_name}</td>
                    {cols.map((col) => {
                      const v = conjVal(a, col.k);
                      if (col.k === 'roi') return (
                        <td className="r" key={col.k}>
                          <span className="roi-cell">
                            {v != null ? <RoiChip roi={v} /> : <span className="cj-na">—</span>}
                            <Roi4d vals={r4.map((s) => Number(s.roi) || 0)} dates={r4.map((s) => s.data)} />
                          </span>
                        </td>
                      );
                      if (v == null) return <td className="r" key={col.k}><span className="cj-na">—</span></td>;
                      return <td className={`r ${col.signed ? (v >= 0 ? 'pos' : 'neg') : ''}`} key={col.k}>{fmtCell(col, v)}</td>;
                    })}
                    <td className="r"><TrendBars vals={svals} dates={sdates} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

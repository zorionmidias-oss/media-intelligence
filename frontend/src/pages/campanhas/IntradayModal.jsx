import { useEffect } from 'react';
import { useApi } from '../../hooks/useApi.js';
import { money, money2, num, intg } from './columns.js';

const HH = (h) => String(h).padStart(2, '0') + 'h';

// Modal "reloginho": funil Meta por hora (hoje) + totais do dia (receita/eCPM/ROI/PAR
// são total do dia — GAM não entrega receita×hora por campanha). Rota /api/campanha-intraday.
export default function IntradayModal({ campaignId, nome, onClose }) {
  const { data, loading, error } = useApi(`/campanha-intraday/${campaignId}`, [campaignId]);

  // Fecha no Esc (custom modal — nada de dialog nativo que trava o browser).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const t = data?.totais_dia || {};
  const hoje = data?.hoje || [];
  const cards = [
    ['Receita', t.receita != null ? money(t.receita) : '—'],
    ['Investimento', money(t.investimento || 0)],
    ['ROI', t.roi != null ? num(t.roi, 1) + '%' : '—', t.roi != null ? (t.roi >= 0 ? 'pos' : 'neg') : ''],
    ['eCPM', t.ecpm != null ? money2(t.ecpm) : '—'],
    ['Resultado', intg(t.resultado || 0)],
    ['PAR', t.par != null ? num(t.par, 2) : '—'],
  ];

  return (
    <div className="cmp-modal-ov" onClick={onClose}>
      <div className="cmp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmp-modal-head">
          <div>
            <h4>◷ Intraday · {nome}</h4>
            {data && <span className="cmp-modal-sub">Hoje ({data.data_hoje}) · atualizado até {HH(data.hora_atual)}</span>}
          </div>
          <button className="cmp-modal-x" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        {loading && <div className="cmp-modal-msg">Carregando intraday…</div>}
        {error && <div className="cmp-modal-msg err">Erro: {error}</div>}

        {data && !loading && !error && (
          <>
            <div className="cmp-modal-cards">
              {cards.map(([l, v, tone]) => (
                <div className="mc" key={l}><div className="l">{l}</div><div className={`v ${tone || ''}`}>{v}</div></div>
              ))}
            </div>

            {data.sem_dados ? (
              <div className="cmp-modal-msg">Sem entrega hoje nem ontem.</div>
            ) : (
              <div className="cmp-modal-tblwrap">
                <table className="cmp-modal-tbl">
                  <thead>
                    <tr>
                      <th>Hora</th>
                      <th className="r">Investimento</th>
                      <th className="r">Resultado</th>
                      <th className="r">Custo/result</th>
                      <th className="r">Conversas</th>
                      <th className="r">Sessões</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hoje.map((h) => (
                      <tr key={h.hora}>
                        <td>{HH(h.hora)}</td>
                        <td className="r">{money2(h.investimento)}</td>
                        <td className="r">{intg(h.resultado)}</td>
                        <td className="r">{h.custo_resultado != null ? money2(h.custo_resultado) : '—'}</td>
                        <td className="r">{intg(h.conversas)}</td>
                        <td className="r">{intg(h.sessoes)}</td>
                      </tr>
                    ))}
                    {hoje.length === 0 && <tr><td className="cmp-modal-msg" colSpan={6}>Sem horas com entrega hoje ainda.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

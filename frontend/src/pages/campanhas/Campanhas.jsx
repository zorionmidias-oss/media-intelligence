import { useState } from 'react';
import { useApi, apiPost } from '../../hooks/useApi.js';
import { filterQs } from '../../lib/format.js';
import {
  COLS, DEFAULT_VIS, fmtCell, sortVal, rowKey,
  money, num, roiOf, fD, daysSince, brDate,
} from './columns.js';
import { RoiChip, Sparkline } from './charts.jsx';
import ConjuntosDetail from './ConjuntosDetail.jsx';
import IntradayModal from './IntradayModal.jsx';
import './campanhas.css';

// Célula "Última otim.": dd/mm + relativo ("hoje"/"há Nd"), âmbar quando ≥7 dias
// sem otimizar. null = nunca otimizada. Porta fOt() de campanhas-a.
function OtimCell({ value }) {
  if (!value) return <span className="rel">nunca</span>;
  const dia = brDate(value);
  const n = daysSince(dia);
  const rel = n <= 0 ? 'hoje' : `há ${n}d`;
  return (
    <>
      {dia.slice(8, 10)}/{dia.slice(5, 7)} <span className={`rel ${n >= 7 ? 'stale' : ''}`}>{rel}</span>
    </>
  );
}

// Seta de ordenação no cabeçalho (ativa vs. inativa).
function Arrow({ col, sortK, sortD }) {
  if (sortK === col) return <span className="ar">{sortD > 0 ? '▲' : '▼'}</span>;
  return <span className="ar dim">↕</span>;
}

export default function Campanhas({ period, domain }) {
  const qs = filterQs({ since: period?.since, until: period?.until, domain });
  const { data, loading, error } = useApi(`/dashboard${qs}`, [period?.since, period?.until, domain]);

  const [sortK, setSortK] = useState('roi');
  const [sortD, setSortD] = useState(-1);
  const [fEst, setFEst] = useState('todas');
  const [fCriada, setFCriada] = useState('all');
  const [fOtim, setFOtim] = useState('all');
  const [search, setSearch] = useState('');
  const [vis, setVis] = useState(() => new Set(DEFAULT_VIS));
  const [colOpen, setColOpen] = useState(false);
  const [openKey, setOpenKey] = useState(null);
  const [modal, setModal] = useState(null); // { campaignId, nome }
  // Overrides locais de "última otimização" após clicar ✓ (sem esperar refetch).
  const [optim, setOptim] = useState({});
  const [flash, setFlash] = useState(null);

  if (loading) return <div className="campanhas-page"><div className="cmp-skel" /></div>;
  if (error) return <div className="campanhas-page"><p className="cmp-error">Erro ao carregar: {error}</p></div>;

  const rows = data?.rows || [];
  const cols = COLS.filter((c) => vis.has(c.k));

  // Valor de "última otimização" da linha, respeitando override local do botão ✓.
  const otimOf = (c) => (c.campaign_id && optim[c.campaign_id] !== undefined ? optim[c.campaign_id] : c.ultima_otimizacao);

  function pass(c) {
    if (search) {
      const q = search.toLowerCase();
      if (!String(c.ad_utm || '').toLowerCase().includes(q) && !String(c.pagina || '').toLowerCase().includes(q)) return false;
    }
    if (fEst !== 'todas' && c.estrutura !== fEst) return false;
    if (fCriada !== 'all') {
      const n = daysSince(c.data_inicio);
      if (fCriada === '7' && !(n != null && n <= 7)) return false;
      if (fCriada === '30' && !(n != null && n <= 30)) return false;
      if (fCriada === '30+' && !(n != null && n > 30)) return false;
    }
    if (fOtim !== 'all') {
      const ts = otimOf(c);
      const n = ts ? daysSince(brDate(ts)) : null; // nunca otimizada = ∞
      if (fOtim === 'hoje' && !(n != null && n <= 0)) return false;
      if (fOtim === '3' && n != null && n < 3) return false;
      if (fOtim === '7' && n != null && n < 7) return false;
    }
    return true;
  }

  const filtered = rows.filter(pass);
  const sortCol = COLS.find((c) => c.k === sortK);
  const sorted = [...filtered].sort((a, b) => {
    if (sortK === 'name') return sortD * String(a.ad_utm || '').localeCompare(String(b.ad_utm || ''));
    return sortD * (sortVal(a, sortCol) - sortVal(b, sortCol));
  });

  // Resumo (faixa superior) — sobre o conjunto FILTRADO.
  const sg = filtered.reduce((s, c) => s + Number(c.valor_gasto || 0), 0);
  const sr = filtered.reduce((s, c) => s + Number(c.faturamento_real || 0), 0);
  const rm = filtered.length ? filtered.reduce((s, c) => s + roiOf(c), 0) / filtered.length : 0;
  const bm = filtered.length ? filtered.reduce((s, c) => s + Number(c.breakeven || 0), 0) / filtered.length : 0;
  const summary = [
    ['Campanhas', String(filtered.length)],
    ['Gasto', money(sg)],
    ['Receita', money(sr)],
    ['Lucro', money(sr - sg)],
    ['ROI médio', num(rm, 1) + '%'],
    ['Break-even méd', num(bm, 2)],
  ];

  function toggleSort(k) {
    if (sortK === k) setSortD((d) => -d);
    else { setSortK(k); setSortD(k === 'name' ? 1 : -1); }
  }

  async function marcarOtimizada(c) {
    if (!c.campaign_id) return;
    setFlash(c.campaign_id);
    setTimeout(() => setFlash(null), 900);
    try {
      const r = await apiPost(`/campanha/${c.campaign_id}/otimizada`);
      if (r?.ultima_otimizacao) setOptim((o) => ({ ...o, [c.campaign_id]: r.ultima_otimizacao }));
    } catch {
      // Otimista: mantém o carimbo de agora mesmo se a rota demorar/errar; o refetch corrige.
      setOptim((o) => ({ ...o, [c.campaign_id]: new Date().toISOString() }));
    }
  }

  // Célula de uma coluna simples (ROI/date/reldate têm render próprio).
  function cell(c, col) {
    if (col.k === 'roi') return <td className="r" key={col.k}><RoiChip roi={roiOf(c)} /></td>;
    if (col.type === 'date') return <td className="r nowrap dt" key={col.k}>{fD(c[col.field])}</td>;
    if (col.type === 'reldate') return <td className="r nowrap dt" key={col.k}><OtimCell value={otimOf(c)} /></td>;
    const v = Number(c[col.field]) || 0;
    return <td className={`r ${col.signed ? (v >= 0 ? 'pos' : 'neg') : ''}`} key={col.k}>{fmtCell(col, v)}</td>;
  }

  return (
    <div className="campanhas-page" id="ca">
      <div className="sumstrip">
        {summary.map(([l, v]) => (
          <div className="sc" key={l}><div className="l">{l}</div><div className="v">{v}</div></div>
        ))}
      </div>

      <div className="filters">
        <input className="search" placeholder="⌕  Buscar campanha…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="fseg">
          {['todas', 'E1', 'E2', 'E3'].map((e) => (
            <button key={e} className={fEst === e ? 'on' : ''} onClick={() => setFEst(e)}>{e === 'todas' ? 'Todas' : e}</button>
          ))}
        </div>
        <select className="fsel" value={fCriada} onChange={(e) => setFCriada(e.target.value)}>
          <option value="all">Criada: qualquer</option>
          <option value="7">Criada ≤ 7 dias</option>
          <option value="30">Criada ≤ 30 dias</option>
          <option value="30+">Criada &gt; 30 dias</option>
        </select>
        <select className="fsel" value={fOtim} onChange={(e) => setFOtim(e.target.value)}>
          <option value="all">Otimização: qualquer</option>
          <option value="hoje">Otimizada hoje</option>
          <option value="3">Sem otimizar ≥ 3 dias</option>
          <option value="7">Sem otimizar ≥ 7 dias</option>
        </select>
        <span className="spacer" />
        <div className="colbtn">
          <button className="fchip" onClick={(e) => { e.stopPropagation(); setColOpen((o) => !o); }}>Colunas ▾</button>
          {colOpen && (
            <div className="colpanel open" onClick={(e) => e.stopPropagation()}>
              <h6>Métricas visíveis</h6>
              {COLS.map((c) => (
                <label className={`colopt ${c.lock ? 'locked' : ''}`} key={c.k}>
                  <input
                    type="checkbox"
                    checked={vis.has(c.k)}
                    disabled={!!c.lock}
                    onChange={() => setVis((s) => { const n = new Set(s); n.has(c.k) ? n.delete(c.k) : n.add(c.k); return n; })}
                  />
                  <span>{c.lb}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="wrap" onClick={() => colOpen && setColOpen(false)}>
        <table className="cmp-tbl">
          <thead>
            <tr>
              <th className="sortable" onClick={() => toggleSort('name')}>Campanha <Arrow col="name" sortK={sortK} sortD={sortD} /></th>
              {cols.map((c) => (
                <th key={c.k} className="r sortable" onClick={() => toggleSort(c.k)}>{c.lb} <Arrow col={c.k} sortK={sortK} sortD={sortD} /></th>
              ))}
              <th>Tendência</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const key = rowKey(c);
              const serie = c.roi_serie || [];
              const open = openKey === key;
              return (
                <FragmentRow
                  key={key}
                  c={c}
                  cols={cols}
                  open={open}
                  serie={serie}
                  cell={cell}
                  flash={flash === c.campaign_id}
                  onOtim={() => marcarOtimizada(c)}
                  onReloginho={() => c.campaign_id && setModal({ campaignId: c.campaign_id, nome: c.ad_utm })}
                  onExpand={() => setOpenKey(open ? null : key)}
                  period={period}
                />
              );
            })}
            {sorted.length === 0 && (
              <tr><td className="cmp-empty" colSpan={cols.length + 3}>Nenhuma campanha no período/filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && <IntradayModal campaignId={modal.campaignId} nome={modal.nome} onClose={() => setModal(null)} />}
    </div>
  );
}

// Linha da campanha + linha de detalhe (conjuntos) quando expandida.
function FragmentRow({ c, cols, open, serie, cell, flash, onOtim, onReloginho, onExpand, period }) {
  const vals = serie.map((s) => Number(s.roi) || 0);
  const dates = serie.map((s) => s.data);
  return (
    <>
      <tr>
        <td>
          <div className="cmpname">
            {c.estrutura && <span className="est">{c.estrutura}</span>}
            <span className="cn"><b>{c.ad_utm}</b><small>{c.pais_nome || c.pagina || '—'}</small></span>
          </div>
        </td>
        {cols.map((col) => cell(c, col))}
        <td><Sparkline vals={vals} dates={dates} /></td>
        <td className="r">
          <span className="rowact">
            <span
              className={`iconbtn optbtn ${flash ? 'done' : ''} ${!c.campaign_id ? 'off' : ''}`}
              title={c.campaign_id ? 'Marcar como otimizada hoje' : 'Sem campaign_id (histórico legado)'}
              onClick={c.campaign_id ? onOtim : undefined}
            >✓</span>
            <span
              className={`iconbtn ${!c.campaign_id ? 'off' : ''}`}
              title={c.campaign_id ? 'Intraday (reloginho)' : 'Sem campaign_id (histórico legado)'}
              onClick={c.campaign_id ? onReloginho : undefined}
            >◷</span>
            <span className="iconbtn exp" title="Conjuntos" onClick={onExpand}>{open ? '▾' : '▸'}</span>
          </span>
        </td>
      </tr>
      {open && (
        <tr className="detrow">
          <td colSpan={cols.length + 3}>
            <ConjuntosDetail c={c} cols={cols} period={period} cell={cell} />
          </td>
        </tr>
      )}
    </>
  );
}

import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { GlassCard, KpiCard, StatTile, GlassTable, AreaTrend, HourLines } from '../design-system/index.js';
import { BRL, NUM, PCT } from '../lib/format.js';

const money = (n, d = 2) => 'R$ ' + (Number(n) || 0).toFixed(d).replace('.', ',');
const ratio = (n, d = 2) => (Number(n) || 0).toFixed(d).replace('.', ',');
const pctLabel = (v, pts = false) => (v == null ? null : `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(1)}${pts ? ' pts' : '%'}`);
const pctTone = (v) => (v == null ? 'up' : v >= 0 ? 'up' : 'down');

const HOUR_METRICS = [
  { key: 'receita', label: 'Receita' },
  { key: 'investimento', label: 'Investimento' },
  { key: 'roi', label: 'ROI' },
  { key: 'ecpm', label: 'eCPM' },
  { key: 'impressoes', label: 'Impressões' },
  { key: 'sessoes', label: 'Sessões' },
  { key: 'resultado', label: 'Resultado' },
  { key: 'conversas', label: 'Conversas' },
  { key: 'custo_resultado', label: 'Custo/Result' },
  { key: 'par', label: 'PAR' },
];

function qs(period, domain) {
  const q = new URLSearchParams();
  if (period?.since) q.set('since', period.since);
  if (period?.until) q.set('until', period.until);
  if (domain && domain !== 'all') q.set('domain', domain);
  const s = q.toString();
  return s ? `?${s}` : '';
}

function Skeleton() {
  return (
    <div>
      <div className="ov-hero">{[0, 1, 2, 3].map((i) => <div key={i} className="ds-skel" style={{ height: 132 }} />)}</div>
      <div className="ov-g6" style={{ marginTop: 22 }}>{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="ds-skel" style={{ height: 74 }} />)}</div>
      <div className="ds-skel" style={{ height: 260, marginTop: 22 }} />
    </div>
  );
}

export default function Overview({ period, domain }) {
  const [metric, setMetric] = useState('receita');
  const { data, loading, error } = useApi(`/overview${qs(period, domain)}`, [period?.since, period?.until, domain]);
  const intra = useApi(`/intraday${domain && domain !== 'all' ? `?domain=${encodeURIComponent(domain)}` : ''}`, [domain]);

  if (loading) return <Skeleton />;
  if (error) return <GlassCard style={{ padding: 20 }}><span className="neg">Erro ao carregar: {error}</span></GlassCard>;

  const k = data.kpis || {};
  const c = data.comparacao || {};
  const trend = data.trend || [];
  const prev = data.previsao;
  const custoResultado = k.results > 0 ? k.investimento / k.results : 0;

  const spark = (key) => trend.map((t) => Number(t[key]) || 0);
  const chartData = trend.map((t) => ({ ...t, date: t.date ? `${t.date.slice(8, 10)}/${t.date.slice(5, 7)}` : '' }));
  const topCamps = (data.topCampaigns || []).slice(0, 8);
  const curMetric = HOUR_METRICS.find((m) => m.key === metric) || HOUR_METRICS[0];

  return (
    <div>
      {/* Herói */}
      <div className="ov-hero">
        <KpiCard label="Receita GAM (líq.)" value={BRL(k.faturamento)} delta={pctLabel(c.faturamento)} deltaTone={pctTone(c.faturamento)} spark={spark('faturamento')} tone="pos" />
        <KpiCard label="Investimento Meta" value={BRL(k.investimento)} delta={pctLabel(c.investimento)} deltaTone={pctTone(c.investimento)} spark={spark('investimento')} />
        <KpiCard label="Lucro líquido" value={BRL(k.lucro)} delta={pctLabel(c.lucro)} deltaTone={pctTone(c.lucro)} spark={spark('lucro')} tone={k.lucro >= 0 ? 'pos' : 'neg'} />
        <KpiCard label="ROI" value={PCT(k.roi)} delta={pctLabel(c.roi, true)} deltaTone={pctTone(c.roi)} spark={spark('roas')} />
      </div>

      {/* GAM */}
      <div className="ov-sec-lbl">Google Ad Manager</div>
      <div className="ov-g6">
        <StatTile label="eCPM" badge="GAM" value={money(k.ecpm)} delta={pctLabel(c.gamEcpm)} deltaTone={pctTone(c.gamEcpm)} />
        <StatTile label="RPS" badge="GAM" value={money(k.rps, 4)} hint="Receita por sessão" />
        <StatTile label="CPC" badge="GAM" value={money(k.cpc)} />
        <StatTile label="CTR" badge="GAM" value={PCT(k.ctr, 2)} delta={pctLabel(c.gamCtr)} deltaTone={pctTone(c.gamCtr)} />
        <StatTile label="Impressões" badge="GAM" value={NUM(k.impressions)} delta={pctLabel(c.gamImpressions)} deltaTone={pctTone(c.gamImpressions)} />
        <StatTile label="PAR" value={ratio(k.par)} hint="Impressões GAM ÷ sessões (view_content Meta)" />
      </div>

      {/* Meta / funil */}
      <div className="ov-sec-lbl">Meta (funil)</div>
      <div className="ov-g4">
        <StatTile label="Sessões" value={NUM(k.sessoes)} hint="view_content (Meta)" />
        <StatTile label="Resultado" value={NUM(k.results)} />
        <StatTile label="Custo/Resultado" value={money(custoResultado)} hint="Investimento ÷ resultado" />
        <StatTile label="Viewability" value={PCT(k.viewability, 1)} />
      </div>

      {/* Pacing / previsão do dia */}
      {prev && (
        <>
          <div className="ov-sec-lbl">Pacing do dia {k.delayHours > 0 && <span className="ds-stat-badge" style={{ color: 'var(--warn)', background: 'color-mix(in srgb,var(--warn) 16%,transparent)' }}>atraso {k.delayHours}h</span>}</div>
          <div className="ov-g3">
            <StatTile label="Orçamento" value={BRL(prev.orcamento_total)} />
            <StatTile label="Valor usado" value={BRL(prev.gasto_atual)} />
            <StatTile label="Falta gastar" value={BRL(prev.orcamento_restante)} />
          </div>
          <div className="ov-g3" style={{ marginTop: 12 }}>
            <StatTile label="Faturamento previsto" value={BRL(prev.faturamento_real_previsto)} tone="pos" />
            <StatTile label="Lucro previsto" value={BRL(prev.lucro_previsto)} tone={prev.lucro_previsto >= 0 ? 'pos' : 'neg'} />
            <StatTile label="ROAS previsto" value={ratio(prev.roas_previsto)} />
          </div>
        </>
      )}

      {/* Gráfico por dia + resumo */}
      <div className="ov-charts" style={{ marginTop: 22 }}>
        <GlassCard className="ds-panel">
          <div className="ds-panel-hd">
            <h3>Performance por dia</h3>
            <div className="ds-legend">
              <span><i style={{ background: 'var(--pos)' }} />Receita</span>
              <span><i style={{ background: 'var(--accent)' }} />Gasto</span>
            </div>
          </div>
          <AreaTrend data={chartData} xKey="date" series={[{ key: 'faturamento', color: 'var(--pos)', label: 'Receita' }, { key: 'investimento', color: 'var(--accent)', label: 'Gasto' }]} />
        </GlassCard>
        <GlassCard className="ds-panel">
          <div className="ds-panel-hd"><h3>Resumo</h3></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <ResumoRow label="Receita bruta GAM" value={BRL(k.faturamento_bruto)} />
            <ResumoRow label="ROAS" value={ratio(k.roas)} />
            <ResumoRow label="Taxa programática" value={PCT(k.taxaProgramatica, 1)} />
            <ResumoRow label="CPA ideal" value={money(k.cpaIdeal, 4)} />
            <ResumoRow label="Câmbio USD→BRL" value={money(k.usdToBrl, 4)} />
          </div>
        </GlassCard>
      </div>

      {/* Gráfico por hora (intraday) */}
      <div className="ov-sec-lbl">Performance por hora <span className="ds-stat-badge">hoje vs ontem</span></div>
      <GlassCard className="ds-panel">
        <div className="ds-panel-hd" style={{ marginBottom: 10 }}>
          <div className="ds-hour-legend">
            <span><i style={{ background: 'var(--accent)' }} />Hoje</span>
            <span><i style={{ background: 'var(--fg-3)' }} />Ontem</span>
          </div>
          {intra.data?.hora_atual != null && <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>até {String(intra.data.hora_atual).padStart(2, '0')}h · Brasília</span>}
        </div>
        <div className="ds-ctogs">
          {HOUR_METRICS.map((m) => (
            <button key={m.key} className={`ds-ctog ${metric === m.key ? 'on' : ''}`} onClick={() => setMetric(m.key)}>{m.label}</button>
          ))}
        </div>
        {intra.loading && <div style={{ height: 240 }} className="ds-skel" />}
        {!intra.loading && intra.data?.sem_dados && <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--fg-3)' }}>Sem dados intraday para o período.</div>}
        {!intra.loading && intra.data && !intra.data.sem_dados && (
          <HourLines hoje={intra.data.hoje || []} ontem={intra.data.ontem || []} metricKey={curMetric.key} color="var(--accent)" />
        )}
      </GlassCard>

      {/* Top campanhas */}
      <div className="ov-sec-lbl">Top campanhas</div>
      <GlassTable
        columns={[
          { key: 'name', label: 'Campanha' },
          { key: 'domain', label: 'Domínio', render: (r) => r.domain || '—' },
          { key: 'spend', label: 'Investido', align: 'right', render: (r) => <span className="num">{BRL(r.spend)}</span> },
          { key: 'faturado', label: 'Faturamento', align: 'right', render: (r) => <span className="num">{BRL(r.faturado)}</span> },
          { key: 'lucro', label: 'Lucro', align: 'right', render: (r) => <span className={`num ${r.lucro >= 0 ? 'pos' : 'neg'}`}>{BRL(r.lucro)}</span> },
          { key: 'roas', label: 'ROAS', align: 'right', render: (r) => <span className="num">{ratio(r.roas)}</span> },
          { key: 'roi', label: 'ROI', align: 'right', render: (r) => <span className={`num ${r.roi >= 0 ? 'pos' : 'neg'}`}>{PCT(r.roi)}</span> },
        ]}
        rows={topCamps.map((u, i) => ({ ...u, id: u.ad_utm || i }))}
      />
    </div>
  );
}

function ResumoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottom: '1px solid var(--hair-soft)' }}>
      <span style={{ color: 'var(--fg-2)' }}>{label}</span>
      <span className="num" style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

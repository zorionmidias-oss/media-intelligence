import { useApi } from '../../hooks/useApi.js';
import HeroCard from './HeroCard.jsx';
import MetricCard from './MetricCard.jsx';
import DailyChart from './DailyChart.jsx';
import HourTable from './HourTable.jsx';
import { BRL, PCT, NUM } from '../../lib/format.js';
import './overview.css';

// Dinheiro com decimais configuráveis (mesmo helper de frontend/src/pages/Overview.jsx antigo).
const money = (n, d = 2) => 'R$ ' + (Number(n) || 0).toFixed(d).replace('.', ',');
// Número simples com decimais configuráveis (PAR, sessão/lead).
const num1 = (n, d = 1) => (Number(n) || 0).toFixed(d).replace('.', ',');

function HeroSkeleton() {
  return (
    <div className="ov-hero">
      {[0, 1, 2, 3].map((i) => <div key={i} className="ov-skel" />)}
    </div>
  );
}

function MinisSkeleton() {
  return (
    <div className="ov-minis">
      {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="ov-skel ov-skel-sm" />)}
    </div>
  );
}

export default function Overview() {
  const { data, loading, error } = useApi('/overview', []);

  if (loading) {
    return (
      <div className="overview-page">
        <HeroSkeleton />
        <MinisSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="overview-page">
        <p className="ov-error">Erro ao carregar: {error}</p>
      </div>
    );
  }

  const k = data?.kpis || {};
  const c = data?.comparacao || {};
  const trend = data?.trend || [];
  const serie = (key) => trend.map((t) => Number(t[key]) || 0);
  // ROI não vem no trend diário — deriva de ROAS (ROI% = (ROAS-1)*100, mesma fórmula de src/lib/metricas.js).
  const roiSerie = serie('roas').map((r) => (r - 1) * 100);

  const heroes = [
    { label: 'Receita', value: k.faturamento, deltaPct: c.faturamento, trend: serie('faturamento'), fmt: 'money', tone: 'pos' },
    { label: 'Investimento', value: k.investimento, deltaPct: c.investimento, trend: serie('investimento'), fmt: 'money', tone: c.investimento < 0 ? 'neg' : 'pos' },
    { label: 'Lucro líquido', value: k.lucro, deltaPct: c.lucro, trend: serie('lucro'), fmt: 'money', tone: k.lucro >= 0 ? 'pos' : 'neg' },
    { label: 'ROI', value: k.roi, deltaPct: c.roi, deltaUnit: 'pts', trend: roiSerie, fmt: 'pct', tone: k.roi >= 0 ? 'pos' : 'neg' },
  ];

  // Faixa de cards menores — sem sparkline (decisão do dono, 01/09: /api/overview.trend[]
  // não traz série diária dessas métricas; delta só onde `comparacao` fornece).
  const custoResultado = k.results > 0 ? k.investimento / k.results : 0;
  const sessaoLead = k.results > 0 ? k.sessoes / k.results : 0;

  const minis = [
    { label: 'eCPM', value: money(k.ecpm, 2), deltaPct: c.gamEcpm, up: c.gamEcpm >= 0 },
    { label: 'RPS', value: money(k.rps, 4) },
    { label: 'Impressões', value: NUM(k.impressions), deltaPct: c.gamImpressions, up: c.gamImpressions >= 0 },
    { label: 'Custo / result', value: money(custoResultado, 2) },
    { label: 'PAR', value: num1(k.par, 1) },
    { label: 'Sessão / lead', value: num1(sessaoLead, 1) },
  ];

  // Top campanhas — tabela do rodapé (slice para as ~8 mais relevantes vindas da API).
  const topCampaigns = (data?.topCampaigns || []).slice(0, 8);

  const resumo = [
    { label: 'Receita bruta GAM', value: BRL(k.faturamento_bruto) },
    { label: 'ROAS', value: num1(k.roas, 2) },
    { label: 'Taxa programática', value: PCT(k.taxaProgramatica, 1) },
    { label: 'CPA ideal', value: money(k.cpaIdeal, 4) },
    { label: 'Câmbio USD→BRL', value: money(k.usdToBrl, 4) },
  ];

  return (
    <div className="overview-page">
      <div className="ov-hero">
        {heroes.map((h) => <HeroCard key={h.label} {...h} />)}
      </div>
      <div className="ov-minis">
        {minis.map((m) => <MetricCard key={m.label} {...m} />)}
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="ph">
            <h3>Performance por dia</h3>
            <div className="lg">
              <span><i className="rev" />Receita</span>
              <span><i className="spd" />Gasto</span>
              <span><i className="roi" />ROI %</span>
            </div>
          </div>
          <DailyChart trend={trend} />
        </div>
        <div className="panel resumo">
          <div className="ph"><h3>Resumo</h3></div>
          {resumo.map((r) => (
            <div className="rr" key={r.label}><span>{r.label}</span><b>{r.value}</b></div>
          ))}
        </div>
      </div>
      <HourTable />

      <div className="panel">
        <div className="ph"><h3>Top campanhas</h3></div>
        <table>
          <thead>
            <tr>
              <th>Campanha</th>
              <th>Domínio</th>
              <th className="r">Investido</th>
              <th className="r">Faturamento</th>
              <th className="r">Lucro</th>
              <th className="r">ROAS</th>
              <th className="r">ROI</th>
            </tr>
          </thead>
          <tbody>
            {topCampaigns.map((c) => (
              <tr key={c.ad_utm}>
                <td>{c.name}</td>
                <td className="dom">{c.domain || '—'}</td>
                <td className="r">{BRL(c.spend)}</td>
                <td className="r">{BRL(c.faturado)}</td>
                <td className={`r ${Number(c.lucro) >= 0 ? 'pos' : 'neg'}`}>{BRL(c.lucro)}</td>
                <td className="r">{num1(c.roas, 2)}</td>
                <td className={`r ${Number(c.roi) >= 0 ? 'pos' : 'neg'}`}>{PCT(c.roi, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

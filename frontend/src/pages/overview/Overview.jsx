import { useApi } from '../../hooks/useApi.js';
import HeroCard from './HeroCard.jsx';
import MetricCard from './MetricCard.jsx';
import DailyChart from './DailyChart.jsx';
import HourTable from './HourTable.jsx';
import RoiPorPais from './RoiPorPais.jsx';
import { BRL, PCT, NUM, filterQs } from '../../lib/format.js';
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

export default function Overview({ period, domain }) {
  const qs = filterQs({ since: period?.since, until: period?.until, domain });
  const { data, loading, error } = useApi(`/overview${qs}`, [period?.since, period?.until, domain]);

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
  // Task 14: trend[] é SEMPRE os últimos 30 dias (fixo no backend), independente
  // do período do calendário — hero/Performance por dia/sparklines não mudam ao
  // trocar since/until; só os KPIs (k) e comparacao (c) acima seguem o calendário.
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

  // Faixa de cards menores — sparkline com a série diária real de cada métrica,
  // vinda de trend[] (Task 11, 02/09: /api/overview enriquecido; Task 13:
  // `comparacao` agora cobre as 6 métricas — delta ▲/▼ colorido só pelo sinal
  // numérico do delta, mesma convenção do HeroCard (`up = deltaPct >= 0`), sem
  // inverter cor p/ métricas "de custo" — mantém regra única e previsível).
  const custoResultado = k.results > 0 ? k.investimento / k.results : 0;
  const sessaoLead = k.results > 0 ? k.sessoes / k.results : 0;

  const minis = [
    { label: 'eCPM', value: money(k.ecpm, 2), deltaPct: c.gamEcpm, up: c.gamEcpm >= 0, series: serie('ecpm') },
    { label: 'RPS', value: money(k.rps, 4), deltaPct: c.rps, up: c.rps >= 0, series: serie('rps') },
    { label: 'Impressões', value: NUM(k.impressions), deltaPct: c.gamImpressions, up: c.gamImpressions >= 0, series: serie('impressions') },
    { label: 'Custo / result', value: money(custoResultado, 2), deltaPct: c.custoResult, up: c.custoResult >= 0, series: serie('custo_result') },
    { label: 'PAR', value: num1(k.par, 1), deltaPct: c.par, up: c.par >= 0, series: serie('par') },
    { label: 'Sessão / lead', value: num1(sessaoLead, 1), deltaPct: c.sessaoLead, up: c.sessaoLead >= 0, series: serie('sessao_lead') },
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
      <HourTable period={period} domain={domain} />

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

      <RoiPorPais domain={domain} />
    </div>
  );
}

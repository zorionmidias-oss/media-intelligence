import { useApi } from '../../hooks/useApi.js';
import HeroCard from './HeroCard.jsx';
import './overview.css';

function HeroSkeleton() {
  return (
    <div className="ov-hero">
      {[0, 1, 2, 3].map((i) => <div key={i} className="ov-skel" />)}
    </div>
  );
}

export default function Overview() {
  const { data, loading, error } = useApi('/overview', []);

  if (loading) {
    return (
      <div className="overview-page">
        <HeroSkeleton />
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

  return (
    <div className="overview-page">
      <div className="ov-hero">
        {heroes.map((h) => <HeroCard key={h.label} {...h} />)}
      </div>
      {/* Próximas seções (cards menores, performance por dia/hora, top campanhas) entram aqui em tasks futuras. */}
    </div>
  );
}

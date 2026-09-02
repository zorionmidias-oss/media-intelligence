import { useState } from 'react';
import Shell from './app/Shell.jsx';
import Filters from './app/Filters.jsx';
import Overview from './pages/overview/Overview.jsx';
import { periodPresets } from './lib/datas.js';

const TITLES = {
  overview: 'Visão geral',
  campanhas: 'Campanhas',
  gam: 'Relatório GAM',
  contas: 'Contas',
  acessos: 'Acessos',
  dominios: 'Domínios',
};

// Período padrão = 14 dias (fuso BR, via periodPresets/hojeBR de lib/datas.js).
function defaultPeriod() {
  const p = periodPresets().find((x) => x.key === '14d');
  return { since: p.since, until: p.until, label: p.label };
}

export default function App() {
  const [active, setActive] = useState('overview');
  const [period, setPeriod] = useState(defaultPeriod);
  const [domain, setDomain] = useState('all');

  const headerRight = (
    <Filters period={period} onPeriodChange={setPeriod} domain={domain} onDomainChange={setDomain} />
  );

  return (
    <Shell active={active} title={TITLES[active]} onNavigate={setActive} headerRight={headerRight}>
      {active === 'overview'
        ? <Overview period={period} domain={domain} />
        : <p className="placeholder">{TITLES[active]} — em construção</p>}
    </Shell>
  );
}

import { useState } from 'react';
import AppShell from './layouts/AppShell.jsx';
import { ThemeToggle } from './design-system/index.js';
import PeriodFilter from './components/PeriodFilter.jsx';
import DomainSelect from './components/DomainSelect.jsx';
import { IcBell } from './components/icons.jsx';
import { periodPresets } from './lib/datas.js';
import Demo from './design-system/_demo.jsx';
import Overview from './pages/Overview.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Countries from './pages/Countries.jsx';
import './index.css';

const TITLES = { overview: 'Visão geral', campaigns: 'Campanhas', countries: 'Países' };

export default function App() {
  const [active, setActive] = useState('overview');
  const [period, setPeriod] = useState(() => periodPresets().find((p) => p.key === '14d'));
  const [domain, setDomain] = useState('all');

  // Galeria de primitivos (validação por screenshot). Ver Task 14.
  if (new URLSearchParams(window.location.search).get('demo')) return <Demo />;

  const right = (
    <>
      <PeriodFilter value={period} onChange={setPeriod} />
      <DomainSelect value={domain} onChange={setDomain} />
      <button className="ds-icbtn" title="Notificações"><IcBell /></button>
      <ThemeToggle />
    </>
  );

  const props = { period, domain };
  return (
    <AppShell active={active} onNavigate={setActive} title={TITLES[active] || ''} subtitle={period?.label} headerRight={right}>
      {active === 'overview' && <Overview {...props} />}
      {active === 'campaigns' && <Campaigns {...props} />}
      {active === 'countries' && <Countries {...props} />}
    </AppShell>
  );
}

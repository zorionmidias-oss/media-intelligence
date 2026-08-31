import { useState } from 'react';
import AppShell from './layouts/AppShell.jsx';
import { Segment, ThemeToggle } from './design-system/index.js';
import { IcBell } from './components/icons.jsx';
import Demo from './design-system/_demo.jsx';
import Overview from './pages/Overview.jsx';
import Campaigns from './pages/Campaigns.jsx';
import Countries from './pages/Countries.jsx';
import './index.css';

const TITLES = {
  overview: { t: 'Visão geral', s: '' },
  campaigns: { t: 'Campanhas', s: '' },
  countries: { t: 'Países', s: '' },
};

export default function App() {
  const [active, setActive] = useState('overview');
  const [seg, setSeg] = useState('14d');

  // Galeria de primitivos (validação por screenshot). Ver Task 14.
  if (new URLSearchParams(window.location.search).get('demo')) return <Demo />;

  const meta = TITLES[active] || { t: '', s: '' };
  const right = (
    <>
      <Segment
        options={[{ value: '7d', label: '7d' }, { value: '14d', label: '14d' }, { value: '30d', label: '30d' }]}
        value={seg}
        onChange={setSeg}
      />
      <button className="ds-icbtn" title="Notificações"><IcBell /></button>
      <ThemeToggle />
    </>
  );

  return (
    <AppShell active={active} onNavigate={setActive} title={meta.t} subtitle={meta.s} headerRight={right}>
      {active === 'overview' && <Overview />}
      {active === 'campaigns' && <Campaigns />}
      {active === 'countries' && <Countries />}
    </AppShell>
  );
}

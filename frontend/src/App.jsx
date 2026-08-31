import { useState } from 'react';
import MainLayout from './layouts/MainLayout';
import Overview from './pages/Overview';
import Campaigns from './pages/Campaigns';
import Countries from './pages/Countries';
import Reports from './pages/Reports';
import Demo from './design-system/_demo.jsx';
import './index.css';

export default function App() {
  const [active, setActive] = useState('Overview');

  // Galeria de primitivos para validação por screenshot (temporário, ver Task 14).
  if (new URLSearchParams(window.location.search).get('demo')) return <Demo />;

  return (
    <MainLayout active={active} setActive={setActive}>
      {active === 'Overview' && <Overview />}
      {active === 'Campaigns' && <Campaigns />}
      {active === 'Countries' && <Countries />}
      {active === 'Reports' && <Reports />}
      {active === 'Directory' && <div className="text-white text-center py-10">Directory - Coming soon</div>}
      {active === 'Settings' && <div className="text-white text-center py-10">Settings - Coming soon</div>}
    </MainLayout>
  );
}

import { useState } from 'react';
import Shell from './app/Shell.jsx';

const TITLES = {
  overview: 'Visão geral',
  campanhas: 'Campanhas',
  gam: 'Relatório GAM',
  contas: 'Contas',
  acessos: 'Acessos',
  dominios: 'Domínios',
};

export default function App() {
  const [active, setActive] = useState('overview');

  return (
    <Shell active={active} title={TITLES[active]} onNavigate={setActive}>
      <p className="placeholder">{TITLES[active]} — em construção</p>
    </Shell>
  );
}

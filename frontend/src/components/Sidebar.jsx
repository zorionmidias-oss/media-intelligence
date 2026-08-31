import { IcOverview, IcCampaigns, IcCountries, IcGam, IcFunil, IcRelatorios, IcContas, IcDiretorio, IcDomains } from './icons.jsx';

// Fase 1: overview/campaigns/countries prontos; demais marcados "em breve".
const NAV = [
  { id: 'overview', label: 'Visão geral', Icon: IcOverview, ready: true },
  { id: 'campaigns', label: 'Campanhas', Icon: IcCampaigns, ready: true },
  { id: 'countries', label: 'Países', Icon: IcCountries, ready: true },
  { id: 'gam', label: 'GAM', Icon: IcGam },
  { id: 'funil', label: 'Funil', Icon: IcFunil },
  { id: 'relatorios', label: 'Relatórios', Icon: IcRelatorios },
  { id: 'contas', label: 'Contas', Icon: IcContas },
  { id: 'diretorio', label: 'Diretório', Icon: IcDiretorio },
  { id: 'domains', label: 'Domínios', Icon: IcDomains },
];

export default function Sidebar({ active, onNavigate }) {
  return (
    <aside className="ds-side glass">
      <div className="ds-brand">
        <div className="logo">2J</div>
        <div><b>2Junior's</b><span>Inteligência de Mídia</span></div>
      </div>
      <nav className="ds-nav">
        {NAV.map(({ id, label, Icon, ready }) => (
          <button
            key={id}
            className={`ds-nav-btn ${active === id ? 'on' : ''} ${ready ? '' : 'soon'}`}
            onClick={() => ready && onNavigate?.(id)}
            disabled={!ready}
          >
            <span className="ic"><Icon /></span>
            <span className="lbl">{label}</span>
            {!ready && <span className="tag-soon">em breve</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
}

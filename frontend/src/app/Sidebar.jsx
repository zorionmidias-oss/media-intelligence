// Sidebar do shell — Black & Menta. Ordem fixa (Global Constraints): 6 telas, sem "Países".
// Ícones inline no estilo do protótipo (16x16, stroke) para consistência visual entre eles.
const NAV = [
  {
    id: 'overview',
    label: 'Visão geral',
    icon: <path d="M3 8l5-5 5 5v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  },
  {
    id: 'campanhas',
    label: 'Campanhas',
    icon: (
      <>
        <circle cx="8" cy="8" r="6" />
        <circle cx="8" cy="8" r="2" />
      </>
    ),
  },
  {
    id: 'gam',
    label: 'Relatório GAM',
    icon: <path d="M2 13h3v-3H2zM6.5 13h3V6h-3zM11 13h3V3h-3z" />,
  },
  {
    id: 'contas',
    label: 'Contas',
    icon: (
      <>
        <rect x="2" y="4" width="12" height="9" rx="1.5" />
        <path d="M2 7h12" />
      </>
    ),
  },
  {
    id: 'acessos',
    label: 'Acessos',
    icon: (
      <>
        <circle cx="8" cy="5.5" r="2.5" />
        <path d="M3 13c0-2.5 2.2-4 5-4s5 1.5 5 4" />
      </>
    ),
  },
  {
    id: 'dominios',
    label: 'Domínios',
    icon: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M2.2 8h11.6M8 2.2c2.4 2.4 2.4 9.2 0 11.6M8 2.2c-2.4 2.4-2.4 9.2 0 11.6" />
      </>
    ),
  },
];

export default function Sidebar({ active, onNavigate }) {
  return (
    <aside className="side">
      <div className="brand">
        <span className="logo">2J</span>
        <div>
          <b>2Junior's</b>
          <small>Inteligência de Mídia</small>
        </div>
      </div>
      <nav>
        {NAV.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className={`nav ${active === id ? 'on' : ''}`}
            onClick={() => onNavigate?.(id)}
          >
            <svg viewBox="0 0 16 16">{icon}</svg>
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}

import Sidebar from '../components/Sidebar.jsx';
import Topbar from '../components/Topbar.jsx';

export default function AppShell({ active, onNavigate, title, subtitle, headerRight, children }) {
  return (
    <div className="ds-shell">
      <Sidebar active={active} onNavigate={onNavigate} />
      <main className="ds-main">
        <Topbar title={title} subtitle={subtitle} right={headerRight} />
        <div className="ds-content">{children}</div>
      </main>
    </div>
  );
}

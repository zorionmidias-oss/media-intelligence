import Sidebar from './Sidebar.jsx';
import './shell.css';

export default function Shell({ active, title, headerRight, onNavigate, children }) {
  return (
    <div className="app-shell">
      <Sidebar active={active} onNavigate={onNavigate} />
      <main className="shell-main">
        <header className="shell-header">
          <h1>{title}</h1>
          {headerRight && <div className="shell-header-right">{headerRight}</div>}
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export default function Topbar({ title, subtitle, right }) {
  return (
    <header className="ds-top glass">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="sub">{subtitle}</div>}
      </div>
      <div className="tools">{right}</div>
    </header>
  );
}

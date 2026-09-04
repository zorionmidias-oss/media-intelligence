export default function Topbar({ title, right }) {
  return (
    <header className="ds-top glass">
      <h1>{title}</h1>
      <div className="tools">{right}</div>
    </header>
  );
}

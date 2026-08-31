// Controle segmentado (ex.: 7d / 14d / 30d).
export default function Segment({ options = [], value, onChange }) {
  return (
    <div className="ds-seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange?.(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

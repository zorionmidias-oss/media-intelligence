// Medidor em anel (ex.: break-even). value entre 0 e 1 (ou acima, limitado a 1 no arco).
export default function Gauge({ value = 0, cap = '' }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(Math.max(value, 0), 1));
  const label = (Number(value) || 0).toFixed(2).replace('.', ',');
  return (
    <div className="ds-gauge">
      <svg width="86" height="86" viewBox="0 0 86 86">
        <circle cx="43" cy="43" r={r} fill="none" stroke="var(--track)" strokeWidth="9" />
        <circle
          cx="43" cy="43" r={r} fill="none" stroke="var(--pos)" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 43 43)"
        />
      </svg>
      <div>
        <div className="big num">{label}</div>
        <div className="cap">{cap}</div>
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import { ptBR } from 'react-day-picker/locale';
import { format, subDays } from 'date-fns';
import { ptBR as ptDate } from 'date-fns/locale';
import 'react-day-picker/style.css';

function CalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}

// Seletor de período estilo Apple. value: { from, to } (Date). today: base p/ presets (fuso BR).
export default function DateRange({ value, onChange, today = new Date(), defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  const label = value?.from && value?.to
    ? `${format(value.from, 'dd MMM', { locale: ptDate })} – ${format(value.to, 'dd MMM', { locale: ptDate })}`
    : 'Selecionar período';

  const preset = (days) => onChange?.({ from: subDays(today, days - 1), to: today });

  return (
    <div className="flt-daterange" ref={ref}>
      <button className="flt-trigger" onClick={() => setOpen((o) => !o)}>
        <CalIcon /> {label}
      </button>
      {open && (
        <div className="flt-panel">
          <div className="flt-presets">
            <button onClick={() => preset(7)}>7 dias</button>
            <button onClick={() => preset(14)}>14 dias</button>
            <button onClick={() => preset(30)}>30 dias</button>
          </div>
          <DayPicker
            mode="range"
            locale={ptBR}
            selected={value}
            onSelect={onChange}
            defaultMonth={value?.from || today}
            numberOfMonths={1}
          />
        </div>
      )}
    </div>
  );
}

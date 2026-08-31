import { useState, useRef, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import { ptBR } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { periodPresets, fmtRange } from '../lib/datas.js';

const isoToDate = (iso) => (iso ? new Date(iso + 'T12:00:00') : undefined);
const dateToIso = (d) => d.toLocaleDateString('en-CA');

function CalIcon() {
  return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
}

// Filtro de período: presets (Hoje/Ontem/7/14/30/mês/mês passado) + calendário personalizado.
// value: { since, until, label }. onChange recebe o mesmo formato.
export default function PeriodFilter({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const presets = periodPresets();

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  const label = value?.label || (value?.since ? fmtRange(value.since, value.until) : 'Selecionar período');

  const pickPreset = (p) => { onChange?.({ since: p.since, until: p.until, label: p.label }); setOpen(false); };
  const pickRange = (range) => {
    if (range?.from && range?.to) {
      const since = dateToIso(range.from), until = dateToIso(range.to);
      onChange?.({ since, until, label: fmtRange(since, until) });
    }
  };

  return (
    <div className="ds-daterange" ref={ref}>
      <button className="ds-dr-trigger" onClick={() => setOpen((o) => !o)}>
        <CalIcon /> {label}
      </button>
      {open && (
        <div className="ds-dr-panel glass" style={{ display: 'flex', gap: 14 }}>
          <div className="ds-dr-presets" style={{ flexDirection: 'column', minWidth: 132 }}>
            {presets.map((p) => (
              <button key={p.key} className={value?.label === p.label ? 'on' : ''} onClick={() => pickPreset(p)}>{p.label}</button>
            ))}
          </div>
          <DayPicker
            mode="range"
            locale={ptBR}
            selected={{ from: isoToDate(value?.since), to: isoToDate(value?.until) }}
            onSelect={pickRange}
            defaultMonth={isoToDate(value?.since)}
            numberOfMonths={1}
          />
        </div>
      )}
    </div>
  );
}

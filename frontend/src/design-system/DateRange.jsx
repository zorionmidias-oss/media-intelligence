import { useState, useRef, useEffect } from 'react';
import { DayPicker } from 'react-day-picker';
import { ptBR } from 'react-day-picker/locale';
import {
  format, subDays, isSameDay,
  startOfMonth, endOfMonth, subMonths,
  startOfQuarter, endOfQuarter, subQuarters,
  startOfYear, endOfYear, subYears,
} from 'date-fns';
import { ptBR as ptDate } from 'date-fns/locale';
import { hojeBR } from '../lib/datas.js';
import 'react-day-picker/style.css';

function CalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="18" rx="3" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}

// "YYYY-MM-DD" (fuso BR, datas.js) -> Date local — base padrão dos presets/disabled,
// NUNCA `new Date()` cru (mesmo motivo do invariante em src/lib/datas.js).
function todayBR() {
  const [y, m, d] = hojeBR().split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Presets (pt-BR) calculados a partir de `today` (Date, fuso BR) via date-fns.
function buildPresets(today) {
  const lastMonth = subMonths(today, 1);
  const lastQuarter = subQuarters(today, 1);
  const lastYear = subYears(today, 1);
  return [
    { key: 'hoje', label: 'Hoje', from: today, to: today },
    { key: 'ontem', label: 'Ontem', from: subDays(today, 1), to: subDays(today, 1) },
    { key: '7d', label: 'Últimos 7 dias', from: subDays(today, 6), to: today },
    { key: '14d', label: 'Últimos 14 dias', from: subDays(today, 13), to: today },
    { key: '30d', label: 'Últimos 30 dias', from: subDays(today, 29), to: today },
    { key: '90d', label: 'Últimos 90 dias', from: subDays(today, 89), to: today },
    { key: 'mtd', label: 'Mês até hoje', from: startOfMonth(today), to: today },
    { key: 'qtd', label: 'Trimestre até hoje', from: startOfQuarter(today), to: today },
    { key: 'ytd', label: 'Ano até hoje', from: startOfYear(today), to: today },
    { key: 'mes-passado', label: 'Mês passado', from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) },
    { key: 'tri-passado', label: 'Trimestre passado', from: startOfQuarter(lastQuarter), to: endOfQuarter(lastQuarter) },
    { key: 'ano-passado', label: 'Ano passado', from: startOfYear(lastYear), to: endOfYear(lastYear) },
  ];
}

// Seletor de período: chip trigger + popover (barra lateral de presets + calendário
// range). value: { from, to } (Date). today: base p/ presets/disabled (fuso BR).
export default function DateRange({ value, onChange, today, defaultOpen = false }) {
  const base = today || todayBR();
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  // Ao abrir, sempre parte do período já aplicado (descarta rascunho anterior).
  const toggle = () => {
    if (!open) setDraft(value);
    setOpen((o) => !o);
  };

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

  const presets = buildPresets(base);
  const activePreset = presets.find((p) => value?.from && value?.to && isSameDay(p.from, value.from) && isSameDay(p.to, value.to));

  const apply = (range) => {
    onChange?.(range);
    setOpen(false);
  };

  // Seleção no calendário: com resetOnSelect, o 1º clique sempre inicia um range novo
  // (to fica undefined) — só aplica (e fecha) quando o range fica completo no 2º clique.
  const handleSelect = (range) => {
    setDraft(range);
    if (range?.from && range?.to) apply(range);
  };

  return (
    <div className="flt-daterange" ref={ref}>
      <button className="flt-trigger" onClick={toggle}>
        <CalIcon /> {label}
      </button>
      {open && (
        <div className="flt-panel flt-panel-cal">
          <div className="flt-presets">
            {presets.map((p) => (
              <button
                key={p.key}
                className={activePreset?.key === p.key ? 'on' : ''}
                onClick={() => apply({ from: p.from, to: p.to })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <DayPicker
            mode="range"
            locale={ptBR}
            selected={draft}
            onSelect={handleSelect}
            defaultMonth={draft?.to || base}
            numberOfMonths={1}
            today={base}
            disabled={{ after: base }}
            resetOnSelect
          />
        </div>
      )}
    </div>
  );
}

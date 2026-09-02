import { format } from 'date-fns';
import DateRange from '../design-system/DateRange.jsx';
import DomainSelect from '../components/DomainSelect.jsx';
import ThemeToggle from '../design-system/ThemeToggle.jsx';
import { hojeBR, fmtRange } from '../lib/datas.js';
import './filters.css';

// "Hoje" como Date local (fuso BR), NUNCA `new Date()` cru — evita presets errados se o
// relógio do navegador estiver em outro fuso (ver invariante em src/lib/datas.js).
function todayBRDate() {
  const [y, m, d] = hojeBR().split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "YYYY-MM-DD" → Date local (sem passar por UTC/toISOString, mesmo motivo acima).
function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Barra de filtros do shell (headerRight) — Período (calendário), Domínio e Tema.
// Estado vive em App.jsx; aqui só traduz Date (react-day-picker) <-> ISO (period.since/until).
export default function Filters({ period, onPeriodChange, domain, onDomainChange }) {
  const handlePeriod = (range) => {
    if (!range?.from || !range?.to) return; // seleção em progresso (drag no calendário)
    const since = format(range.from, 'yyyy-MM-dd');
    const until = format(range.to, 'yyyy-MM-dd');
    onPeriodChange?.({ since, until, label: fmtRange(since, until) });
  };

  return (
    <div className="flt-bar">
      <DateRange
        value={{ from: isoToDate(period.since), to: isoToDate(period.until) }}
        onChange={handlePeriod}
        today={todayBRDate()}
      />
      <DomainSelect value={domain} onChange={onDomainChange} />
      <ThemeToggle />
    </div>
  );
}

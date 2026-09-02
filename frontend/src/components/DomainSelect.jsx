import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../hooks/useApi.js';
import { IcCountries } from './icons.jsx';

function Chevron() {
  return (<svg className="flt-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>);
}

// Filtro de domínio — dropdown de vidro com busca (substitui o <select> nativo).
export default function DomainSelect({ value, onChange }) {
  const [doms, setDoms] = useState([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    apiGet('/dominios').then((d) => setDoms(Array.isArray(d) ? d : (d?.dominios || []))).catch(() => setDoms([]));
  }, []);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, []);

  const label = value === 'all' ? 'Todos os domínios' : value;
  const items = [{ nome: 'all', label: 'Todos os domínios' }, ...doms.map((d) => ({ nome: d.nome, label: d.nome }))];
  const filtered = q ? items.filter((d) => d.label.toLowerCase().includes(q.toLowerCase())) : items;
  const pick = (v) => { onChange?.(v); setOpen(false); setQ(''); };

  return (
    <div className="flt-daterange" ref={ref}>
      <button className="flt-trigger" onClick={() => setOpen((o) => !o)}>
        <IcCountries width="15" height="15" />
        <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <Chevron />
      </button>
      {open && (
        <div className="flt-panel flt-menu">
          {items.length > 7 && (
            <input className="flt-menu-search" placeholder="Buscar domínio…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          )}
          <div className="flt-menu-list">
            {filtered.map((d) => (
              <button key={d.nome} className={`flt-menu-item ${value === d.nome ? 'on' : ''}`} onClick={() => pick(d.nome)}>{d.label}</button>
            ))}
            {filtered.length === 0 && <div className="flt-menu-empty">Nenhum domínio</div>}
          </div>
        </div>
      )}
    </div>
  );
}

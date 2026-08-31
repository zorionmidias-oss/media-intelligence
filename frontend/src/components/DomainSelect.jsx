import { useEffect, useState } from 'react';
import { apiGet } from '../hooks/useApi.js';

// Filtro de domínio (glass). Popula de /api/dominios; valor 'all' = todos.
export default function DomainSelect({ value, onChange }) {
  const [doms, setDoms] = useState([]);
  useEffect(() => {
    apiGet('/dominios').then((d) => setDoms(Array.isArray(d) ? d : (d?.dominios || []))).catch(() => setDoms([]));
  }, []);
  return (
    <select className="ds-select" value={value} onChange={(e) => onChange?.(e.target.value)} title="Filtrar por domínio">
      <option value="all">Todos os domínios</option>
      {doms.map((d) => (
        <option key={d.id ?? d.nome} value={d.nome}>{d.nome}</option>
      ))}
    </select>
  );
}

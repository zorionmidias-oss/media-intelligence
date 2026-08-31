import { useEffect, useState } from 'react';

// Chamada única a uma rota /api/* (same-origin: proxy no dev, Express em prod).
export async function apiGet(path) {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  const data = await res.json();
  if (!res.ok) throw new Error((data && (data.error || data.erro)) || `HTTP ${res.status}`);
  return data;
}

// Hook de leitura: refaz o fetch quando `deps` muda. Retorna { data, loading, error }.
export function useApi(endpoint, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiGet(endpoint)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) { setError(e.message); setData(null); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}

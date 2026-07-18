'use strict';
// PostgREST/Supabase corta resultados em 1000 linhas. Em períodos longos isso
// SUBCONTAVA os agregados: junho tinha 1.215 linhas de ads_consolidados, o
// Overview somava só 1.000 → investimento R$17.5k em vez de R$21.8k → ROI
// aparecia 117% em vez de 74%. Pagina via .range() até esgotar.
// Recebe uma FÁBRICA de query (query do supabase é one-shot): fetchAll(() => supabase.from(...).select(...))
async function fetchAll(buildQuery, pageSize = 1000) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) return { data: out, error };
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { data: out, error: null };
}

module.exports = { fetchAll };

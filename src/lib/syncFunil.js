'use strict';
/*
 * Ponte trakeamento→dash: agrega leads/sessões por conjunto×dia (RPC funil_agregado no
 * trakeamento) e faz upsert em funil_conjunto no banco do dash.
 *
 * Chamado por dia (a RPC devolve ~300 linhas/dia; PostgREST corta rpc em 1000 — por isso
 * iteramos dia a dia). Bot ancora em captured_at; blog em occurred_at (ver a função SQL).
 */
const { DateTime } = require('luxon');
const supabase = require('./supabase');       // dash (destino)
const supabaseTrak = require('./supabaseTrak'); // trakeamento (fonte)

const COLS = ['data', 'adset_id', 'adset_name', 'campaign_id', 'account_id',
  'leads_entrada', 'cliques_ad', 'threads', 'leads_qualificados', 'sessoes', 'leads_com_sessao'];

async function syncFunilDia(dia) {
  const { data, error } = await supabaseTrak.rpc('funil_agregado', { d_from: dia, d_to: dia });
  if (error) throw new Error(`funil_agregado ${dia}: ${error.message}`);
  if (!data || !data.length) return 0;
  const now = new Date().toISOString();
  const rows = data
    .filter(r => r.adset_id)
    .map(r => { const o = { updated_at: now }; for (const c of COLS) o[c] = r[c]; return o; });
  const { error: upErr } = await supabase.from('funil_conjunto').upsert(rows, { onConflict: 'data,adset_id' });
  if (upErr) throw new Error(`upsert funil_conjunto ${dia}: ${upErr.message}`);
  return rows.length;
}

// Sincroniza um intervalo [since, until] (inclusive), dia a dia.
async function syncFunilConjunto({ since, until }) {
  if (!supabaseTrak) { console.warn('[funil] TRAKEAMENTO_* não configurado — pulando'); return 0; }
  let cur = DateTime.fromISO(since);
  const end = DateTime.fromISO(until);
  let total = 0;
  while (cur <= end) {
    const dia = cur.toISODate();
    try {
      const n = await syncFunilDia(dia);
      total += n;
      console.log(`[funil] ${dia}: ${n} conjuntos`);
    } catch (e) {
      console.warn(`[funil] ${dia} falhou: ${e.message}`);
    }
    cur = cur.plus({ days: 1 });
  }
  return total;
}

module.exports = { syncFunilConjunto, syncFunilDia };

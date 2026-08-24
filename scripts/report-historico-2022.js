'use strict';
// Historico de alteracoes de campanhas/conjuntos — 20 a 22/06/2026, todas as contas.
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OUTDIR = path.join(__dirname, '..', 'reports');

function txt(x) {
  if (x === null || x === undefined) return '';
  const s = String(x);
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function num(x, dec) {
  if (x === null || x === undefined || x === '') return '';
  const v = Number(x); if (Number.isNaN(v)) return '';
  return (dec === undefined ? String(v) : v.toFixed(dec)).replace('.', ',');
}
function spDateTime(iso) {
  // created_at e' UTC (TIMESTAMP via NOW()); converte p/ America/Sao_Paulo
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  const data = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  return { data, hora };
}

async function main() {
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

  const { data: hist, error } = await sb.from('historico_campanhas').select('*')
    .gte('created_at', '2026-06-20').lt('created_at', '2026-06-23')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);

  // usuarios
  const { data: users } = await sb.from('usuarios').select('id,nome,email');
  const userMap = Object.fromEntries((users || []).map(u => [u.id, u.nome || u.email || ('id ' + u.id)]));

  // mapa UTM -> {account_id, pais_sigla, pais_nome, campanha_meta} via ads_consolidados (mais recente)
  const utms = [...new Set(hist.map(h => h.ad_utm))];
  const utmMap = {};
  if (utms.length) {
    const { data: ac } = await sb.from('ads_consolidados')
      .select('ad_utm,account_id,pais_sigla,pais_nome,campanha_meta,data')
      .in('ad_utm', utms).order('data', { ascending: false });
    for (const r of ac || []) {
      if (!utmMap[r.ad_utm]) utmMap[r.ad_utm] = r; // primeira = mais recente
    }
  }

  const head = [
    'data_br', 'hora_br', 'created_at_utc', 'conta_anuncio', 'pais', 'campanha', 'ad_utm',
    'conjunto_id', 'conjunto_nome', 'acao', 'valor_antes', 'valor_depois', 'usuario',
    'spend_antes', 'fat_antes', 'lucro_antes', 'metricas_depois_24h', 'observacao'
  ];
  const rows = hist.map(h => {
    const { data, hora } = spDateTime(h.created_at);
    const u = utmMap[h.ad_utm] || {};
    const ma = h.metricas_antes || {};
    return [
      txt(data), txt(hora), txt(h.created_at),
      txt(u.account_id || ''), txt(u.pais_sigla ? `${u.pais_sigla} (${u.pais_nome || ''})` : ''),
      txt(u.campanha_meta || ''), txt(h.ad_utm),
      txt(h.adset_id), txt(h.adset_name), txt(h.acao), txt(h.valor_antes), txt(h.valor_depois),
      txt(userMap[h.usuario_id] || (h.usuario_id ? 'id ' + h.usuario_id : '')),
      num(ma.spend, 2), num(ma.fat, 2), num(ma.lucro, 2),
      txt(h.metricas_depois_24h ? JSON.stringify(h.metricas_depois_24h) : ''), txt(h.observacao)
    ];
  });

  const file = path.join(OUTDIR, 'historico_alteracoes_20-22jun.csv');
  fs.writeFileSync(file, '﻿' + [head.join(';'), ...rows.map(r => r.join(';'))].join('\r\n'), 'utf8');

  // resumo
  console.log(`${rows.length} alteracoes -> ${file}`);
  const byAcao = {}, byUser = {}, byUtm = {};
  for (const h of hist) {
    byAcao[h.acao] = (byAcao[h.acao] || 0) + 1;
    byUser[userMap[h.usuario_id] || h.usuario_id] = (byUser[userMap[h.usuario_id] || h.usuario_id] || 0) + 1;
    byUtm[h.ad_utm] = (byUtm[h.ad_utm] || 0) + 1;
  }
  console.log('por acao:', JSON.stringify(byAcao));
  console.log('por usuario:', JSON.stringify(byUser));
  console.log('por UTM:', JSON.stringify(byUtm));
}

main().catch(e => { console.error(e); process.exit(1); });

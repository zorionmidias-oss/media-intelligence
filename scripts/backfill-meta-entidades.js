'use strict';
// Backfill da dimensão meta_entidades com TODOS os ads das contas ativas (metadados
// apenas — nomes/ids/page_id; nenhum valor financeiro é tocado), e carimbo de
// campaign_id no histórico:
//   • receita_ads: por ad_id (exato, sem ambiguidade)
//   • ads_consolidados: por (account_id, ad_utm) SÓ quando o utm mapeia para uma
//     única campanha; utms ambíguos (mesmo nome de anúncio em 2+ campanhas — caso
//     "eliana") ficam null e são listados no relatório final.
// Executar: node scripts/backfill-meta-entidades.js
require('dotenv').config({ path: '.env.local' });
const axios = require('axios');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { extractDomainPrefix, extractAdUTM, extractTipo, extractPaisSigla, extractNicho } = require('../src/lib/parser');

const BASE = 'https://graph.facebook.com/v19.0';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Campos aninhados (adset/creative) pesam — contas grandes rejeitam limit alto com
// "Please reduce the amount of data". Tenta 100 → 25 → 5 por página.
async function fetchAllAds(accountId, token) {
  for (const limit of [100, 25, 5]) {
    try {
      const ads = [];
      let url = `${BASE}/${accountId}/ads`;
      let params = {
        access_token: token,
        fields: 'id,name,adset_id,adset{name,promoted_object{page_id}},campaign{id,name},creative{object_story_spec{page_id}}',
        limit,
      };
      while (url) {
        const r = await axios.get(url, { params, timeout: 60000 });
        ads.push(...(r.data?.data || []));
        url = r.data?.paging?.next || null;
        params = undefined;
      }
      return ads;
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.message;
      if (!/reduce the amount of data/i.test(msg)) throw e;
      console.warn(`  ${accountId}: limit=${limit} rejeitado, tentando menor...`);
    }
  }
  throw new Error('todas as tentativas de limit falharam');
}

(async () => {
  const ref = (process.env.SUPABASE_URL || '').replace('https://', '').split('.')[0];
  console.log('Projeto alvo:', ref);
  if (ref !== 'vhqjkpspjpfewanlomwu') { console.log('❌ ref inesperado. Abortando.'); process.exit(1); }

  const { data: dominios } = await supabase.from('dominios').select('id,prefixo_campanha').eq('ativo', true);
  const domByPrefix = {};
  for (const d of dominios || []) domByPrefix[d.prefixo_campanha.toUpperCase()] = d.id;

  const { data: accounts } = await supabase.from('meta_accounts')
    .select('ad_account_id,access_token,nome').eq('ativo', true);

  const rows = [];
  for (const acc of accounts || []) {
    if (!acc.access_token) continue;
    const accountId = String(acc.ad_account_id).startsWith('act_') ? String(acc.ad_account_id) : `act_${acc.ad_account_id}`;
    try {
      const ads = await fetchAllAds(accountId, acc.access_token);
      console.log(`${acc.nome || accountId}: ${ads.length} ads`);
      for (const ad of ads) {
        const campaignName = ad.campaign?.name || null;
        const prefix = extractDomainPrefix(campaignName);
        const utm = extractAdUTM(ad.name);
        if (!utm) continue;
        rows.push({
          ad_id: String(ad.id),
          adset_id: ad.adset_id ? String(ad.adset_id) : null,
          campaign_id: ad.campaign?.id ? String(ad.campaign.id) : null,
          page_id: ad.adset?.promoted_object?.page_id || ad.creative?.object_story_spec?.page_id || null,
          ad_name: ad.name || null,
          adset_name: ad.adset?.name || null,
          campaign_name: campaignName,
          ad_utm: utm,
          dominio_id: prefix ? (domByPrefix[prefix.toUpperCase()] || null) : null,
          account_id: accountId,
          tipo: extractTipo(campaignName),
          pais_sigla: extractPaisSigla(ad.adset?.name) || extractPaisSigla(campaignName) || null,
          nicho: extractNicho(ad.adset?.name, campaignName),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn(`⚠ ${accountId}:`, e.response?.data?.error?.message || e.message);
    }
  }

  console.log(`\nUpsert de ${rows.length} entidades...`);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('meta_entidades').upsert(rows.slice(i, i + 500), { onConflict: 'ad_id' });
    if (error) { console.error('❌ upsert:', error.message); process.exit(2); }
  }
  console.log('✅ dimensão populada');

  // ── Carimbos no histórico (SQL direto — join eficiente) ──
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r1 = await c.query(`
      UPDATE receita_ads ra
      SET campaign_id = me.campaign_id,
          page_id     = COALESCE(ra.page_id, me.page_id)
      FROM meta_entidades me
      WHERE ra.ad_id = me.ad_id
        AND (ra.campaign_id IS DISTINCT FROM me.campaign_id OR ra.page_id IS NULL)`);
    console.log(`receita_ads: ${r1.rowCount} linhas carimbadas (por ad_id, exato)`);

    const r2 = await c.query(`
      UPDATE ads_consolidados ac
      SET campaign_id = me.campaign_id
      FROM (
        SELECT account_id, ad_utm, MIN(campaign_id) AS campaign_id
        FROM meta_entidades
        WHERE campaign_id IS NOT NULL AND account_id IS NOT NULL
        GROUP BY account_id, ad_utm
        HAVING COUNT(DISTINCT campaign_id) = 1
      ) me
      WHERE ac.campaign_id IS NULL
        AND ac.account_id = me.account_id
        AND ac.ad_utm = me.ad_utm`);
    console.log(`ads_consolidados: ${r2.rowCount} linhas carimbadas (utm→campanha inequívoco)`);

    const amb = await c.query(`
      SELECT account_id, ad_utm, COUNT(DISTINCT campaign_id) AS n,
             array_agg(DISTINCT campaign_name) AS campanhas
      FROM meta_entidades
      WHERE campaign_id IS NOT NULL
      GROUP BY account_id, ad_utm
      HAVING COUNT(DISTINCT campaign_id) > 1
      ORDER BY n DESC`);
    if (amb.rows.length) {
      console.log(`\n⚠ ${amb.rows.length} UTMs ambíguos (mesmo nome de anúncio em campanhas diferentes — ficam sem carimbo no histórico):`);
      for (const r of amb.rows) console.log(`  ${r.account_id} "${r.ad_utm}" → ${r.n} campanhas: ${r.campanhas.join(' | ')}`);
    } else {
      console.log('\n✅ nenhum UTM ambíguo — histórico 100% carimbável');
    }

    const resto = await c.query(`SELECT COUNT(*)::int AS n FROM ads_consolidados WHERE campaign_id IS NULL`);
    console.log(`ads_consolidados sem campaign_id restantes: ${resto.rows[0].n}`);
  } finally {
    await c.end().catch(() => {});
  }
})();

'use strict';
require('dotenv').config({ path: '.env.local' });
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { extractAdUTM } = require('../src/lib/parser');

const BASE = 'https://graph.facebook.com/v19.0';

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

async function getMetaUTMs() {
  const utms = new Set();
  for (let i = 1; i <= 5; i++) {
    const token = process.env[`META_ACCESS_TOKEN_BM${i}`];
    const account = process.env[`META_AD_ACCOUNT_BM${i}`];
    if (!token || !account) continue;
    const accountId = account.startsWith('act_') ? account : `act_${account}`;

    let url = `${BASE}/${accountId}/insights`;
    let params = {
      access_token: token,
      level: 'ad',
      fields: 'ad_name,spend',
      time_increment: 1,
      time_range: JSON.stringify({ since: daysAgo(7), until: today() }),
      limit: 500,
    };

    while (true) {
      try {
        const res = await axios.get(url, { params, timeout: 60000 });
        const rows = res.data?.data || [];
        for (const r of rows) {
          if (+r.spend > 0) {
            const utm = extractAdUTM(r.ad_name);
            if (utm) utms.add(utm.toLowerCase());
          }
        }
        const next = res.data?.paging?.next;
        if (next && rows.length > 0) { url = next; params = {}; }
        else break;
      } catch (e) {
        console.error(`BM${i} error:`, e.message);
        break;
      }
    }
  }
  return utms;
}

function getGAMUTMs() {
  const csvPath = path.join(__dirname, '..', 'gam-diag-utm.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`gam-diag-utm.csv não encontrado em ${csvPath}`);
    console.error('Execute scripts/diag-gam.js primeiro');
    return new Map();
  }

  const csv = fs.readFileSync(csvPath, 'utf8');
  const lines = csv.trim().split('\n').filter(Boolean);
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());

  const utmMap = new Map();
  for (const line of lines.slice(1)) {
    const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });

    const kv = row['Dimension.CUSTOM_CRITERIA'] || row['CUSTOM_CRITERIA'] || '';
    const m = kv.match(/utm_campaign=([^;,\s]+)/i);
    const utmCamp = m ? m[1].toLowerCase() : null;
    if (!utmCamp || utmCamp === 'null') continue;

    const revMicros = +(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_REVENUE'] || 0);
    const impressions = +(row['Column.AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || row['AD_EXCHANGE_LINE_ITEM_LEVEL_IMPRESSIONS'] || 0);
    const revenue = revMicros / 1_000_000;

    if (!utmMap.has(utmCamp)) utmMap.set(utmCamp, { revenue: 0, impressions: 0 });
    const u = utmMap.get(utmCamp);
    u.revenue += revenue;
    u.impressions += impressions;
  }
  return utmMap;
}

async function main() {
  console.log('\n═══ diag-cross.js — cruzamento Meta × GAM ═══\n');

  console.log('Buscando UTMs do Meta...');
  const metaUtms = await getMetaUTMs();
  console.log(`Meta UTMs (com spend > 0): ${metaUtms.size}`);

  console.log('\nLendo UTMs do GAM (gam-diag-utm.csv)...');
  const gamUtmMap = getGAMUTMs();
  console.log(`GAM UTMs (com impressões): ${gamUtmMap.size}`);

  // normalize: strip -direto- for comparison
  function normalize(utm) {
    return utm.replace(/-direto-?/, '-').replace(/-$/, '');
  }

  const metaSet = new Set([...metaUtms]);
  const gamSet = new Set([...gamUtmMap.keys()]);
  const metaNormMap = new Map([...metaUtms].map(u => [normalize(u), u]));
  const gamNormMap = new Map([...gamUtmMap.keys()].map(u => [normalize(u), u]));

  // Only in Meta (not in GAM, even after normalization)
  const onlyMeta = [];
  for (const utm of metaSet) {
    const norm = normalize(utm);
    if (!gamSet.has(utm) && !gamNormMap.has(norm)) {
      onlyMeta.push(utm);
    }
  }

  // Only in GAM (not in Meta, even after normalization)
  const onlyGAM = [];
  for (const utm of gamSet) {
    const norm = normalize(utm);
    if (!metaSet.has(utm) && !metaNormMap.has(norm)) {
      const info = gamUtmMap.get(utm);
      onlyGAM.push({ utm, revenue_usd: +info.revenue.toFixed(4), impressions: info.impressions });
    }
  }

  // In both (exact or normalized match)
  const inBoth = [];
  for (const utm of metaSet) {
    const norm = normalize(utm);
    if (gamSet.has(utm)) {
      const info = gamUtmMap.get(utm);
      inBoth.push({ utm_meta: utm, utm_gam: utm, match: 'EXACT', revenue_usd: +info.revenue.toFixed(4) });
    } else if (gamNormMap.has(norm)) {
      const gamUtm = gamNormMap.get(norm);
      const info = gamUtmMap.get(gamUtm);
      inBoth.push({ utm_meta: utm, utm_gam: gamUtm, match: 'NORMALIZED (-direto-)', revenue_usd: +info.revenue.toFixed(4) });
    }
  }

  console.log('\n══ UTMs no Meta NÃO encontrados no GAM ══');
  console.log(`Total: ${onlyMeta.length}`);
  onlyMeta.sort().forEach(u => console.log(`  • ${u}`));

  console.log('\n══ UTMs no GAM NÃO encontrados no Meta ══');
  console.log(`Total: ${onlyGAM.length}`);
  console.table(onlyGAM.sort((a, b) => a.utm.localeCompare(b.utm)));

  console.log('\n══ UTMs em AMBOS (Meta + GAM) ══');
  console.log(`Total: ${inBoth.length}`);
  console.table(inBoth.sort((a, b) => a.utm_meta.localeCompare(b.utm_meta)));

  console.log('\n══ RESUMO ══');
  console.log(`Meta total UTMs: ${metaSet.size}`);
  console.log(`GAM total UTMs:  ${gamSet.size}`);
  console.log(`Em ambos:        ${inBoth.length} (${(inBoth.length / Math.max(metaSet.size, 1) * 100).toFixed(1)}% de cobertura das UTMs Meta)`);
  console.log(`Só Meta:         ${onlyMeta.length}`);
  console.log(`Só GAM:          ${onlyGAM.length}`);

  const hasYobannaGAM = gamSet.has('yobannafb') || [...gamSet].some(u => u.includes('yobanna'));
  const hasYobannaMeta = metaSet.has('yobannafb') || [...metaSet].some(u => u.includes('yobanna'));
  console.log(`\n"yobannafb" no Meta: ${hasYobannaMeta ? '✅ SIM' : '❌ NÃO'}`);
  console.log(`"yobannafb" no GAM:  ${hasYobannaGAM ? '✅ SIM' : '❌ NÃO'}`);
}

main().catch(e => { console.error('ERRO FATAL:', e.message); process.exit(1); });

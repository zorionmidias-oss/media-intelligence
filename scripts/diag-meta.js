'use strict';
require('dotenv').config({ path: '.env.local' });
const axios = require('axios');
const { extractAdUTM } = require('../src/lib/parser');

const BASE = 'https://graph.facebook.com/v19.0';

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

async function getAdAccounts(token) {
  const res = await axios.get(`${BASE}/me/adaccounts`, {
    params: { access_token: token, fields: 'id,name,account_status,currency', limit: 100 },
    timeout: 30000,
  });
  return res.data?.data || [];
}

async function fetchAllAdsPaginated(token, accountId, since, until) {
  const ads = [];
  let url = `${BASE}/${accountId}/insights`;
  let params = {
    access_token: token,
    level: 'ad',
    fields: 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,date_start',
    time_increment: 1,
    time_range: JSON.stringify({ since, until }),
    limit: 500,
  };
  let page = 0;
  while (true) {
    page++;
    process.stdout.write(`  página ${page}...`);
    const res = await axios.get(url, { params, timeout: 60000 });
    const rows = res.data?.data || [];
    ads.push(...rows);
    process.stdout.write(` ${rows.length} rows\n`);
    const next = res.data?.paging?.next;
    if (next && rows.length > 0) { url = next; params = {}; }
    else break;
  }
  return ads;
}

async function main() {
  const tokens = [];
  for (let i = 1; i <= 5; i++) {
    const token = process.env[`META_ACCESS_TOKEN_BM${i}`];
    const account = process.env[`META_AD_ACCOUNT_BM${i}`];
    if (token && account) tokens.push({ i, token, account });
  }

  if (!tokens.length) { console.error('Nenhuma BM configurada em .env.local'); process.exit(1); }

  const since = daysAgo(7);
  const until = today();
  console.log(`\n═══ diag-meta.js — ${since} → ${until} ═══\n`);

  for (const { i, token, account } of tokens) {
    const accountId = account.startsWith('act_') ? account : `act_${account}`;
    console.log(`\n── BM${i} — ${accountId} ──`);

    // List all accessible ad accounts
    try {
      console.log('\n3.1 Todas as ad accounts acessíveis:');
      const accs = await getAdAccounts(token);
      console.table(accs.map(a => ({ id: a.id, name: a.name, status: a.account_status, currency: a.currency })));
    } catch (e) {
      console.error('  getAdAccounts ERROR:', e.response?.data?.error?.message || e.message);
    }

    // Fetch all ads
    console.log(`\n3.1 Insights (ad level, últimos 7d, paginação completa):`);
    let ads = [];
    try {
      ads = await fetchAllAdsPaginated(token, accountId, since, until);
    } catch (e) {
      console.error('  fetchAllAdsPaginated ERROR:', e.response?.data?.error?.message || e.message);
    }

    console.log(`\nTotal ads únicos por (ad_id, date): ${ads.length}`);

    // Unique ad IDs
    const uniqueAdIds = new Set(ads.map(a => a.ad_id));
    console.log(`Total ad IDs únicos: ${uniqueAdIds.size}`);

    // Extract UTMs
    const utmMap = {};
    const noUtm = [];
    for (const ad of ads) {
      const utm = extractAdUTM(ad.ad_name);
      if (!utm) { noUtm.push(ad.ad_name); continue; }
      if (!utmMap[utm]) utmMap[utm] = { utm, spend: 0, clicks: 0, impressions: 0, ad_names: new Set() };
      utmMap[utm].spend += +ad.spend || 0;
      utmMap[utm].clicks += +ad.clicks || 0;
      utmMap[utm].impressions += +ad.impressions || 0;
      utmMap[utm].ad_names.add(ad.ad_name);
    }

    const utmList = Object.values(utmMap).map(u => ({
      utm: u.utm,
      spend: +u.spend.toFixed(2),
      clicks: u.clicks,
      impressions: u.impressions,
      sample_ad_name: [...u.ad_names][0],
    })).sort((a, b) => a.utm.localeCompare(b.utm));

    console.log(`\nTotal UTMs únicas: ${utmList.length}`);
    console.log('\nLista alfabética de UTMs:');
    console.table(utmList);

    const hasYobanna = utmList.some(u => u.utm.includes('yobanna'));
    console.log(`\n"yobannafb" aparece no Meta: ${hasYobanna ? '✅ SIM' : '❌ NÃO'}`);

    if (noUtm.length) {
      console.log(`\nAds sem UTM extraível (${noUtm.length} total):`);
      [...new Set(noUtm)].slice(0, 20).forEach(n => console.log(`  "${n}"`));
    }

    // Campaign prefixes (to check domain matching)
    const campaignPrefixes = new Set();
    for (const ad of ads) {
      const m = String(ad.campaign_name || '').match(/^\[([^\]]+)\]/);
      if (m) campaignPrefixes.add(m[1].trim());
    }
    console.log('\nPrefixos de campanha detectados:', [...campaignPrefixes].sort().join(', '));

    // Ads with spend > 0 today specifically
    const today = daysAgo(0);
    const todayAds = ads.filter(a => a.date_start === today);
    const yesterdayAds = ads.filter(a => a.date_start === daysAgo(1));
    console.log(`\nAds em ${today} (hoje): ${todayAds.length} (total spend: ${todayAds.reduce((s, a) => s + (+a.spend || 0), 0).toFixed(2)})`);
    console.log(`Ads em ${daysAgo(1)} (ontem): ${yesterdayAds.length} (total spend: ${yesterdayAds.reduce((s, a) => s + (+a.spend || 0), 0).toFixed(2)})`);
  }
}

main().catch(e => { console.error('ERRO FATAL:', e.message); process.exit(1); });

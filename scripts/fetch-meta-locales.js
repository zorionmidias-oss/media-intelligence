'use strict';
require('dotenv').config({ path: '.env.local' });
const axios    = require('axios');
const fs       = require('fs');
const path     = require('path');
const supabase = require('../src/lib/supabase');

const META_BASE = 'https://graph.facebook.com/v19.0';
const ACCT      = 'act_24292507563699876';
const OUT_FILE  = path.join(__dirname, 'data', 'meta-locales.json');

const QUERIES = [
  'en','pt','es','fr','de','it','nl','sv','da','nb','fi',
  'cs','pl','sk','ro','hu','bg','hr','lt','lv','et','sl',
  'ru','ar','zh','ja','ko','tr','th','ms','el','he','uk',
  'hi','vi','sr','fa','ta','te','bn','ur','af','sw','id',
];

async function getToken() {
  const { data, error } = await supabase
    .from('meta_accounts').select('access_token').eq('ad_account_id', ACCT).single();
  if (error || !data?.access_token) throw new Error('Token não encontrado: ' + (error?.message || ''));
  return data.access_token;
}

async function fetchLocales(q, token) {
  try {
    const r = await axios.get(`${META_BASE}/search`, {
      params: { type: 'adlocale', q, access_token: token, limit: 100 },
      timeout: 10000,
    });
    return r.data?.data || [];
  } catch (e) {
    console.warn(`  [WARN] q="${q}": ${e.response?.data?.error?.message || e.message}`);
    return [];
  }
}

async function main() {
  const token = await getToken();
  console.log(`[fetch] Token: ${token.slice(0, 12)}… (${token.length} chars)\n`);

  const map = new Map(); // key → { id, key, name }

  for (const q of QUERIES) {
    process.stdout.write(`[fetch] q="${q}" … `);
    const results = await fetchLocales(q, token);
    let added = 0;
    for (const item of results) {
      const key = item.key ?? item.id;
      if (!map.has(key)) {
        map.set(key, { id: Number(item.key ?? item.id), key: item.key ?? item.id, name: item.name });
        added++;
      }
    }
    console.log(`${results.length} resultados, ${added} novos (total: ${map.size})`);
  }

  // Sort by id
  const locales = [...map.values()].sort((a, b) => a.id - b.id);

  fs.writeFileSync(OUT_FILE, JSON.stringify(locales, null, 2) + '\n', 'utf8');
  console.log(`\n[fetch] Gravado: ${OUT_FILE} (${locales.length} locales)`);

  // Spot-check
  const check = ['en_US', 'en_GB', 'pt_BR', 'es_LA', 'es_ES', 'fr_FR', 'de_DE'];
  console.log('\n[fetch] Spot-check:');
  for (const name of check) {
    const found = locales.find(l => l.name?.includes(name) || l.key === name);
    if (found) console.log(`  ${name.padEnd(8)} → id=${found.id}  name="${found.name}"`);
    else        console.log(`  ${name.padEnd(8)} → NÃO ENCONTRADO`);
  }
}

main().catch(e => { console.error('[fetch] ERRO:', e.message); process.exit(1); });

'use strict';
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testAccount(token, accountId) {
  try {
    const r = await axios.get(`https://graph.facebook.com/v19.0/${accountId}`, {
      params: { access_token: token, fields: 'id,name,account_status,currency' },
      timeout: 15000,
    });
    return { ok: true, ...r.data };
  } catch (e) {
    return { ok: false, error: e.response?.data?.error?.message || e.message };
  }
}

async function main() {
  console.log('=== Migrar BMs do .env para meta_accounts ===\n');

  const bms = [];
  for (let i = 1; i <= 10; i++) {
    const token = process.env[`META_ACCESS_TOKEN_BM${i}`];
    const account = process.env[`META_AD_ACCOUNT_BM${i}`];
    if (token && account) bms.push({ i, token, account });
  }

  if (!bms.length) {
    console.log('Nenhuma BM configurada no .env'); return;
  }

  console.log(`BMs encontradas: ${bms.map(b => `BM${b.i}`).join(', ')}\n`);

  for (const { i, token, account } of bms) {
    const accountId = account.startsWith('act_') ? account : `act_${account}`;
    process.stdout.write(`BM${i} (${accountId})... `);

    const info = await testAccount(token, accountId);
    if (!info.ok) {
      console.log(`❌ Token inválido: ${info.error}`);
      continue;
    }

    const row = {
      nome: info.name || `BM${i}`,
      ad_account_id: accountId,
      access_token: token,
      currency: info.currency || 'BRL',
      ativo: info.account_status === 1,
      ultimo_status: info.account_status === 1 ? 'ACTIVE' : `STATUS_${info.account_status}`,
    };

    const { error } = await sb
      .from('meta_accounts')
      .upsert(row, { onConflict: 'ad_account_id' });

    if (error) {
      console.log(`❌ DB error: ${error.message}`);
    } else {
      console.log(`✅ ${info.name} (status=${info.account_status})`);
    }
  }

  const { data: all } = await sb.from('meta_accounts').select('id,nome,ad_account_id,ativo,ultimo_status');
  console.log('\n=== meta_accounts no banco ===');
  console.table(all);
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

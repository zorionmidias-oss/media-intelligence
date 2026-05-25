'use strict';
require('dotenv').config({ path: '.env.local' });
const fs       = require('fs');
const path     = require('path');
const FormData = require('form-data');
const axios    = require('axios');
const supabase = require('./src/lib/supabase');
const { criarHandler } = require('./src/app/api/campaigns/route');

const META_BASE = 'https://graph.facebook.com/v19.0';

const ACCOUNTS = [
  { acct: 'act_836584462796120',    page_id: '1174586702396603', pixel: '2189268325230730', label: 'USD' },
  { acct: 'act_24292507563699876',  page_id: '1174586702396603', pixel: '2189268325230730', label: 'BRL' },
];

async function getToken(acct) {
  const { data, error } = await supabase
    .from('meta_accounts')
    .select('access_token')
    .eq('ad_account_id', acct)
    .single();
  if (error || !data?.access_token) throw new Error('Token não encontrado: ' + (error?.message || ''));
  return data.access_token;
}

async function uploadImage(token, acct) {
  console.log('\n[test] ── Subindo imagem para Meta ──────────────────────────');
  const imgPath = path.join(__dirname, 'public', 'icon-512.png');
  const fd = new FormData();
  fd.append('access_token', token);
  fd.append('filename', fs.createReadStream(imgPath), { filename: 'icon-512.png', contentType: 'image/png' });
  const r = await axios.post(`${META_BASE}/${acct}/adimages`, fd, { headers: fd.getHeaders(), timeout: 30000 });
  const images = r.data?.images;
  const hash = images && Object.values(images)[0]?.hash;
  if (!hash) throw new Error('Upload falhou: ' + JSON.stringify(r.data));
  console.log(`[test] ✓ image_hash: ${hash}`);
  return hash;
}

function makeMockRes(label) {
  const events = [];
  const res = {
    headersSent: false,
    setHeader() {},
    flushHeaders() { this.headersSent = true; },
    write(chunk) {
      const lines = chunk.split('\n').filter(Boolean);
      for (const l of lines) {
        if (l.startsWith('data:')) {
          try {
            const ev = JSON.parse(l.slice(5).trim());
            events.push(ev);
            const icon = ev.success ? '✅' : ev.error ? '❌' : '⏳';
            console.log(`[SSE:${label}] ${icon} ${JSON.stringify(ev)}`);
          } catch (_) { console.log('[SSE raw]', l); }
        } else if (l.startsWith('event:')) {
          process.stdout.write(`[SSE:${label}] event=${l.slice(6).trim()} `);
        }
      }
    },
    end() { console.log(`\n[test:${label}] ── SSE stream encerrado ──────────────────────`); },
    status(c) { this._status = c; return this; },
    json(d) { console.log(`[res.json:${label}]`, JSON.stringify(d, null, 2)); },
  };
  return { res, events };
}

async function runForAccount({ acct, page_id, pixel, label }) {
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  TEST-CRIAR [${label}] — ${acct}`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);

  const token = await getToken(acct);
  console.log(`[test] Token: ${token.slice(0, 12)}… (${token.length} chars)`);

  const hash = await uploadImage(token, acct);

  const now   = new Date();
  const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  const campName = `TEST-${stamp} | BOT | ${label}`;

  // wizard sempre envia -03:00; o servidor deve corrigir para o timezone real
  const tomorrowStr = new Date(Date.now() + 86400 * 1000).toISOString().slice(0, 10);
  const startTimeFromWizard = tomorrowStr + 'T00:00:00-03:00';

  const payload = {
    account_id      : acct,
    campaign        : { name: campName, objective: 'OUTCOME_SALES', status: 'PAUSED', budget_type: 'ABO' },
    adset_template  : {
      pixel_id        : pixel,
      conversion_event: 'CONTENT_VIEW',
      daily_budget    : 700,
      start_time      : startTimeFromWizard,
      geo_locations   : { countries: ['US'] },
      age_min         : 18,
      age_max         : 45,
    },
    adset_names     : [`V1-${label}`],
    adset_creatives : [[{ name: `C1-V1-${label}`, image_hash: hash }]],
    copies          : { texts: ['Texto teste 1'], headlines: ['Headline teste'], descriptions: [] },
    page_id,
  };

  console.log(`\n[test] start_time que o wizard enviaria: ${startTimeFromWizard}`);

  const { res, events } = makeMockRes(label);
  const req = { body: payload };

  console.log(`\n[test] ── Chamando criarHandler ────────────────────────────`);
  await criarHandler(req, res);

  const done = events.find(e => e.success);
  const err  = events.find(e => e.error);
  if (done) {
    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║  ✅ [${label}] SUCESSO campaign_id=${done.campaign_id}`);
    console.log(`║  Conjuntos: ${done.adset_count}  Ads: ${done.ad_count}`);
    console.log(`╚══════════════════════════════════════════════════════════╝`);
  } else if (err) {
    console.log(`\n╔══════════════════════════════════════════════════════════╗`);
    console.log(`║  ❌ [${label}] FALHOU — step: ${err.step_failed}`);
    console.log(`║  HTTP: ${err.http_status}   msg: ${err.error}`);
    console.log(`╚══════════════════════════════════════════════════════════╝`);
  }
}

async function runTest() {
  for (const acct of ACCOUNTS) {
    await runForAccount(acct);
  }
}

runTest().catch(e => {
  console.error('\n[test] ERRO INESPERADO:', e.message);
  console.error(e.stack);
  process.exit(1);
});

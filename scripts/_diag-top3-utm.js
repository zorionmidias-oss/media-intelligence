'use strict';
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const df30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  console.log('hoje BR =', hoje, ' df30 =', df30);

  const { data: campRows, error: campErr } = await sb
    .from('report_utm_campaign')
    .select('data,utm_campaign,receita,dominio_id,updated_at')
    .order('updated_at', { ascending: false })
    .limit(20);
  console.log('\n--- report_utm_campaign (últimos 20 por updated_at) ---');
  console.log(campErr || (campRows || []).map(r => `${r.data} | dom=${r.dominio_id} | ${r.utm_campaign} | R$${r.receita} | upd=${r.updated_at}`).join('\n'));

  const { data: dom0, error: dom0Err } = await sb
    .from('report_utm_campaign')
    .select('data,utm_campaign,receita')
    .eq('dominio_id', 0)
    .gte('data', df30)
    .order('receita', { ascending: false })
    .limit(10);
  console.log('\n--- report_utm_campaign dominio_id=0 (últimos 30d, top receita) ---');
  console.log(dom0Err || (dom0 || []).map(r => `${r.data} | ${r.utm_campaign} | R$${r.receita}`).join('\n'));
  console.log('count:', (dom0 || []).length);

  const { count: blocosCount } = await sb
    .from('blocos_anuncio')
    .select('*', { count: 'exact', head: true })
    .gte('data', df30);
  console.log('\nblocos_anuncio (30d) count:', blocosCount);

  const { data: distinctDom } = await sb
    .from('report_utm_campaign')
    .select('dominio_id')
    .gte('data', df30)
    .limit(1000);
  const domSet = new Set((distinctDom || []).map(r => r.dominio_id));
  console.log('dominio_id distintos em report_utm_campaign (30d):', [...domSet]);
}

main().catch(e => { console.error(e); process.exit(1); });

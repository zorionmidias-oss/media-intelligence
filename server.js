'use strict';
require('dotenv').config({ path: '.env.local' });
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const axios = require('axios');

const metricsHandler = require('./src/app/api/metrics/route');
const insightsHandler = require('./src/app/api/insights/route');
const dashboardHandler = require('./src/app/api/dashboard/route');
const overviewHandler = require('./src/app/api/overview/route');
const reportsGamHandler = require('./src/app/api/reports-gam/route');
const gamStatusHandler  = require('./src/app/api/gam-status/route');
const metasHandler = require('./src/app/api/metas/route');
const { handler: notifHandler, marcarLida, marcarTodasLidas } = require('./src/app/api/notificacoes/route');
const drilldownHandler   = require('./src/app/api/drilldown/route');
const gerenciadorHandler = require('./src/app/api/gerenciador/route');
const funilHandler       = require('./src/app/api/funil/route');
const funilBotoesHandler = require('./src/app/api/funil-botoes/route');
const historicoHandler = require('./src/app/api/historico/route');
const { handler: templatesHandler, seedHandler: templatesSeedHandler } = require('./src/app/api/templates/route');
const metaResourcesHandler = require('./src/app/api/meta-resources/route');
const uploadImageHandler   = require('./src/app/api/meta-resources/upload');
const uploadVideoHandler   = require('./src/app/api/meta-resources/upload-video');
const { dryRunHandler, criarHandler } = require('./src/app/api/campaigns/route');
const convTemplatesHandler  = require('./src/app/api/conversation-templates/route');
const adCopiesHandler       = require('./src/app/api/ad-copies-templates/route');
const intradayHandler       = require('./src/app/api/intraday/route');
const supabase = require('./src/lib/supabase');
const { syncAll, fetchAndSaveHourly } = require('./src/lib/sync');
const { PAISES } = require('./src/lib/parser');
const { startScheduler } = require('./src/lib/scheduler');
const { hashPassword, verifyPassword, generateToken, requireAuth, COOKIE_NAME } = require('./src/lib/auth');
const { registrarHistorico } = require('./src/lib/historico');

const app = express();
const PORT = process.env.PORT || 3000;
const META_BASE = 'https://graph.facebook.com/v19.0';
const COOKIE_OPTS = { httpOnly: true, sameSite: 'strict', maxAge: 7 * 24 * 3600 * 1000, path: '/' };

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// ── Public HTML routes ────────────────────────────────────────────────────────
app.get('/privacidade', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'privacidade.html')));

// ── Protected HTML routes (before static) ────────────────────────────────────
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;
app.get('/', requireAuth, (req, res) => {
  if (MOBILE_UA.test(req.headers['user-agent'] || '')) return res.redirect('/mobile');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/dashboard.html', requireAuth, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/mobile', requireAuth, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'mobile.html')));

app.use(express.static(path.join(__dirname, 'public')));
app.get('/lib/chart.umd.min.js', (_req, res) => res.sendFile(path.join(__dirname, 'node_modules/chart.js/dist/chart.umd.min.js')));

// ── Auth routes (public) ─────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  const { data: users, error } = await supabase
    .from('usuarios')
    .select('id,email,senha_hash,nome,ativo')
    .eq('email', email.toLowerCase().trim())
    .limit(1);
  if (error || !users?.length) return res.status(401).json({ error: 'Credenciais inválidas' });
  const user = users[0];
  if (!user.ativo) return res.status(403).json({ error: 'Conta desativada' });
  const ok = await verifyPassword(password, user.senha_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });
  await supabase.from('usuarios').update({ ultimo_acesso: new Date().toISOString() }).eq('id', user.id);
  const token = generateToken(user.id);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, nome: user.nome || user.email });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { data } = await supabase.from('usuarios').select('id,email,nome').eq('id', req.userId).single();
  res.json(data || { id: req.userId });
});

// ── Legacy live-API routes ──────────────────────────────────────────────────
app.get('/api/metrics', requireAuth, metricsHandler);
app.post('/api/insights', requireAuth, insightsHandler);

// ── Supabase-backed routes (fast — no external API calls) ──────────────────
app.get('/api/overview', requireAuth, overviewHandler);
app.get('/api/dashboard', requireAuth, dashboardHandler);
app.get('/api/reports-gam', requireAuth, reportsGamHandler);
app.get('/api/gam-status', requireAuth, gamStatusHandler);
app.get('/api/intraday', requireAuth, intradayHandler);

// ── Contas Meta ──────────────────────────────────────────────────────────────
app.get('/api/contas', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('meta_accounts').select('*').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/contas', requireAuth, async (req, res) => {
  const { nome, bm_id, ad_account_id, access_token } = req.body || {};
  if (!nome || !ad_account_id || !access_token)
    return res.status(400).json({ error: 'nome, ad_account_id e access_token são obrigatórios' });
  const accountId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;
  try {
    const r = await axios.get(`${META_BASE}/${accountId}`, {
      params: { access_token, fields: 'id,name,account_status,currency' }, timeout: 15000,
    });
    const { data, error } = await supabase.from('meta_accounts').insert({
      nome, bm_id: bm_id || null, ad_account_id: accountId, access_token,
      currency: r.data.currency || 'BRL', ativo: r.data.account_status === 1,
      ultimo_status: r.data.account_status === 1 ? 'ACTIVE' : `STATUS_${r.data.account_status}`,
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    return res.status(400).json({ error: `Token ou conta inválidos: ${msg}` });
  }
});

app.put('/api/contas/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const allowed = ['nome', 'bm_id', 'ad_account_id', 'access_token', 'currency', 'ativo', 'imposto_percentual', 'imposto_descricao'];
  const update = {};
  for (const k of allowed) if (req.body[k] !== undefined) update[k] = req.body[k];
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada para atualizar' });
  const { data, error } = await supabase.from('meta_accounts').update(update).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/contas/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('meta_accounts').delete().eq('id', Number(req.params.id));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.post('/api/contas/testar', requireAuth, async (req, res) => {
  const { ad_account_id, access_token } = req.body || {};
  if (!ad_account_id || !access_token) return res.status(400).json({ error: 'ad_account_id e access_token são obrigatórios' });
  const accountId = ad_account_id.startsWith('act_') ? ad_account_id : `act_${ad_account_id}`;
  try {
    const r = await axios.get(`${META_BASE}/${accountId}`, {
      params: { access_token, fields: 'id,name,account_status,currency,business' }, timeout: 15000,
    });
    res.json(r.data);
  } catch (e) {
    res.status(400).json({ error: e.response?.data?.error?.message || e.message });
  }
});

app.post('/api/contas/:id/testar', requireAuth, async (req, res) => {
  const { data: conta, error } = await supabase.from('meta_accounts').select('*').eq('id', Number(req.params.id)).single();
  if (error || !conta) return res.status(404).json({ error: 'Conta não encontrada' });
  try {
    const r = await axios.get(`${META_BASE}/${conta.ad_account_id}`, {
      params: { access_token: conta.access_token, fields: 'id,name,account_status,currency' }, timeout: 15000,
    });
    const status = r.data.account_status === 1 ? 'ACTIVE' : `STATUS_${r.data.account_status}`;
    await supabase.from('meta_accounts').update({ ultimo_sync: new Date().toISOString(), ultimo_status: status, ultimo_erro: null }).eq('id', conta.id);
    res.json(r.data);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    await supabase.from('meta_accounts').update({ ultimo_status: 'ERRO', ultimo_erro: msg }).eq('id', conta.id);
    res.status(400).json({ error: msg });
  }
});

// ── Imposto por conta Meta ───────────────────────────────────────────────────
async function recalcularContaHistorico(account_id) {
  const { data: conta } = await supabase
    .from('meta_accounts')
    .select('imposto_percentual')
    .eq('ad_account_id', account_id)
    .maybeSingle();

  const fator = 1 + (Number(conta?.imposto_percentual || 0) / 100);
  const impostoPerc = Number(conta?.imposto_percentual || 0);

  let offset = 0;
  const PAGE = 500;
  let total = 0;

  while (true) {
    const { data: ads, error } = await supabase
      .from('ads_consolidados')
      .select('id,valor_gasto_original,valor_gasto,cliques,resultado,faturamento_real')
      .eq('account_id', account_id)
      .range(offset, offset + PAGE - 1);

    if (error || !ads || ads.length === 0) break;

    const updates = ads.map(ad => {
      const original = ad.valor_gasto_original != null ? Number(ad.valor_gasto_original) : Number(ad.valor_gasto);
      const novo = original * fator;
      const cpc = Number(ad.cliques) > 0 ? novo / Number(ad.cliques) : 0;
      const custo = Number(ad.resultado) > 0 ? novo / Number(ad.resultado) : 0;
      const fat = Number(ad.faturamento_real) || 0;
      return {
        id: ad.id,
        valor_gasto_original: original,
        valor_gasto: +novo.toFixed(2),
        cpc: +cpc.toFixed(4),
        custo_resultado: +custo.toFixed(2),
        lucro: +(fat - novo).toFixed(2),
        roas: novo > 0 ? +(fat / novo).toFixed(4) : 0,
        imposto_aplicado: impostoPerc,
      };
    });

    for (const u of updates) {
      await supabase.from('ads_consolidados').update(u).eq('id', u.id);
    }
    total += updates.length;
    if (ads.length < PAGE) break;
    offset += PAGE;
  }

  console.log(`[imposto] recalculado ${total} ads da conta ${account_id}`);
  return total;
}

app.post('/api/contas/:id/imposto', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { imposto_percentual, imposto_descricao } = req.body || {};
  if (imposto_percentual === undefined) return res.status(400).json({ error: 'imposto_percentual é obrigatório' });

  const { data, error } = await supabase
    .from('meta_accounts')
    .update({ imposto_percentual: Number(imposto_percentual), imposto_descricao: imposto_descricao || null })
    .eq('id', id)
    .select('ad_account_id,imposto_percentual')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Recalcular em background (não bloquear a resposta)
  recalcularContaHistorico(data.ad_account_id).catch(e => console.error('[imposto recalc]', e.message));

  res.json({ ok: true, imposto_percentual: data.imposto_percentual, recalculando: true });
});

app.post('/api/admin/recalcular-imposto', requireAuth, async (req, res) => {
  const { account_id } = req.body || {};

  if (account_id) {
    recalcularContaHistorico(account_id).catch(e => console.error('[imposto recalc]', e.message));
    return res.json({ ok: true, message: `Recalculando conta ${account_id}...` });
  }

  // Recalcular todas as contas com imposto > 0
  const { data: contas } = await supabase
    .from('meta_accounts')
    .select('ad_account_id,imposto_percentual')
    .gt('imposto_percentual', 0);

  for (const c of contas || []) {
    recalcularContaHistorico(c.ad_account_id).catch(e => console.error('[imposto recalc]', e.message));
  }

  res.json({ ok: true, message: `Recalculando ${(contas || []).length} conta(s)...` });
});

// ── Domínios ────────────────────────────────────────────────────────────────
app.get('/api/dominios', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('dominios')
    .select('*')
    .order('nome');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/dominios', requireAuth, async (req, res) => {
  const { nome, prefixo_campanha, codigo_pedido_gam } = req.body || {};
  if (!nome || !prefixo_campanha) {
    return res.status(400).json({ error: 'nome e prefixo_campanha são obrigatórios' });
  }
  const { data, error } = await supabase
    .from('dominios')
    .insert({ nome, prefixo_campanha: prefixo_campanha.toUpperCase(), codigo_pedido_gam: codigo_pedido_gam || null })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/dominios/pendentes', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('dominios_pendentes')
    .select('*')
    .eq('resolvido', false)
    .order('primeira_deteccao', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/dominios/aprovar', requireAuth, async (req, res) => {
  const { prefixo_detectado, nome, codigo_pedido_gam } = req.body || {};
  if (!prefixo_detectado || !nome) {
    return res.status(400).json({ error: 'prefixo_detectado e nome são obrigatórios' });
  }

  const { data: newDomain, error: insErr } = await supabase
    .from('dominios')
    .insert({
      nome,
      prefixo_campanha: prefixo_detectado.toUpperCase(),
      codigo_pedido_gam: codigo_pedido_gam || null,
      detectado_automaticamente: true,
    })
    .select()
    .single();

  if (insErr) return res.status(500).json({ error: insErr.message });

  await supabase
    .from('dominios_pendentes')
    .update({ resolvido: true })
    .eq('prefixo_detectado', prefixo_detectado);

  res.json(newDomain);
});

// ── Metas ─────────────────────────────────────────────────────────────────────
app.get('/api/metas', requireAuth, metasHandler);
app.post('/api/metas', requireAuth, metasHandler);
app.put('/api/metas/:id', requireAuth, (req, res) => metasHandler(req, res));
app.delete('/api/metas/:id', requireAuth, (req, res) => metasHandler(req, res));

// ── Notificações ──────────────────────────────────────────────────────────────
app.get('/api/notificacoes', requireAuth, notifHandler);
app.post('/api/notificacoes/:id/marcar-lida', requireAuth, marcarLida);
app.post('/api/notificacoes/marcar-todas-lidas', requireAuth, marcarTodasLidas);

// ── UTMs ativas (últimos 7 dias) ──────────────────────────────────────────────
app.get('/api/utms', requireAuth, async (req, res) => {
  const tipo = req.query.tipo;
  const last7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('ads_consolidados')
    .select('ad_utm, tipo')
    .gte('data', last7)
    .gt('valor_gasto', 0)
    .not('ad_utm', 'is', null);
  if (error) return res.status(500).json({ error: error.message });
  const map = new Map();
  for (const r of data || []) {
    if (!r.ad_utm) continue;
    if (!map.has(r.ad_utm)) map.set(r.ad_utm, { ad_utm: r.ad_utm, tipo: r.tipo || '' });
  }
  let utms = Array.from(map.values());
  if (tipo) utms = utms.filter(u => u.tipo === tipo);
  utms.sort((a, b) => a.ad_utm.localeCompare(b.ad_utm));
  res.json(utms);
});

// ── Drilldown ─────────────────────────────────────────────────────────────────
app.get('/api/drilldown/:utm', requireAuth, drilldownHandler);

// ── Gerenciador ───────────────────────────────────────────────────────────────
app.get('/api/gerenciador', requireAuth, gerenciadorHandler);

// Campaign-level Meta actions
app.post('/api/meta/campaign/:id/toggle', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { status, account_id } = req.body || {};
  if (!status || !['ACTIVE','PAUSED'].includes(status))
    return res.status(400).json({ error: 'status deve ser ACTIVE ou PAUSED' });
  const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
  let lastErr = 'Nenhuma conta ativa';
  for (const acc of accounts || []) {
    try {
      const r = await axios.post(`${META_BASE}/${id}`, { status }, { params: { access_token: acc.access_token }, timeout: 15000 });
      if (r.data?.success) return res.json({ ok: true });
    } catch(e) { lastErr = e.response?.data?.error?.message || e.message; }
  }
  res.status(400).json({ error: lastErr });
});

app.post('/api/meta/campaign/:id/budget', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { daily_budget } = req.body || {};
  if (!daily_budget) return res.status(400).json({ error: 'daily_budget é obrigatório' });
  const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
  let lastErr = 'Nenhuma conta ativa';
  for (const acc of accounts || []) {
    try {
      const r = await axios.post(`${META_BASE}/${id}`, { daily_budget: Math.round(+daily_budget * 100) }, { params: { access_token: acc.access_token }, timeout: 15000 });
      if (r.data?.success) return res.json({ ok: true });
    } catch(e) { lastErr = e.response?.data?.error?.message || e.message; }
  }
  res.status(400).json({ error: lastErr });
});

app.delete('/api/meta/campaign/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
  let lastErr = 'Nenhuma conta ativa';
  for (const acc of accounts || []) {
    try {
      const r = await axios.delete(`${META_BASE}/${id}`, { params: { access_token: acc.access_token }, timeout: 15000 });
      if (r.data?.success) return res.json({ ok: true });
    } catch(e) { lastErr = e.response?.data?.error?.message || e.message; }
  }
  res.status(400).json({ error: lastErr });
});

app.delete('/api/meta/adset/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
  let lastErr = 'Nenhuma conta ativa';
  for (const acc of accounts || []) {
    try {
      const r = await axios.delete(`${META_BASE}/${id}`, { params: { access_token: acc.access_token }, timeout: 15000 });
      if (r.data?.success) return res.json({ ok: true });
    } catch(e) { lastErr = e.response?.data?.error?.message || e.message; }
  }
  res.status(400).json({ error: lastErr });
});

app.delete('/api/meta/ad/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
  let lastErr = 'Nenhuma conta ativa';
  for (const acc of accounts || []) {
    try {
      const r = await axios.delete(`${META_BASE}/${id}`, { params: { access_token: acc.access_token }, timeout: 15000 });
      if (r.data?.success) return res.json({ ok: true });
    } catch(e) { lastErr = e.response?.data?.error?.message || e.message; }
  }
  res.status(400).json({ error: lastErr });
});

// Fetch campaign details for duplication
app.get('/api/meta/campaign/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
  for (const acc of accounts || []) {
    try {
      const r = await axios.get(`${META_BASE}/${id}`, {
        params: {
          access_token: acc.access_token,
          fields: 'id,name,objective,status,daily_budget,start_time,end_time,adsets{id,name,daily_budget,targeting,start_time,end_time}',
        },
        timeout: 15000,
      });
      return res.json({ ...r.data, account_id: acc.ad_account_id });
    } catch(e) {
      const code = e.response?.data?.error?.code;
      if (code !== 100 && code !== 803) continue; // try next account
    }
  }
  res.status(404).json({ error: 'Campanha não encontrada em nenhuma conta ativa' });
});

// ── Análise de Funil ──────────────────────────────────────────────────────────
app.get('/api/funil', requireAuth, funilHandler);
app.get('/api/funil-botoes', requireAuth, funilBotoesHandler);

// ── Campaign Templates ────────────────────────────────────────────────────────
app.get('/api/templates', requireAuth, (req, res) => templatesHandler(req, res));
app.post('/api/templates/seed', requireAuth, templatesSeedHandler);
app.get('/api/templates/:id', requireAuth, (req, res) => templatesHandler(req, res));
app.post('/api/templates/:id/duplicar', requireAuth, (req, res) => {
  req.params.action = 'duplicar';
  templatesHandler(req, res);
});
app.post('/api/templates', requireAuth, (req, res) => templatesHandler(req, res));
app.put('/api/templates/:id', requireAuth, (req, res) => templatesHandler(req, res));
app.delete('/api/templates/:id', requireAuth, (req, res) => templatesHandler(req, res));

// ── Meta Accounts (listagem para o wizard de campanhas) ───────────────────────
app.get('/api/meta-accounts', requireAuth, async (_req, res) => {
  const { data, error } = await supabase
    .from('meta_accounts')
    .select('id,ad_account_id,nome,currency,imposto_percentual,access_token')
    .order('id');
  if (error) return res.status(500).json({ error: error.message });
  const accounts = (data || []).map(a => ({
    id: `act_${a.ad_account_id.replace('act_', '')}`,
    ad_account_id: a.ad_account_id.replace('act_', ''),
    nome: a.nome,
    moeda: a.currency || 'BRL',
    imposto: Number(a.imposto_percentual || 0),
    tem_token: !!(a.access_token),
  }));
  res.json({ accounts });
});

// ── Meta Resources (proxy com cache 1h) ──────────────────────────────────────
app.get('/api/meta-resources/:resource', requireAuth, metaResourcesHandler);
app.post('/api/meta-resources/upload-image', requireAuth, uploadImageHandler);
app.post('/api/meta-resources/upload-video', requireAuth, uploadVideoHandler);

// ── Campaigns (BOT wizard) ────────────────────────────────────────────────────
app.post('/api/campaigns/dry-run', requireAuth, dryRunHandler);
app.post('/api/campaigns/criar', requireAuth, criarHandler);

// ── Conversation templates ────────────────────────────────────────────────────
app.get('/api/conversation-templates',        requireAuth, convTemplatesHandler);
app.post('/api/conversation-templates',       requireAuth, convTemplatesHandler);
app.delete('/api/conversation-templates/:id', requireAuth, convTemplatesHandler);

// ── Ad copies templates ───────────────────────────────────────────────────────
app.get('/api/ad-copies-templates',        requireAuth, adCopiesHandler);
app.post('/api/ad-copies-templates',       requireAuth, adCopiesHandler);
app.delete('/api/ad-copies-templates/:id', requireAuth, adCopiesHandler);

// ── Histórico ─────────────────────────────────────────────────────────────────
app.get('/api/historico/:utm', requireAuth, historicoHandler);

// ── Meta Adset Actions ────────────────────────────────────────────────────────
app.post('/api/meta/adset/:id/toggle', requireAuth, async (req, res) => {
  const adsetId = req.params.id;
  const { status, utm, adset_name } = req.body || {};
  if (!status || !['ACTIVE', 'PAUSED'].includes(status))
    return res.status(400).json({ error: 'status deve ser ACTIVE ou PAUSED' });

  const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
  let lastErr = 'Nenhuma conta Meta ativa';
  for (const account of accounts || []) {
    try {
      const r = await axios.post(`${META_BASE}/${adsetId}`,
        { status },
        { params: { access_token: account.access_token }, timeout: 15000 }
      );
      if (r.data?.success) {
        await registrarHistorico({ utm, adset_id: adsetId, adset_name, acao: 'toggle_status', antes: status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE', depois: status, usuario_id: req.userId });
        return res.json({ ok: true });
      }
    } catch (e) {
      lastErr = e.response?.data?.error?.message || e.message;
    }
  }
  res.status(400).json({ error: lastErr });
});

app.post('/api/meta/adset/:id/budget', requireAuth, async (req, res) => {
  const adsetId = req.params.id;
  const { daily_budget, utm, adset_name, budget_antes } = req.body || {};
  if (!daily_budget) return res.status(400).json({ error: 'daily_budget é obrigatório (em centavos)' });

  const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
  let lastErr = 'Nenhuma conta Meta ativa';
  for (const account of accounts || []) {
    try {
      const r = await axios.post(`${META_BASE}/${adsetId}`,
        { daily_budget: Math.round(+daily_budget * 100) },
        { params: { access_token: account.access_token }, timeout: 15000 }
      );
      if (r.data?.success) {
        await registrarHistorico({ utm, adset_id: adsetId, adset_name, acao: 'alterar_orcamento', antes: budget_antes, depois: daily_budget, usuario_id: req.userId });
        return res.json({ ok: true });
      }
    } catch (e) {
      lastErr = e.response?.data?.error?.message || e.message;
    }
  }
  res.status(400).json({ error: lastErr });
});

app.post('/api/meta/ad/:id/toggle', requireAuth, async (req, res) => {
  const adId = req.params.id;
  const { status, ad_name } = req.body || {};
  if (!status || !['ACTIVE', 'PAUSED'].includes(status))
    return res.status(400).json({ error: 'status deve ser ACTIVE ou PAUSED' });
  const { data: accounts } = await supabase.from('meta_accounts').select('*').eq('ativo', true);
  let lastErr = 'Nenhuma conta Meta ativa';
  for (const account of accounts || []) {
    try {
      const r = await axios.post(`${META_BASE}/${adId}`,
        { status },
        { params: { access_token: account.access_token }, timeout: 15000 }
      );
      if (r.data?.success) {
        return res.json({ ok: true });
      }
    } catch (e) {
      lastErr = e.response?.data?.error?.message || e.message;
    }
  }
  res.status(400).json({ error: lastErr });
});

// ── Performance por País ──────────────────────────────────────────────────────
app.get('/api/paises', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const defaultSince = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const defaultUntil = now.toISOString().slice(0, 10);
    const since = req.query.since || defaultSince;
    const until = req.query.until || defaultUntil;

    const { data: rows, error } = await supabase
      .from('ads_consolidados')
      .select('pais_sigla,pais_nome,ad_utm,valor_gasto,faturamento_real,lucro,ecpm,tipo')
      .gte('data', since)
      .lte('data', until)
      .neq('pais_sigla', '');

    if (error) return res.status(500).json({ error: error.message });

    // Aggregate: country → { utms: Map(utm → {...}) }
    const paisMap = {};
    for (const r of rows || []) {
      const sig = r.pais_sigla;
      if (!paisMap[sig]) {
        const info = PAISES[sig] || {};
        paisMap[sig] = {
          pais_sigla: sig,
          pais_nome: r.pais_nome || info.nome || sig,
          emoji: info.emoji || '',
          investimento: 0,
          faturamento: 0,
          lucro: 0,
          _utmMap: {},
        };
      }
      const p = paisMap[sig];
      p.investimento += Number(r.valor_gasto || 0);
      p.faturamento  += Number(r.faturamento_real || 0);
      p.lucro        += Number(r.lucro || 0);

      const utm = r.ad_utm;
      if (!p._utmMap[utm]) {
        p._utmMap[utm] = { utm, investimento: 0, faturamento: 0, lucro: 0, _ecpmSum: 0, _ecpmW: 0 };
      }
      const u = p._utmMap[utm];
      u.investimento += Number(r.valor_gasto || 0);
      u.faturamento  += Number(r.faturamento_real || 0);
      u.lucro        += Number(r.lucro || 0);
      const imp = Number(r.impressoes_gam || 0);
      if ((r.ecpm || 0) > 0) { u._ecpmSum += r.ecpm; u._ecpmW += 1; }
    }

    const result = Object.values(paisMap)
      .map(p => {
        const utms = Object.values(p._utmMap)
          .map(u => ({
            utm: u.utm,
            investimento: +u.investimento.toFixed(2),
            faturamento:  +u.faturamento.toFixed(2),
            lucro:        +u.lucro.toFixed(2),
            roas:         u.investimento > 0 ? +(u.faturamento / u.investimento).toFixed(2) : 0,
            ecpm:         u._ecpmW > 0 ? +(u._ecpmSum / u._ecpmW).toFixed(2) : 0,
          }))
          .sort((a, b) => b.faturamento - a.faturamento);
        return {
          pais_sigla:  p.pais_sigla,
          pais_nome:   p.pais_nome,
          emoji:       p.emoji,
          investimento: +p.investimento.toFixed(2),
          faturamento:  +p.faturamento.toFixed(2),
          lucro:        +p.lucro.toFixed(2),
          roas:         p.investimento > 0 ? +(p.faturamento / p.investimento).toFixed(2) : 0,
          num_utms:     utms.length,
          utms,
        };
      })
      .sort((a, b) => b.faturamento - a.faturamento);

    res.json(result);
  } catch (e) {
    console.error('[paises]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Sync ─────────────────────────────────────────────────────────────────────
app.post('/api/sync/forcar', requireAuth, async (req, res) => {
  try {
    const dateRange = req.body?.dateRange || undefined;
    // BUG 3: sync manual sempre sobrescreve — limpar manually_fixed antes de sincronizar
    if (dateRange?.since && dateRange?.until) {
      const { error: clrErr } = await supabase
        .from('ads_consolidados')
        .update({ manually_fixed: false })
        .gte('data', dateRange.since)
        .lte('data', dateRange.until)
        .eq('manually_fixed', true);
      if (clrErr) console.warn('[sync/forcar] clear manually_fixed:', clrErr.message);
      else console.log(`[sync/forcar] manually_fixed limpo para ${dateRange.since}→${dateRange.until}`);
    }
    const result = await syncAll(dateRange);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Populate dados_hora for specific dates without full sync
app.post('/api/sync/hourly', requireAuth, async (req, res) => {
  try {
    const { dates } = req.body || {};
    const list = Array.isArray(dates) ? dates : [dates].filter(Boolean);
    if (list.length === 0) return res.status(400).json({ error: 'Forneça body: { dates: ["yyyy-mm-dd", ...] }' });
    const results = {};
    for (const d of list) {
      results[d] = await fetchAndSaveHourly(d).catch(e => ({ error: e.message }));
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sync/log', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('sync_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`2Junior's — Inteligência de Mídia running at http://localhost:${PORT}`);
  startScheduler();
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

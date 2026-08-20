'use strict';
require('dotenv').config({ path: '.env.local' });
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const axios = require('axios');

const dashboardHandler = require('./src/app/api/dashboard/route');
const overviewHandler = require('./src/app/api/overview/route');
const reportsGamHandler = require('./src/app/api/reports-gam/route');
const gamStatusHandler  = require('./src/app/api/gam-status/route');
const metasHandler = require('./src/app/api/metas/route');
const { handler: notifHandler, marcarLida, marcarTodasLidas } = require('./src/app/api/notificacoes/route');
const drilldownHandler   = require('./src/app/api/drilldown/route');
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
const campanhaIntradayHandler = require('./src/app/api/campanha-intraday/route');
const orcamentoStatusHandler = require('./src/app/api/orcamento-status/route');
const { customHandler: relatorioCustomHandler } = require('./src/app/api/relatorios/route');
const supabase = require('./src/lib/supabase');
const { syncAll, fetchAndSaveHourly, syncPaginas } = require('./src/lib/sync');
const { resolveCountry, extractAdUTM } = require('./src/lib/parser');
const { startScheduler } = require('./src/lib/scheduler');
const { hashPassword, verifyPassword, generateToken, verifyToken, requireAuth, requireAdmin, COOKIE_NAME } = require('./src/lib/auth');
const { registrarHistorico } = require('./src/lib/historico');
const PERMS = require('./src/lib/permissions');

const app = express();
const PORT = process.env.PORT || 3000;
const META_BASE = 'https://graph.facebook.com/v19.0';
const COOKIE_OPTS = { httpOnly: true, sameSite: 'strict', maxAge: 7 * 24 * 3600 * 1000, path: '/' };

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// ── Cache curto de permissões por usuário (evita 1 hit/req) ───────────────────
const _permsCache = new Map(); // userId -> { ts, user }
const PERMS_TTL = 15000;
function invalidatePermsCache(userId) {
  if (userId == null) _permsCache.clear();
  else _permsCache.delete(Number(userId));
}
async function loadUser(userId) {
  const hit = _permsCache.get(Number(userId));
  if (hit && Date.now() - hit.ts < PERMS_TTL) return hit.user;
  const { data } = await supabase
    .from('usuarios').select('id,perfil,permissoes,ativo').eq('id', userId).maybeSingle();
  const user = data || null;
  _permsCache.set(Number(userId), { ts: Date.now(), user });
  return user;
}

// ── Porteiro global (deny-by-default) ─────────────────────────────────────────
// Substitui o gate antigo do perfil 'restrito'. Segurança real fica aqui: o que
// não está explicitamente concedido no catálogo retorna 403. Rotas novas nascem
// bloqueadas para colaboradores.
app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/auth/')) return next();
  const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace('Bearer ', '');
  const payload = verifyToken(token);
  if (!payload) return next(); // sem token: auth real (401) fica nas rotas
  let user = null;
  try { user = await loadUser(payload.uid); } catch (_) { user = null; }
  if (user && user.ativo === false) return res.status(403).json({ error: 'Conta desativada' });
  if (!user) user = { id: payload.uid, perfil: payload.perfil || 'admin' };
  req.fullUser = user;
  req.userPerfil = user.perfil;
  req.allowedDominios = PERMS.allowedDomainIds(user); // null=todos | number[]
  const verdict = PERMS.checkAccess(user, req.method, req.path);
  if (!verdict.allow) return res.status(403).json({ error: 'Acesso negado' });
  next();
});

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
    .select('id,email,senha_hash,nome,ativo,perfil')
    .eq('email', email.toLowerCase().trim())
    .limit(1);
  if (error || !users?.length) return res.status(401).json({ error: 'Credenciais inválidas' });
  const user = users[0];
  if (!user.ativo) return res.status(403).json({ error: 'Conta desativada' });
  const ok = await verifyPassword(password, user.senha_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });
  await supabase.from('usuarios').update({ ultimo_acesso: new Date().toISOString() }).eq('id', user.id);
  const token = generateToken(user.id, user.perfil);
  res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
  res.json({ ok: true, nome: user.nome || user.email });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const { data } = await supabase
    .from('usuarios').select('id,email,nome,perfil,permissoes,ultimo_acesso').eq('id', req.userId).maybeSingle();
  // throttle: só regrava ultimo_acesso se passou > 5 min
  try {
    const last = data?.ultimo_acesso ? new Date(data.ultimo_acesso).getTime() : 0;
    if (Date.now() - last > 5 * 60 * 1000) {
      await supabase.from('usuarios').update({ ultimo_acesso: new Date().toISOString() }).eq('id', req.userId);
    }
  } catch (_) {}
  const user = data || { id: req.userId, perfil: req.userPerfil || 'admin' };
  res.json({
    id: user.id, email: user.email, nome: user.nome,
    perfil: user.perfil || 'admin',
    permissoes: PERMS.resolvePermissions(user),
  });
});

// ── Gestão de Acessos (admin only) ────────────────────────────────────────────
async function logAcesso({ ator, acao, alvo, antes, depois }) {
  try {
    await supabase.from('acessos_log').insert({
      ator_id: ator?.id || null, ator_nome: ator?.nome || ator?.email || null,
      acao, alvo_id: alvo?.id || null, alvo_nome: alvo?.nome || alvo?.email || null,
      antes: antes || null, depois: depois || null,
    });
  } catch (e) { console.warn('[acessos_log]', e.message); }
}
function snapshot(u) { return u ? { perfil: u.perfil, permissoes: u.permissoes, ativo: u.ativo } : null; }

app.get('/api/acessos', requireAuth, requireAdmin, async (_req, res) => {
  const { data, error } = await supabase
    .from('usuarios').select('id,nome,email,perfil,ativo,ultimo_acesso,permissoes').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/acessos/catalogo', requireAuth, requireAdmin, async (_req, res) => {
  const cat = PERMS.catalogForUI();
  const { data: dominios } = await supabase.from('dominios').select('id,nome').order('nome');
  res.json({ ...cat, dominios: dominios || [] });
});

app.get('/api/acessos/log', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const { data, error } = await supabase
    .from('acessos_log').select('*').order('criado_em', { ascending: false }).limit(limit);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/acessos', requireAuth, requireAdmin, async (req, res) => {
  const { nome, email, senha, perfil } = req.body || {};
  if (!email || !senha) return res.status(400).json({ error: 'email e senha são obrigatórios' });
  if (!['admin', 'colaborador'].includes(perfil)) return res.status(400).json({ error: 'perfil inválido' });
  const emailNorm = String(email).toLowerCase().trim();
  const { data: exists } = await supabase.from('usuarios').select('id').eq('email', emailNorm).maybeSingle();
  if (exists) return res.status(409).json({ error: 'email já cadastrado' });
  const permissoes = perfil === 'colaborador' ? PERMS.sanitizePermissions(req.body.permissoes) : null;
  const senha_hash = await hashPassword(senha);
  const { data, error } = await supabase.from('usuarios')
    .insert({ nome: nome || null, email: emailNorm, senha_hash, perfil, permissoes, ativo: true })
    .select('id,nome,email,perfil,ativo').single();
  if (error) return res.status(500).json({ error: error.message });
  await logAcesso({ ator: req.fullUser, acao: 'criar', alvo: data, antes: null, depois: snapshot({ ...data, permissoes }) });
  res.json(data);
});

app.put('/api/acessos/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { data: alvo } = await supabase.from('usuarios')
    .select('id,nome,email,perfil,permissoes,ativo').eq('id', id).maybeSingle();
  if (!alvo) return res.status(404).json({ error: 'usuário não encontrado' });
  const antes = snapshot(alvo);
  const update = {};
  if (req.body.nome !== undefined) update.nome = req.body.nome || null;
  if (req.body.email !== undefined) update.email = String(req.body.email).toLowerCase().trim();
  if (req.body.perfil !== undefined) {
    if (!['admin', 'colaborador'].includes(req.body.perfil)) return res.status(400).json({ error: 'perfil inválido' });
    update.perfil = req.body.perfil;
  }
  const novoPerfil = update.perfil || alvo.perfil;
  if (req.body.permissoes !== undefined || update.perfil) {
    update.permissoes = novoPerfil === 'colaborador'
      ? PERMS.sanitizePermissions(req.body.permissoes ?? alvo.permissoes) : null;
  }
  if (req.body.ativo !== undefined) update.ativo = !!req.body.ativo;

  // Invariantes de proteção
  const rebaixa = update.perfil === 'colaborador' && alvo.perfil === 'admin';
  const desativa = update.ativo === false && alvo.ativo === true;
  if ((rebaixa || desativa) && id === req.userId)
    return res.status(400).json({ error: 'Você não pode rebaixar/desativar a si mesmo' });
  if (rebaixa || desativa) {
    const { count } = await supabase.from('usuarios')
      .select('id', { count: 'exact', head: true }).eq('perfil', 'admin').eq('ativo', true);
    if ((count || 0) <= 1) return res.status(400).json({ error: 'Deve restar ao menos 1 admin ativo' });
  }

  const { data, error } = await supabase.from('usuarios').update(update).eq('id', id)
    .select('id,nome,email,perfil,permissoes,ativo').single();
  if (error) return res.status(500).json({ error: error.message });
  invalidatePermsCache(id);
  await logAcesso({ ator: req.fullUser, acao: 'editar', alvo: data, antes, depois: snapshot(data) });
  res.json(data);
});

app.post('/api/acessos/:id/senha', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { senha } = req.body || {};
  if (!senha || String(senha).length < 4) return res.status(400).json({ error: 'senha muito curta' });
  const { data: alvo } = await supabase.from('usuarios').select('id,nome,email').eq('id', id).maybeSingle();
  if (!alvo) return res.status(404).json({ error: 'usuário não encontrado' });
  const senha_hash = await hashPassword(senha);
  const { error } = await supabase.from('usuarios').update({ senha_hash }).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  invalidatePermsCache(id);
  await logAcesso({ ator: req.fullUser, acao: 'resetar_senha', alvo });
  res.json({ ok: true });
});

app.delete('/api/acessos/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.userId) return res.status(400).json({ error: 'Você não pode excluir a si mesmo' });
  const { data: alvo } = await supabase.from('usuarios')
    .select('id,nome,email,perfil,permissoes,ativo').eq('id', id).maybeSingle();
  if (!alvo) return res.status(404).json({ error: 'usuário não encontrado' });
  if (alvo.perfil === 'admin') {
    const { count } = await supabase.from('usuarios')
      .select('id', { count: 'exact', head: true }).eq('perfil', 'admin').eq('ativo', true);
    if ((count || 0) <= 1) return res.status(400).json({ error: 'Deve restar ao menos 1 admin ativo' });
  }
  const { error } = await supabase.from('usuarios').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  invalidatePermsCache(id);
  await logAcesso({ ator: req.fullUser, acao: 'excluir', alvo, antes: snapshot(alvo), depois: null });
  res.json({ ok: true });
});

// ── Legacy live-API routes ──────────────────────────────────────────────────

// ── Supabase-backed routes (fast — no external API calls) ──────────────────
app.get('/api/overview', requireAuth, overviewHandler);
app.get('/api/orcamento-status', requireAuth, orcamentoStatusHandler);
app.get('/api/dashboard', requireAuth, dashboardHandler);
app.get('/api/reports-gam', requireAuth, reportsGamHandler);
app.get('/api/gam-status', requireAuth, gamStatusHandler);
app.get('/api/intraday', requireAuth, intradayHandler);
app.get('/api/campanha-intraday/:campaignId', requireAuth, campanhaIntradayHandler);
app.post('/api/relatorios/custom', requireAuth, relatorioCustomHandler);

// ── Contas Meta ──────────────────────────────────────────────────────────────
app.get('/api/contas', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('meta_accounts').select('*').order('id');
  if (error) return res.status(500).json({ error: error.message });
  let rows = data || [];
  if (PERMS.elementBlocked(req.fullUser, 'ver_tokens')) {
    rows = rows.map(({ access_token, ...rest }) => ({ ...rest, access_token: null, tem_token: !!access_token }));
  }
  res.json(rows);
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

// ── Páginas Meta ─────────────────────────────────────────────────────────────
app.get('/api/paginas', requireAuth, async (req, res) => {
  try {
    const { account_id } = req.query;
    let q = supabase
      .from('paginas')
      .select('page_id,nome,foto_url,ad_account_id,status,pais_sigla,pais_nome,em_uso_desde,ultima_sync,adsets_ativos,meta_accounts(nome)')
      .order('nome');
    if (account_id) {
      const normalized = String(account_id).startsWith('act_') ? account_id : `act_${account_id}`;
      q = q.eq('ad_account_id', normalized);
    }
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    const rows = (data || [])
      .map(p => ({ ...p, conta_nome: p.meta_accounts?.nome || null, meta_accounts: undefined }))
      .sort((a, b) => {
        const s = (a.status === 'em_uso' ? 0 : 1) - (b.status === 'em_uso' ? 0 : 1);
        return s !== 0 ? s : a.nome.localeCompare(b.nome, 'pt-BR');
      });
    const em_uso     = rows.filter(p => p.status === 'em_uso').length;
    const disponivel = rows.filter(p => p.status === 'disponivel').length;
    const ultima_sync = rows.reduce((mx, p) => (!mx || p.ultima_sync > mx ? p.ultima_sync : mx), null);
    res.json({ paginas: rows, total: rows.length, em_uso, disponivel, ultima_sync });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/paginas/sync', requireAuth, async (_req, res) => {
  try {
    syncPaginas().catch(e => console.warn('[syncPaginas manual]', e.message));
    res.json({ ok: true, message: 'Sync de páginas iniciado em background' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Histórico campanhas: sugerir próximo número ──────────────────────────────
app.get('/api/historico-campanhas/ultimo-numero', requireAuth, async (req, res) => {
  const { sigla, tema, idioma } = req.query;
  if (!sigla || !tema || !idioma) return res.json({ proximo: null });
  try {
    const { data, error } = await supabase
      .from('historico_campanhas')
      .select('numero')
      .ilike('sigla_pais', sigla)
      .ilike('tema', tema)
      .ilike('idioma', idioma)
      .order('numero', { ascending: false })
      .limit(1);
    if (error || !data?.length) return res.json({ proximo: 1 });
    const ultimo = parseInt(data[0].numero, 10) || 0;
    res.json({ proximo: ultimo + 1 });
  } catch (err) {
    res.json({ proximo: null });
  }
});

// ── Domínios ────────────────────────────────────────────────────────────────
app.get('/api/dominios', requireAuth, async (req, res) => {
  let q = supabase.from('dominios').select('*').order('nome');
  if (Array.isArray(req.allowedDominios)) {
    q = q.in('id', req.allowedDominios.length ? req.allowedDominios : [-1]);
  }
  const { data, error } = await q;
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

// ── Diretório (links importantes: sheets, docs, pastas) ─────────────────────────
app.get('/api/diretorio', requireAuth, async (_req, res) => {
  const { data, error } = await supabase.from('diretorio_links').select('*').order('categoria').order('ordem').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/diretorio', requireAuth, async (req, res) => {
  const { titulo, url, categoria, descricao } = req.body || {};
  if (!titulo || !url) return res.status(400).json({ error: 'titulo e url são obrigatórios' });
  let link = String(url).trim();
  if (!/^https?:\/\//i.test(link)) link = `https://${link}`;
  const { data, error } = await supabase.from('diretorio_links').insert({
    titulo: String(titulo).trim(),
    url: link,
    categoria: categoria || 'Link',
    descricao: descricao ? String(descricao).trim() : null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/diretorio/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const update = {};
  if (req.body.titulo !== undefined)    update.titulo = String(req.body.titulo).trim();
  if (req.body.categoria !== undefined) update.categoria = req.body.categoria || 'Link';
  if (req.body.descricao !== undefined) update.descricao = req.body.descricao ? String(req.body.descricao).trim() : null;
  if (req.body.url !== undefined) {
    let link = String(req.body.url).trim();
    if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
    update.url = link;
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: 'Nada para atualizar' });
  update.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('diretorio_links').update(update).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/diretorio/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('diretorio_links').delete().eq('id', Number(req.params.id));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

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

// ── Conjuntos ativos por UTM (ads ACTIVE na Meta → adset_ids distintos) ───────
let _conjAtivosCache = { ts: 0, data: null };
app.get('/api/utms/conjuntos-ativos', requireAuth, async (_req, res) => {
  try {
    if (_conjAtivosCache.data && Date.now() - _conjAtivosCache.ts < 60000) {
      return res.json(_conjAtivosCache.data);
    }
    const { data: accounts } = await supabase
      .from('meta_accounts')
      .select('ad_account_id,access_token')
      .eq('ativo', true);

    const adsetsPorUtm = {}; // utm → Set(adset_id)
    for (const acc of accounts || []) {
      if (!acc.access_token) continue;
      const accountId = String(acc.ad_account_id).startsWith('act_')
        ? String(acc.ad_account_id) : `act_${acc.ad_account_id}`;
      try {
        let nextUrl = `${META_BASE}/${accountId}/ads`;
        let params = {
          access_token: acc.access_token,
          fields: 'name,adset_id',
          effective_status: JSON.stringify(['ACTIVE']),
          limit: 500,
        };
        while (nextUrl) {
          const r = await axios.get(nextUrl, { params, timeout: 30000 });
          for (const ad of r.data?.data || []) {
            const utm = extractAdUTM(ad.name);
            if (!utm || !ad.adset_id) continue;
            if (!adsetsPorUtm[utm]) adsetsPorUtm[utm] = new Set();
            adsetsPorUtm[utm].add(ad.adset_id);
          }
          nextUrl = (r.data?.data || []).length > 0 ? (r.data?.paging?.next || null) : null;
          params = undefined;
        }
      } catch (e) {
        console.warn(`[conjuntos-ativos] ${accountId}:`, e.response?.data?.error?.message || e.message);
      }
    }

    const out = Object.fromEntries(
      Object.entries(adsetsPorUtm).map(([utm, set]) => [utm, set.size])
    );
    _conjAtivosCache = { ts: Date.now(), data: out };
    res.json(out);
  } catch (err) {
    console.error('[conjuntos-ativos]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Drilldown ─────────────────────────────────────────────────────────────────
app.get('/api/drilldown/:utm', requireAuth, drilldownHandler);

// ── Otimizações ───────────────────────────────────────────────────────────────
// Static routes must come BEFORE :id param routes to avoid capture

// ── Gerenciador ───────────────────────────────────────────────────────────────

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
      .select('pais_sigla,pais_nome,pais_emoji,ad_utm,valor_gasto,faturamento_real,lucro,ecpm,tipo')
      .gte('data', since)
      .lte('data', until)
      .neq('pais_sigla', '');

    if (error) return res.status(500).json({ error: error.message });

    // Aggregate: country → { utms: Map(utm → {...}) }
    const paisMap = {};
    for (const r of rows || []) {
      const sig = r.pais_sigla;
      if (!paisMap[sig]) {
        const info = resolveCountry(sig) || {};
        paisMap[sig] = {
          pais_sigla: sig,
          pais_nome: r.pais_nome || info.nome || sig,
          emoji: r.pais_emoji || info.emoji || '🌍',
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

// ── Análise de País ───────────────────────────────────────────────────────────
function _apDefaults(req) {
  const now = new Date();
  return {
    since: req.query.since || new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10),
    until: req.query.until || now.toISOString().slice(0, 10),
    nicho: req.query.nicho && req.query.nicho !== 'all' ? req.query.nicho : null,
    tipo:  req.query.tipo  && req.query.tipo  !== 'all' ? req.query.tipo  : null,
  };
}

// MUST be before /:sigla to avoid 'nichos' matching as a sigla
app.get('/api/analise-paises/nichos', requireAuth, async (req, res) => {
  try {
    const { since, until } = _apDefaults(req);
    const { data, error } = await supabase
      .from('ads_consolidados')
      .select('nicho')
      .gte('data', since)
      .lte('data', until)
      .not('nicho', 'is', null);
    if (error) return res.status(500).json({ error: error.message });
    const nichos = [...new Set((data || []).map(r => r.nicho).filter(Boolean))].sort();
    res.json(nichos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analise-paises/:sigla', requireAuth, async (req, res) => {
  try {
    const { since, until, nicho, tipo } = _apDefaults(req);
    const sigla = req.params.sigla;
    let q = supabase
      .from('ads_consolidados')
      .select('ad_utm,valor_gasto,faturamento_real,faturamento_bruto,lucro,impressoes_gam,ecpm')
      .gte('data', since)
      .lte('data', until)
      .eq('pais_sigla', sigla);
    if (nicho) q = q.eq('nicho', nicho);
    if (tipo)  q = q.eq('tipo', tipo);
    const { data: rows, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const utmMap = {};
    for (const r of rows || []) {
      const utm = r.ad_utm;
      if (!utmMap[utm]) utmMap[utm] = { utm, investimento: 0, faturamento: 0, faturamento_bruto: 0, lucro: 0, impressoes_gam: 0, _ecpmImpSum: 0, _ecpmImpW: 0 };
      const u = utmMap[utm];
      u.investimento      += Number(r.valor_gasto      || 0);
      u.faturamento       += Number(r.faturamento_real  || 0);
      u.faturamento_bruto += Number(r.faturamento_bruto || 0);
      u.lucro             += Number(r.lucro             || 0);
      u.impressoes_gam    += Number(r.impressoes_gam    || 0);
      const imp = Number(r.impressoes_gam || 0);
      if (imp > 0 && (r.ecpm || 0) > 0) { u._ecpmImpSum += r.ecpm * imp; u._ecpmImpW += imp; }
    }

    const utms = Object.values(utmMap).map(u => {
      const ecpm_gam = u._ecpmImpW > 0 ? +(u._ecpmImpSum / u._ecpmImpW).toFixed(2)
        : u.impressoes_gam > 0 ? +(u.faturamento_bruto / u.impressoes_gam * 1000).toFixed(2) : 0;
      return {
        utm: u.utm,
        investimento:      +u.investimento.toFixed(2),
        faturamento:       +u.faturamento.toFixed(2),
        receita_gam_bruta: +u.faturamento_bruto.toFixed(2),
        lucro:             +u.lucro.toFixed(2),
        roas:              u.investimento > 0 ? +(u.faturamento / u.investimento).toFixed(2) : 0,
        impressoes_gam:    u.impressoes_gam,
        ecpm_gam,
      };
    }).sort((a, b) => b.faturamento - a.faturamento);

    res.json(utms);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analise-paises', requireAuth, async (req, res) => {
  try {
    const { since, until, nicho, tipo } = _apDefaults(req);
    let q = supabase
      .from('ads_consolidados')
      .select('pais_sigla,pais_nome,pais_emoji,valor_gasto,faturamento_real,faturamento_bruto,lucro,impressoes_gam,ecpm')
      .gte('data', since)
      .lte('data', until)
      .neq('pais_sigla', '');
    if (nicho) q = q.eq('nicho', nicho);
    if (tipo)  q = q.eq('tipo', tipo);
    const { data: rows, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const paisMap = {};
    for (const r of rows || []) {
      const sig = r.pais_sigla;
      if (!sig) continue;
      if (!paisMap[sig]) {
        const info = resolveCountry(sig) || {};
        paisMap[sig] = { pais_sigla: sig, pais_nome: r.pais_nome || info.nome || sig, emoji: r.pais_emoji || info.emoji || '🌍', investimento: 0, faturamento: 0, faturamento_bruto: 0, lucro: 0, impressoes_gam: 0, _ecpmImpSum: 0, _ecpmImpW: 0, _utms: new Set() };
      }
      const p = paisMap[sig];
      p.investimento      += Number(r.valor_gasto      || 0);
      p.faturamento       += Number(r.faturamento_real  || 0);
      p.faturamento_bruto += Number(r.faturamento_bruto || 0);
      p.lucro             += Number(r.lucro             || 0);
      p.impressoes_gam    += Number(r.impressoes_gam    || 0);
      if (r.ad_utm) p._utms.add(r.ad_utm);
      const imp = Number(r.impressoes_gam || 0);
      if (imp > 0 && (r.ecpm || 0) > 0) { p._ecpmImpSum += r.ecpm * imp; p._ecpmImpW += imp; }
    }

    const result = Object.values(paisMap).map(p => {
      const ecpm_gam = p._ecpmImpW > 0 ? +(p._ecpmImpSum / p._ecpmImpW).toFixed(2)
        : p.impressoes_gam > 0 ? +(p.faturamento_bruto / p.impressoes_gam * 1000).toFixed(2) : 0;
      return {
        pais_sigla:        p.pais_sigla,
        pais_nome:         p.pais_nome,
        emoji:             p.emoji,
        investimento:      +p.investimento.toFixed(2),
        faturamento:       +p.faturamento.toFixed(2),
        receita_gam_bruta: +p.faturamento_bruto.toFixed(2),
        lucro:             +p.lucro.toFixed(2),
        roas:              p.investimento > 0 ? +(p.faturamento / p.investimento).toFixed(2) : 0,
        impressoes_gam:    p.impressoes_gam,
        ecpm_gam,
        num_utms:          p._utms.size,
      };
    }).sort((a, b) => b.faturamento - a.faturamento);

    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

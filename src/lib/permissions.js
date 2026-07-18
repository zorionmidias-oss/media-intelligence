'use strict';

// ── Telas (chaves alinhadas ao nav('<key>') do dashboard) ───────────────────
const SCREENS = [
  { key: 'overview',       label: 'Overview' },
  { key: 'campaigns',      label: 'Campanhas' },
  { key: 'analise-paises', label: 'Análise de País' },
  { key: 'gam',            label: 'Reports GAM' },
  { key: 'funil',          label: 'Análise de Funil' },
  { key: 'relatorios',     label: 'Relatórios' },
  { key: 'contas',         label: 'Contas Meta' },
  { key: 'diretorio',      label: 'Diretório' },
  { key: 'domains',        label: 'Domínios' },
  { key: 'metas',          label: 'Metas' },
  { key: 'acessos',        label: 'Acessos', adminOnly: true },
];

// ── Elementos (UI + enforcement quando há rota/dado sensível) ───────────────
const ELEMENTS = [
  { key: 'ver_tokens',         label: 'Ver tokens das contas Meta', tela: 'contas' },
  { key: 'ver_pais',           label: 'Ver país/sigla nas tabelas', tela: 'campaigns' },
  { key: 'criar_campanha',     label: 'Criar campanhas (BOT)',      tela: 'campaigns' },
  { key: 'expandir_conjuntos', label: 'Expandir conjuntos por UTM', tela: 'campaigns' },
  { key: 'coluna_acoes',       label: 'Coluna de ações na tabela',  tela: 'campaigns' },
];

// ── Rotas → telas. mode: read|write. common: qualquer autenticado. ──────────
// element: bloqueio extra por elemento. Ordem: literais antes de :param colidente.
function rx(pattern) {
  const re = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[^/]+/g, '[^/]+');
  return new RegExp('^' + re + '$');
}
const R = (method, pattern, screens, mode, element) => ({
  method, re: rx(pattern), screens, mode, element,
  common: screens === 'common',
});

const ROUTES = [
  // common (qualquer autenticado) — /api/dominios é filtrado por domínio na rota
  R('GET', '/api/notificacoes', 'common'),
  R('POST', '/api/notificacoes/:id/marcar-lida', 'common'),
  R('POST', '/api/notificacoes/marcar-todas-lidas', 'common'),
  R('GET', '/api/dominios', 'common'),

  // overview
  R('GET', '/api/overview', ['overview'], 'read'),
  R('GET', '/api/orcamento-status', ['overview', 'campaigns'], 'read'),
  R('GET', '/api/gam-status', ['overview', 'gam'], 'read'),
  R('GET', '/api/intraday', ['overview'], 'read'),
  R('GET', '/api/sync/log', ['overview'], 'read'),
  R('POST', '/api/sync/forcar', ['overview'], 'write'),
  R('POST', '/api/sync/hourly', ['overview'], 'write'),

  // campaigns (gestão + criação BOT)
  R('GET', '/api/dashboard', ['overview', 'campaigns'], 'read'),
  R('GET', '/api/utms/conjuntos-ativos', ['campaigns'], 'read', 'expandir_conjuntos'),
  R('GET', '/api/utms', ['campaigns'], 'read'),
  R('GET', '/api/drilldown/:utm', ['campaigns'], 'read'),
  R('GET', '/api/historico-campanhas/ultimo-numero', ['campaigns'], 'read'),
  R('GET', '/api/historico/:utm', ['campaigns'], 'read'),
  R('GET', '/api/meta/campaign/:id', ['campaigns'], 'read'),
  R('POST', '/api/meta/campaign/:id/toggle', ['campaigns'], 'write'),
  R('POST', '/api/meta/campaign/:id/budget', ['campaigns'], 'write'),
  R('DELETE', '/api/meta/campaign/:id', ['campaigns'], 'write'),
  R('DELETE', '/api/meta/adset/:id', ['campaigns'], 'write'),
  R('DELETE', '/api/meta/ad/:id', ['campaigns'], 'write'),
  R('POST', '/api/meta/adset/:id/toggle', ['campaigns'], 'write'),
  R('POST', '/api/meta/adset/:id/budget', ['campaigns'], 'write'),
  R('POST', '/api/meta/ad/:id/toggle', ['campaigns'], 'write'),
  // criação BOT (element criar_campanha)
  R('POST', '/api/campaigns/dry-run', ['campaigns'], 'write', 'criar_campanha'),
  R('POST', '/api/campaigns/criar', ['campaigns'], 'write', 'criar_campanha'),
  R('GET', '/api/meta-accounts', ['campaigns'], 'read'),
  R('GET', '/api/paginas', ['campaigns'], 'read'),
  R('POST', '/api/paginas/sync', ['campaigns'], 'write'),
  R('GET', '/api/meta-resources/:resource', ['campaigns'], 'read'),
  R('POST', '/api/meta-resources/upload-image', ['campaigns'], 'write', 'criar_campanha'),
  R('POST', '/api/meta-resources/upload-video', ['campaigns'], 'write', 'criar_campanha'),
  R('POST', '/api/templates/seed', ['campaigns'], 'write'),
  R('POST', '/api/templates/:id/duplicar', ['campaigns'], 'write'),
  R('GET', '/api/templates/:id', ['campaigns'], 'read'),
  R('PUT', '/api/templates/:id', ['campaigns'], 'write'),
  R('DELETE', '/api/templates/:id', ['campaigns'], 'write'),
  R('GET', '/api/templates', ['campaigns'], 'read'),
  R('POST', '/api/templates', ['campaigns'], 'write'),
  R('GET', '/api/conversation-templates', ['campaigns'], 'read'),
  R('POST', '/api/conversation-templates', ['campaigns'], 'write'),
  R('DELETE', '/api/conversation-templates/:id', ['campaigns'], 'write'),
  R('GET', '/api/ad-copies-templates', ['campaigns'], 'read'),
  R('POST', '/api/ad-copies-templates', ['campaigns'], 'write'),
  R('DELETE', '/api/ad-copies-templates/:id', ['campaigns'], 'write'),

  // analise-paises
  R('GET', '/api/paises', ['analise-paises'], 'read'),
  R('GET', '/api/analise-paises/nichos', ['analise-paises'], 'read'),
  R('GET', '/api/analise-paises/:sigla', ['analise-paises'], 'read'),
  R('GET', '/api/analise-paises', ['analise-paises'], 'read'),

  // gam
  R('GET', '/api/reports-gam', ['gam', 'overview'], 'read'),

  // funil
  R('GET', '/api/funil-botoes', ['funil'], 'read'),
  R('GET', '/api/funil', ['funil'], 'read'),


  // relatorios
  R('POST', '/api/relatorios/custom', ['relatorios'], 'read'),

  // contas (token sai pelo elemento ver_tokens)
  R('GET', '/api/contas', ['contas'], 'read'),
  R('POST', '/api/contas/testar', ['contas'], 'write'),
  R('POST', '/api/contas', ['contas'], 'write'),
  R('POST', '/api/contas/:id/testar', ['contas'], 'write'),
  R('POST', '/api/contas/:id/imposto', ['contas'], 'write'),
  R('PUT', '/api/contas/:id', ['contas'], 'write'),
  R('DELETE', '/api/contas/:id', ['contas'], 'write'),
  R('POST', '/api/admin/recalcular-imposto', ['contas'], 'write'),

  // diretorio
  R('GET', '/api/diretorio', ['diretorio'], 'read'),
  R('POST', '/api/diretorio', ['diretorio'], 'write'),
  R('PUT', '/api/diretorio/:id', ['diretorio'], 'write'),
  R('DELETE', '/api/diretorio/:id', ['diretorio'], 'write'),

  // domains
  R('GET', '/api/dominios/pendentes', ['domains'], 'read'),
  R('POST', '/api/dominios/aprovar', ['domains'], 'write'),
  R('POST', '/api/dominios', ['domains'], 'write'),

  // metas
  R('GET', '/api/metas', ['metas', 'overview'], 'read'),
  R('POST', '/api/metas', ['metas'], 'write'),
  R('PUT', '/api/metas/:id', ['metas'], 'write'),
  R('DELETE', '/api/metas/:id', ['metas'], 'write'),
];

// ── Helpers ─────────────────────────────────────────────────────────────────
function isAdmin(user) {
  return !user || (user.perfil !== 'colaborador'); // legado/admin = total
}
function getPerms(user) {
  return user?.permissoes || { telas: {}, dominios: { todos: false, ids: [] }, elementos: {} };
}
function hasScreen(perms, screenKey, action) {
  const v = perms.telas?.[screenKey];
  if (!v) return false;
  return action === 'write' ? v === 'edit' : (v === 'view' || v === 'edit');
}
function elementBlocked(user, key) {
  if (isAdmin(user)) return false;
  // colaborador: elemento liberado só quando concedido explicitamente (default-deny)
  return getPerms(user).elementos?.[key] !== true;
}
function allowedDomainIds(user) {
  if (isAdmin(user)) return null; // null = todos
  const d = getPerms(user).dominios || {};
  if (d.todos) return null;
  return Array.isArray(d.ids) ? d.ids.map(Number) : [];
}
function findRoute(method, path) {
  for (const r of ROUTES) if (r.method === method && r.re.test(path)) return r;
  return null;
}
// retorna { allow:boolean, reason?:string }
function checkAccess(user, method, path) {
  if (isAdmin(user)) return { allow: true };
  const r = findRoute(method, path);
  if (!r) return { allow: false, reason: 'rota não catalogada' };
  if (r.common) return { allow: true };
  const perms = getPerms(user);
  const ok = (r.screens || []).some(s => hasScreen(perms, s, r.mode));
  if (!ok) return { allow: false, reason: 'sem tela/ação' };
  if (r.element && elementBlocked(user, r.element)) return { allow: false, reason: 'elemento bloqueado' };
  return { allow: true };
}
function resolvePermissions(user) {
  if (isAdmin(user)) return { admin: true };
  const p = getPerms(user);
  return { admin: false, telas: p.telas || {}, dominios: p.dominios || { todos: false, ids: [] }, elementos: p.elementos || {} };
}
function catalogForUI() {
  return { screens: SCREENS.filter(s => !s.adminOnly), elements: ELEMENTS };
}
// sanitiza payload de permissões contra o catálogo (defesa contra forja)
function sanitizePermissions(input) {
  const out = { telas: {}, dominios: { todos: false, ids: [] }, elementos: {} };
  const validScreens = new Set(SCREENS.filter(s => !s.adminOnly).map(s => s.key));
  const validEls = new Set(ELEMENTS.map(e => e.key));
  const t = input?.telas || {};
  for (const k of Object.keys(t)) if (validScreens.has(k) && (t[k] === 'view' || t[k] === 'edit')) out.telas[k] = t[k];
  const d = input?.dominios || {};
  out.dominios.todos = !!d.todos;
  out.dominios.ids = Array.isArray(d.ids) ? [...new Set(d.ids.map(Number).filter(n => Number.isFinite(n)))] : [];
  const e = input?.elementos || {};
  // default-deny: cada elemento conhecido vira booleano explícito (true só se concedido)
  for (const el of ELEMENTS) out.elementos[el.key] = e[el.key] === true;
  return out;
}

module.exports = {
  SCREENS, ELEMENTS, ROUTES,
  isAdmin, getPerms, hasScreen, elementBlocked, allowedDomainIds,
  findRoute, checkAccess, resolvePermissions, catalogForUI, sanitizePermissions,
};

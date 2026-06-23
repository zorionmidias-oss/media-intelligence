# Gestão de Acessos (RBAC granular) — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar uma tela de administração para criar/editar usuários e níveis de acesso (admin total | colaborador com permissões granulares por tela, ação ver/editar, domínio e elemento), com último-acesso ao dash e auditoria — segurança real no servidor (deny-by-default).

**Architecture:** Mantém o auth atual (JWT+bcrypt, cookie httpOnly). Um catálogo central em `src/lib/permissions.js` declara telas→rotas (read/write) e elementos; um middleware "porteiro" em `server.js` substitui o `RESTRITO_ALLOW` e bloqueia por padrão tudo que não está explicitamente concedido. Permissões ficam numa coluna `usuarios.permissoes` (JSONB). Rotas `/api/acessos/*` (admin-only) fazem o CRUD e gravam auditoria em `acessos_log`. Frontend lê `/api/auth/me` e esconde telas/elementos (cosmético; segurança é o porteiro).

**Tech Stack:** Node + Express, supabase-js (service-role), bcrypt, jsonwebtoken, HTML monólito (`public/dashboard.html`).

**Validação (sem testes automáticos):** cada task verifica via (a) script Node de diagnóstico em `scripts/`, (b) chamada HTTP manual com cookie de um usuário de teste, ou (c) screenshot Playwright `node scripts/_shot.js`. Rodar scripts avulsos com `$env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config <script>`.

**Convenções fixadas:**
- `perfil`: `admin` | `colaborador` (legado `restrito` e tokens antigos → tratados como admin só se não forem colaborador; o `restrito` é migrado para colaborador).
- Estrutura de `permissoes`:
  ```json
  { "telas": {"overview":"view","campaigns":"edit"},
    "dominios": {"todos":false,"ids":[12,34]},
    "elementos": {"ver_tokens":false,"ver_pais":false,"criar_campanha":false} }
  ```
- Elemento `false` = bloqueado; ausência = liberado dentro de uma tela já concedida.

---

## Task 0: Branch + usuário de teste

**Files:** nenhum (setup).

**Step 1:** Criar branch de trabalho.
```bash
git checkout -b feat/gestao-acessos
```

**Step 2:** Confirmar que o servidor sobe localmente.
```bash
node server.js   # ctrl-c após ver "running at http://localhost:3000"
```
Expected: log de boot sem erro.

**Step 3:** Commit inicial vazio de marco (opcional).
```bash
git commit --allow-empty -m "chore(acessos): inicia feature de gestão de acessos"
```

---

## Task 1: Migração SQL (coluna permissoes + tabela acessos_log)

**Files:**
- Create: `scripts/sql/add-gestao-acessos.sql`
- Create: `scripts/check-acessos-schema.js`

**Step 1:** Escrever o SQL (rodado manualmente no SQL Editor do Supabase — sem connection string PG no ambiente).
```sql
-- scripts/sql/add-gestao-acessos.sql
alter table usuarios add column if not exists permissoes jsonb;

-- perfil passa a aceitar admin|colaborador (mantém valores antigos por enquanto)
-- (sem CHECK rígido para não quebrar linhas legadas; validação é na aplicação)

create table if not exists acessos_log (
  id          bigint generated always as identity primary key,
  ator_id     bigint references usuarios(id) on delete set null,
  ator_nome   text,
  acao        text not null,            -- criar|editar|resetar_senha|ativar|desativar|excluir
  alvo_id     bigint references usuarios(id) on delete set null,
  alvo_nome   text,
  antes       jsonb,
  depois      jsonb,
  criado_em   timestamptz not null default now()
);
create index if not exists acessos_log_criado_em_idx on acessos_log (criado_em desc);
```

**Step 2:** Escrever script de verificação do schema.
```js
// scripts/check-acessos-schema.js
'use strict';
const supabase = require('../src/lib/supabase');
(async () => {
  const u = await supabase.from('usuarios').select('id,permissoes').limit(1);
  console.log('usuarios.permissoes ok?', !u.error, u.error?.message || '');
  const l = await supabase.from('acessos_log').select('id').limit(1);
  console.log('acessos_log ok?', !l.error, l.error?.message || '');
})();
```

**Step 3:** Rodar o SQL no Supabase (manual) e depois verificar.
```bash
$env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/check-acessos-schema.js
```
Expected: `usuarios.permissoes ok? true` e `acessos_log ok? true`.

**Step 4:** Commit.
```bash
git add scripts/sql/add-gestao-acessos.sql scripts/check-acessos-schema.js
git commit -m "feat(acessos): migração SQL (permissoes jsonb + acessos_log)"
```

---

## Task 2: Catálogo central `src/lib/permissions.js`

**Files:**
- Create: `src/lib/permissions.js`
- Create: `scripts/check-permissions-catalog.js`

**Step 1:** Implementar o módulo. Conteúdo completo:

```js
'use strict';

// ── Telas (chaves alinhadas ao nav('<key>') do dashboard) ───────────────────
const SCREENS = [
  { key: 'overview',       label: 'Overview' },
  { key: 'campaigns',      label: 'Campanhas' },
  { key: 'analise-paises', label: 'Análise de País' },
  { key: 'gam',            label: 'Reports GAM' },
  { key: 'funil',          label: 'Análise de Funil' },
  { key: 'otimizacoes',    label: 'Otimizações' },
  { key: 'ai',             label: 'Análise IA' },
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
  R('GET', '/api/metrics', ['overview'], 'read'),
  R('GET', '/api/sync/log', ['overview'], 'read'),
  R('POST', '/api/sync/forcar', ['overview'], 'write'),
  R('POST', '/api/sync/hourly', ['overview'], 'write'),

  // campaigns (gestão + criação BOT)
  R('GET', '/api/dashboard', ['overview', 'campaigns'], 'read'),
  R('GET', '/api/utms/conjuntos-ativos', ['campaigns'], 'read', 'expandir_conjuntos'),
  R('GET', '/api/utms', ['campaigns'], 'read'),
  R('GET', '/api/drilldown/:utm', ['campaigns'], 'read'),
  R('GET', '/api/gerenciador', ['campaigns'], 'read'),
  R('GET', '/api/historico-campanhas/ultimo-numero', ['campaigns'], 'read'),
  R('GET', '/api/historico/:utm', ['campaigns'], 'read'),
  R('POST', '/api/insights', ['campaigns'], 'read'),
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

  // otimizacoes
  R('GET', '/api/otimizacoes/tipos-acao', ['otimizacoes'], 'read'),
  R('POST', '/api/otimizacoes/tipos-acao', ['otimizacoes'], 'write'),
  R('PUT', '/api/otimizacoes/tipos-acao/:id', ['otimizacoes'], 'write'),
  R('DELETE', '/api/otimizacoes/tipos-acao/:id', ['otimizacoes'], 'write'),
  R('GET', '/api/otimizacoes/preview', ['otimizacoes'], 'read'),
  R('GET', '/api/otimizacoes/snapshot-preview', ['otimizacoes'], 'read'),
  R('GET', '/api/otimizacoes/revisar', ['otimizacoes'], 'read'),
  R('GET', '/api/otimizacoes/pendentes-por-utm', ['otimizacoes'], 'read'),
  R('GET', '/api/otimizacoes/:id/timeline', ['otimizacoes'], 'read'),
  R('POST', '/api/otimizacoes/:id/fechar', ['otimizacoes'], 'write'),
  R('GET', '/api/otimizacoes', ['otimizacoes'], 'read'),
  R('POST', '/api/otimizacoes', ['otimizacoes'], 'write'),

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
  return getPerms(user).elementos?.[key] === false;
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
  for (const k of Object.keys(e)) if (validEls.has(k)) out.elementos[k] = e[k] !== false ? true : false;
  return out;
}

module.exports = {
  SCREENS, ELEMENTS, ROUTES,
  isAdmin, getPerms, hasScreen, elementBlocked, allowedDomainIds,
  findRoute, checkAccess, resolvePermissions, catalogForUI, sanitizePermissions,
};
```

**Step 2:** Escrever script de verificação do catálogo (testa o porteiro em memória, sem servidor).
```js
// scripts/check-permissions-catalog.js
'use strict';
const P = require('../src/lib/permissions');
const colaborador = { perfil: 'colaborador', permissoes: {
  telas: { overview: 'view', campaigns: 'edit' },
  dominios: { todos: false, ids: [1, 2] },
  elementos: { ver_tokens: false, ver_pais: false },
} };
const admin = { perfil: 'admin' };
const cases = [
  ['admin total',        admin,       'GET',  '/api/contas',                 true],
  ['colab overview ok',  colaborador, 'GET',  '/api/overview',               true],
  ['colab contas NEG',   colaborador, 'GET',  '/api/contas',                 false],
  ['colab camp write ok',colaborador, 'POST', '/api/meta/adset/9/toggle',    true],
  ['colab camp read-only get drilldown', colaborador, 'GET', '/api/drilldown/abc', true],
  ['colab rota nova NEG',colaborador, 'GET',  '/api/futura-rota',            false],
  ['colab notif common', colaborador, 'GET',  '/api/notificacoes',           true],
  ['colab criar_campanha NEG', colaborador, 'POST', '/api/campaigns/criar',  false],
];
let fail = 0;
for (const [nome, u, m, p, exp] of cases) {
  const got = P.checkAccess(u, m, p).allow;
  const ok = got === exp;
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'XX '} ${nome}: esperado=${exp} obtido=${got}`);
}
console.log('domínios colaborador:', P.allowedDomainIds(colaborador));   // [1,2]
console.log('domínios admin:', P.allowedDomainIds(admin));               // null
console.log(fail === 0 ? 'TODOS PASSARAM' : `${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
```

**Step 3:** Rodar.
```bash
node scripts/check-permissions-catalog.js
```
Expected: `TODOS PASSARAM`, domínios colaborador `[1,2]`, admin `null`.

**Step 4:** Commit.
```bash
git add src/lib/permissions.js scripts/check-permissions-catalog.js
git commit -m "feat(acessos): catálogo central de permissões + porteiro (lib)"
```

---

## Task 3: Porteiro no server.js (substitui RESTRITO_ALLOW) + cache de permissões

**Files:**
- Modify: `server.js:36` (import), `server.js:47-68` (gate)

**Step 1:** Adicionar import do módulo (junto aos outros requires, ~linha 37).
```js
const PERMS = require('./src/lib/permissions');
```

**Step 2:** Substituir o bloco `RESTRITO_ALLOW` (linhas 47-68) por: cache curto de permissões + porteiro deny-by-default.
```js
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
```

**Step 3:** Verificar com servidor + dois cookies (admin e colaborador de teste). Criar um colaborador de teste rápido (reusar o usuário `thejoker` após a Task 7 de migração, ou criar manualmente). Por ora, validar que admin não é bloqueado:
```bash
node server.js   # background
# login admin e bater numa rota:
curl -s -c cookies.txt -X POST localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"SEU_EMAIL","password":"SUA_SENHA"}'
curl -s -b cookies.txt localhost:3000/api/contas | head -c 200   # admin: 200 + JSON
```
Expected: admin recebe dados (não 403). (Teste do colaborador é coberto na Task 8.)

**Step 4:** Exportar helpers de cache para uso nas rotas de acessos. No fim do arquivo (antes de `app.listen`) não é necessário export — `invalidatePermsCache` está no mesmo escopo do `server.js` e será chamado direto nas rotas `/api/acessos/*` (mesmo arquivo).

**Step 5:** Commit.
```bash
git add server.js
git commit -m "feat(acessos): porteiro deny-by-default + cache de permissões (substitui RESTRITO_ALLOW)"
```

---

## Task 4: `/api/auth/me` retorna permissões + último acesso por abertura

**Files:**
- Modify: `server.js:110-113`

**Step 1:** Substituir o handler `/api/auth/me` por versão que: resolve permissões e atualiza `ultimo_acesso` com throttle (>5 min).
```js
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
```

**Step 2:** Verificar.
```bash
curl -s -b cookies.txt localhost:3000/api/auth/me
```
Expected (admin): `{"perfil":"admin","permissoes":{"admin":true},...}`.

**Step 3:** Commit.
```bash
git add server.js
git commit -m "feat(acessos): /api/auth/me devolve permissões e grava último acesso (throttle 5min)"
```

---

## Task 5: Sanitização de elementos sensíveis na resposta (tokens, país)

**Files:**
- Modify: `server.js` rota `GET /api/contas` (linha ~129)
- Modify: `src/app/api/dashboard/route.js` (strip país quando `ver_pais=false`)

**Step 1:** Em `GET /api/contas`, remover `access_token` quando o elemento `ver_tokens` está bloqueado.
```js
app.get('/api/contas', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('meta_accounts').select('*').order('id');
  if (error) return res.status(500).json({ error: error.message });
  let rows = data || [];
  if (PERMS.elementBlocked(req.fullUser, 'ver_tokens')) {
    rows = rows.map(({ access_token, ...rest }) => ({ ...rest, access_token: null, tem_token: !!access_token }));
  }
  res.json(rows);
});
```

**Step 2:** No `dashboard/route.js`, localizar onde `pais_sigla`/`pais_nome` são montados (o handler hoje já tem lógica de remover país para `restrito` via `req.userPerfil`). Generalizar para usar o elemento `ver_pais`. Procurar no arquivo por `userPerfil` / `pais_sigla` e trocar a condição:
```js
const escondePais = require('../../../lib/permissions').elementBlocked(req.fullUser, 'ver_pais');
// onde antes era: if (req.userPerfil === 'restrito') { delete row.pais_sigla; ... }
// usar: if (escondePais) { row.pais_sigla = null; row.pais_nome = null; row.pais_emoji = null; }
```
> Nota de implementação: ler o arquivo e adaptar à estrutura real. Se hoje não houver strip de país no dashboard (estava só no dashboard via req.userPerfil==='restrito'), aplicar o `escondePais` no mapeamento final das linhas.

**Step 3:** Verificar (após ter um colaborador com `ver_tokens:false` — Task 8). Para admin, garantir que token continua presente:
```bash
curl -s -b cookies.txt localhost:3000/api/contas | grep -o '"access_token":' | head -1
```
Expected (admin): encontra `"access_token":` com valor real.

**Step 4:** Commit.
```bash
git add server.js src/app/api/dashboard/route.js
git commit -m "feat(acessos): strip de token/país no servidor por elemento (ver_tokens/ver_pais)"
```

---

## Task 6: Filtro de domínio nas rotas de dados principais

**Files:**
- Modify: `src/app/api/overview/route.js`
- Modify: `src/app/api/dashboard/route.js`
- Modify: `src/app/api/reports-gam/route.js`
- Modify: `src/app/api/intraday/route.js`
- Modify: `server.js` (rota `GET /api/dominios` — filtrar lista por allowedDominios)

**Step 1:** Em cada handler que consulta `ads_consolidados`/`blocos_anuncio`, aplicar `req.allowedDominios` (array) com `.in('dominio_id', ids)`. Padrão a inserir logo após montar a query e o filtro de `domain` existente:
```js
// restrição por domínio do colaborador (null = todos)
if (Array.isArray(req.allowedDominios)) {
  if (req.allowedDominios.length === 0) return res.json(/* vazio adequado ao formato da rota */);
  adsQ = adsQ.in('dominio_id', req.allowedDominios);
  gamQ = gamQ.in('dominio_id', req.allowedDominios); // onde a tabela tiver dominio_id
}
```
> `blocos_anuncio` tem `dominio_id` (ver CLAUDE.md). Para queries sem `dominio_id`, pular o filtro nessa query e documentar.

**Step 2:** Em `GET /api/dominios` (server.js), filtrar a própria lista:
```js
app.get('/api/dominios', requireAuth, async (req, res) => {
  let q = supabase.from('dominios').select('*').order('nome');
  if (Array.isArray(req.allowedDominios)) q = q.in('id', req.allowedDominios);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
```

**Step 3:** Validar com o colaborador de teste (após Task 8): confirmar que `/api/overview` e `/api/dominios` só trazem os domínios permitidos. Script de diagnóstico:
```bash
# scripts/check-domain-scope.js (criar): loga overview totals com cookie do colaborador
```
Expected: dados restritos aos domínios concedidos; lista de domínios reduzida.

**Step 4:** Commit.
```bash
git add src/app/api server.js
git commit -m "feat(acessos): filtro de domínio por colaborador nas rotas de dados"
```

---

## Task 7: Rotas `/api/acessos/*` (CRUD + auditoria) — admin only

**Files:**
- Modify: `server.js` (novo bloco de rotas, após as rotas de auth)

**Step 1:** Adicionar bloco de rotas. Todas com `requireAuth, requireAdmin`. Usa `hashPassword`, `invalidatePermsCache`, `PERMS.sanitizePermissions`.
```js
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
    .from('usuarios').select('id,nome,email,perfil,ativo,ultimo_acesso').order('id');
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
```

**Step 2:** Verificar (admin logado): listar, criar colaborador de teste, conferir log.
```bash
curl -s -b cookies.txt localhost:3000/api/acessos | head -c 300
curl -s -b cookies.txt -X POST localhost:3000/api/acessos -H "Content-Type: application/json" \
  -d '{"nome":"Teste Colab","email":"colab@teste.com","senha":"123456","perfil":"colaborador","permissoes":{"telas":{"overview":"view","campaigns":"edit"},"dominios":{"todos":false,"ids":[]},"elementos":{"ver_tokens":false,"ver_pais":false}}}'
curl -s -b cookies.txt localhost:3000/api/acessos/log | head -c 300
```
Expected: lista com usuários; criação retorna o novo usuário; log mostra ação `criar`.

**Step 3:** Commit.
```bash
git add server.js
git commit -m "feat(acessos): rotas CRUD de acessos + auditoria (admin only)"
```

---

## Task 8: Migração do usuário `restrito` → colaborador

**Files:**
- Create: `scripts/migrate-restrito-to-colaborador.js`

**Step 1:** Escrever o script de migração de dados.
```js
// scripts/migrate-restrito-to-colaborador.js
'use strict';
const supabase = require('../src/lib/supabase');
(async () => {
  const perms = {
    telas: { overview: 'view', campaigns: 'view' },
    dominios: { todos: true, ids: [] },
    elementos: { ver_tokens: false, ver_pais: false, criar_campanha: false, expandir_conjuntos: false, coluna_acoes: false },
  };
  const { data, error } = await supabase.from('usuarios')
    .update({ perfil: 'colaborador', permissoes: perms })
    .eq('perfil', 'restrito').select('id,email');
  console.log(error ? `ERRO: ${error.message}` : `migrados: ${(data||[]).map(u=>u.email).join(', ') || 'nenhum'}`);
})();
```

**Step 2:** Rodar.
```bash
$env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/migrate-restrito-to-colaborador.js
```
Expected: `migrados: thejoker...` (ou `nenhum` se já não existir).

**Step 3:** Validar o colaborador de ponta a ponta (login como thejoker/teste e checar 403/200):
```bash
curl -s -c colab.txt -X POST localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"colab@teste.com","password":"123456"}'
curl -s -b colab.txt -o /dev/null -w "%{http_code}\n" localhost:3000/api/overview   # 200
curl -s -b colab.txt -o /dev/null -w "%{http_code}\n" localhost:3000/api/contas      # 403
curl -s -b colab.txt -o /dev/null -w "%{http_code}\n" localhost:3000/api/paises      # 403
```
Expected: 200, 403, 403.

**Step 4:** Commit.
```bash
git add scripts/migrate-restrito-to-colaborador.js
git commit -m "chore(acessos): migra perfil restrito legado para colaborador"
```

---

## Task 9: Frontend — generalizar gating em `dashboard.html`

**Files:**
- Modify: `public/dashboard.html` (`loadPerfil`, `applyPerfilGating`, usos de `IS_RESTRITO`)

**Step 1:** Substituir `IS_RESTRITO` por um objeto de permissões. Em `loadPerfil()` (linha ~2512), carregar `permissoes` de `/api/auth/me`:
```js
let PERMS = { admin: true };
function isAdminUI(){ return PERMS && PERMS.admin === true; }
function hasScreen(key, action){ if(isAdminUI())return true; const v=PERMS.telas?.[key]; if(!v)return false; return action==='edit'? v==='edit' : true; }
function elBlocked(key){ if(isAdminUI())return false; return PERMS.elementos?.[key]===false; }
async function loadPerfil(){
  try{ const r=await fetch('/api/auth/me'); if(r.ok){ const u=await r.json(); PERMS=u.permissoes||{admin:true}; } }catch(_){}
  applyPerfilGating();
}
```

**Step 2:** Reescrever `applyPerfilGating()` (linha ~2519) para iterar telas/elementos:
```js
function applyPerfilGating(){
  if(isAdminUI()){ document.getElementById('nav-acessos')?.style && (document.getElementById('nav-acessos').style.display=''); return; }
  // esconder botões de nav cujas telas não estão concedidas
  const map = { overview:'overview', campaigns:'campaigns', 'analise-paises':'analise-paises', gam:'gam', funil:'funil', otimizacoes:'otimizacoes', ai:'ai', relatorios:'relatorios', contas:'contas', diretorio:'diretorio', domains:'domains' };
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    const m = (btn.getAttribute('onclick')||'').match(/nav\('([^']+)'/); if(!m) return;
    const key = m[1]; if(key==='acessos') return;
    if(map[key] && !hasScreen(map[key])) btn.style.display='none';
  });
  document.getElementById('nav-acessos')?.style && (document.getElementById('nav-acessos').style.display='none');
  // elementos
  if(elBlocked('criar_campanha')) document.querySelectorAll('[data-el="criar_campanha"]').forEach(e=>e.style.display='none');
  if(elBlocked('coluna_acoes')) document.querySelectorAll('.col-acoes').forEach(e=>e.style.display='none');
  // país/conjuntos: usados inline via elBlocked('ver_pais')/elBlocked('expandir_conjuntos')
}
```

**Step 3:** Trocar os usos pontuais de `IS_RESTRITO` (linhas ~3476, 4800, 4804, 4932, 5016) pelos novos helpers: `IS_RESTRITO` → `elBlocked('ver_pais')` (para país) e `elBlocked('expandir_conjuntos')` (para o botão ▶), e early-returns por `!hasScreen(...)`. Ler cada ocorrência e mapear ao helper certo.

**Step 4:** Verificar visualmente (admin não deve perder nada).
```bash
node scripts/_shot.js   # ou o script de screenshot do projeto; conferir dashboard intacto p/ admin
```
Expected: dashboard do admin idêntico ao atual.

**Step 5:** Commit.
```bash
git add public/dashboard.html
git commit -m "feat(acessos): gating de UI dirigido por permissões (substitui IS_RESTRITO)"
```

---

## Task 10: Frontend — tela "Acessos" (lista + modal + auditoria)

**Files:**
- Modify: `public/dashboard.html` (novo botão de nav `nav-acessos`, nova `<section>` `view-acessos`, JS da tela)

**Step 1:** Adicionar botão na sidebar (após Diretório, ~linha 1245), visível só p/ admin:
```html
<button class="nav-btn" id="nav-acessos" onclick="nav('acessos',this)" style="display:none">
  <span class="nav-ind"></span><span class="nav-lbl">Acessos</span>
</button>
```

**Step 2:** Adicionar a `<section id="view-acessos">` com: tabela de usuários (colunas Nome, Email, Perfil, **Último acesso** formatado, Ativo, Ações), botão "Novo acesso", modal de criar/editar (campos + checkboxes de telas com seletor ver/editar, seletor de domínios, checkboxes de elementos — renderizados de `/api/acessos/catalogo`), e uma sub-aba "Histórico" listando `/api/acessos/log`.

**Step 3:** Adicionar o JS:
```js
function fmtUltimoAcesso(iso){
  if(!iso) return 'nunca acessou';
  const d=new Date(iso), now=Date.now(), diff=(now-d.getTime())/1000;
  if(diff<3600) return `há ${Math.max(1,Math.floor(diff/60))} min`;
  if(diff<86400) return `há ${Math.floor(diff/3600)}h`;
  return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
}
let _catalogo=null;
async function loadAcessos(){
  if(!_catalogo){ _catalogo=await (await fetch('/api/acessos/catalogo')).json(); }
  const users=await (await fetch('/api/acessos')).json();
  renderAcessosTable(users); // monta linhas com fmtUltimoAcesso(u.ultimo_acesso)
}
// renderAcessosModal: monta checkboxes a partir de _catalogo.screens / .elements / .dominios
// salvar: POST/PUT /api/acessos com {nome,email,senha?,perfil,permissoes}
// resetar senha: POST /api/acessos/:id/senha ; toggle ativo: PUT {ativo}; excluir: DELETE
async function loadAcessosLog(){ const log=await (await fetch('/api/acessos/log')).json(); renderAcessosLog(log); }
```
Ligar `nav('acessos')` para chamar `loadAcessos()`.

**Step 4:** Verificar via screenshot (admin):
```bash
node scripts/_shot.js   # navegar à aba Acessos e validar tabela + modal
```
Expected: tabela lista usuários com "Último acesso"; modal cria/edita; histórico aparece.

**Step 5:** Commit.
```bash
git add public/dashboard.html
git commit -m "feat(acessos): tela de gestão de acessos (lista, modal granular, auditoria, último acesso)"
```

---

## Task 11: Frontend mobile — gating análogo

**Files:**
- Modify: `public/mobile.html` (`applyPerfilMobile` / boot)

**Step 1:** No boot do mobile, carregar `permissoes` de `/api/auth/me` e esconder abas não concedidas (reusar lógica simples: esconder Países/Reports/etc. conforme `telas`). Sem tela de Acessos no mobile (gestão só no desktop).

**Step 2:** Verificar com UA mobile (screenshot mobile, se houver script).

**Step 3:** Commit.
```bash
git add public/mobile.html
git commit -m "feat(acessos): gating mobile dirigido por permissões"
```

---

## Task 12: Regressão final + limpeza

**Files:** nenhum (validação).

**Step 1:** Rodar todos os scripts de checagem:
```bash
node scripts/check-permissions-catalog.js
$env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/check-acessos-schema.js
```
Expected: tudo passa.

**Step 2:** Matriz manual admin vs colaborador (200/403) nas rotas-chave (overview, dashboard, contas, paises, otimizacoes, acessos). Conferir filtro de domínio.

**Step 3:** Remover arquivos temporários (`cookies.txt`, `colab.txt`).

**Step 4:** Confirmar que `RESTRITO_ALLOW` e usos de `IS_RESTRITO` não restaram:
```bash
grep -rn "RESTRITO_ALLOW\|IS_RESTRITO\|'restrito'\|\"restrito\"" server.js public/dashboard.html public/mobile.html
```
Expected: sem ocorrências (ou só comentários explicativos).

**Step 5:** Commit final + push e abrir PR (se desejado).
```bash
git add -A && git commit -m "test(acessos): regressão final + limpeza de restrito legado"
```

---

## Riscos / notas para o executor
- **Mapeamento rota→tela** precisa cobrir 100% de `server.js`; rota nova esquecida → 403 para colaboradores (falha segura). Ao adicionar rotas no futuro, atualizar `ROUTES` em `permissions.js`.
- **dashboard.html** é um monólito ~500KB: ler o trecho exato antes de cada edição; não reescrever em bloco.
- **Filtro de domínio**: só aplica onde a tabela tem `dominio_id`. Rotas país/otimizações herdam o gate de tela; o escopo por domínio cobre overview/dashboard/reports/intraday/lista de domínios.
- **DDL manual no Supabase** (Task 1) precisa ser feito antes de subir o código que lê `permissoes`/`acessos_log`.
- **PowerShell 5.1**: evitar redirecionar saída para arquivo (vira UTF-16); usar Node para manipular arquivos.

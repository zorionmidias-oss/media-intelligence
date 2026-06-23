# Gestão de Acessos (RBAC granular) — Design

**Data:** 2026-06-22
**Status:** Aprovado (design)
**Autor:** kpmar + Claude

## Objetivo

Criar uma tela de administração onde o admin possa **criar usuários**, definir **nível de acesso** e, para colaboradores, **escolher granularmente** o que cada um vê e pode editar — por **tela**, **ação (ver/editar)**, **domínio** e **elemento de UI**. Listar e editar acessos existentes, com **auditoria** das mudanças. Prioridade: **segurança sem risco de vazamento** (especialmente os tokens da Meta).

## Decisões de arquitetura (fixadas)

- **Mantém o auth atual** (JWT + bcrypt, cookie httpOnly `auth_token`, tabela `usuarios`). NÃO migra para Supabase Auth.
  - Motivo: migrar reescreveria login/sessão/~80 rotas — risco de abrir buraco no que já é seguro. Além disso, o backend usa a **service-role key** do Supabase, que **ignora RLS**; logo "Supabase Auth + RLS" não traria proteção real sem re-arquitetar todo o acesso a dados.
- **A segurança real é no servidor (deny-by-default).** Esconder no front é só cosmético/usabilidade — burlável via DevTools. Quem recusa o acesso é o porteiro no servidor.
- **Modelo: Abordagem A** — catálogo central de permissões (código) + uma coluna JSONB por usuário + um middleware único de enforcement.
- **Sem** tabelas relacionais de permissões, **sem** roles reutilizáveis entre usuários. **Com** auditoria.

## Modelo de dados

### Tabela `usuarios` (existente)
- `perfil` passa a aceitar: `admin` | `colaborador`.
  - O valor legado `restrito` é convertido para `colaborador` (com `permissoes` equivalentes) na migração. Tokens JWT antigos sem `perfil` continuam tratados como `admin` (comportamento atual preservado).
- Nova coluna **`permissoes` JSONB** (nullable; usada só por `colaborador`):

```json
{
  "telas":     { "overview": "view", "campaigns": "edit" },
  "dominios":  { "todos": false, "ids": [12, 34] },
  "elementos": { "ver_tokens": false, "ver_pais": false, "criar_campanha": false }
}
```

- `telas[chave]` = `"view"` (só leitura) | `"edit"` (leitura + escrita). Ausência da chave = sem acesso à tela.
- `dominios.todos = true` → todos os domínios; senão, restrito a `dominios.ids` (IDs de `dominios`). Lista vazia + `todos:false` = nenhum dado.
- `elementos[chave] = false` → elemento bloqueado. Ausência = liberado (default permissivo *dentro* de uma tela já concedida; o bloqueio forte é por tela/ação).

### Tabela nova `acessos_log` (auditoria)
Colunas: `id` (pk), `ator_id` (fk usuarios — quem fez), `ator_nome` (snapshot textual), `acao` (`criar` | `editar` | `resetar_senha` | `ativar` | `desativar` | `excluir`), `alvo_id` (fk usuarios — quem sofreu), `alvo_nome` (snapshot), `antes` (jsonb, snapshot de `{perfil,permissoes,ativo}` antes), `depois` (jsonb, snapshot depois), `criado_em` (timestamptz default now()). Senhas **nunca** entram no log.

DDL entregue como arquivo SQL (`scripts/sql/add-gestao-acessos.sql`) para rodar manualmente no SQL Editor do Supabase (sem connection string PG no ambiente; supabase-js não roda DDL).

## Componente 1 — Catálogo central (`src/lib/permissions.js`)

Fonte única de verdade. Declara:

- **TELAS**: cada tela com `{ key, label, rotas: [ {method, path|pattern, mode:'read'|'write'} ], elementosDisponiveis: [...] }`.
  - Telas (chaves alinhadas ao `nav('<key>')` do dashboard): `overview`, `campaigns`, `analise-paises`, `gam`, `funil`, `otimizacoes`, `ai`, `relatorios`, `contas`, `diretorio`, `domains`, `metas`, `acessos` (nova, sempre admin-only).
  - O mapeamento rota→tela cobre **todas** as rotas atuais de `server.js`. Rotas de auth (`/api/auth/*`), `/health`, `/privacidade` ficam fora do gate (públicas/sempre permitidas ao autenticado).
- **ELEMENTOS**: catálogo de chaves com `{ key, label, telaDona, enforceServer?: fn }`. Exemplos: `ver_tokens` (remove `access_token` de `/api/contas`), `ver_pais` (remove sigla/país das respostas), `criar_campanha`, `expandir_conjuntos`, `coluna_acoes`, `editar_excluir_conta`.

Helpers exportados:
- `can(user, screenKey, action)` → bool.
- `screenForRoute(method, path)` → screenKey | null.
- `allowedDomainIds(user)` → `null` (todos) | `number[]`.
- `elementBlocked(user, elementKey)` → bool.
- `resolvePermissions(user)` → objeto enviado ao frontend via `/api/auth/me`.
- `catalogForUI()` → estrutura de telas/elementos/ações para renderizar os checkboxes da tela de Acessos.

## Componente 2 — Porteiro (middleware único em `server.js`)

Substitui o bloco `RESTRITO_ALLOW`. Para cada request `/api/*` (exceto `/api/auth/*`):
1. admin → `next()`.
2. colaborador:
   - `screen = screenForRoute(method, path)`. Se `null` → **403** (rota não catalogada = trancada).
   - Se não tem a tela → **403**.
   - Se a rota é `write` e a permissão da tela é só `view` → **403**.
   - Injeta `req.allowedDominios = allowedDomainIds(user)` e `req.userPerms`.
3. **Filtro de domínio** nas rotas de dados: quando `req.allowedDominios` não é `null`, a rota filtra os resultados a esses IDs; se o request pede um `domain` fora do conjunto → **403**.
4. **Sanitização de elementos** na resposta: um wrapper/pós-processamento remove campos sensíveis conforme `elementBlocked` (tokens, país/sigla) antes de enviar. Reaproveita a lógica que hoje já remove país para `restrito`.

Defesa em profundidade: `requireAdmin` continua nas rotas mais sensíveis (país/conjuntos/drilldown/acessos), redundante com o porteiro.

## Componente 3 — Rotas da tela de Acessos (admin-only)

Todas exigem `requireAuth` + `requireAdmin` + estão no catálogo como tela `acessos` (write).

- `GET  /api/acessos` — lista usuários (`id, nome, email, perfil, ativo, ultimo_acesso`). **Nunca** retorna `senha_hash`.
- `GET  /api/acessos/catalogo` — retorna `catalogForUI()` (telas, ações, elementos, + lista de domínios para o seletor).
- `POST /api/acessos` — cria usuário `{nome, email, senha, perfil, permissoes}`. Hash bcrypt. Valida email único, perfil válido, permissões batem com o catálogo (rejeita chaves desconhecidas).
- `PUT  /api/acessos/:id` — edita `{nome, email, perfil, permissoes, ativo}`.
- `POST /api/acessos/:id/senha` — reset de senha.
- `DELETE /api/acessos/:id` — exclui.
- `GET  /api/acessos/log` — auditoria paginada.

**Invariantes de proteção:**
- Sempre deve restar ≥1 admin **ativo** (bloqueia rebaixar/desativar/excluir o último admin).
- Admin não pode rebaixar a si mesmo, desativar-se nem excluir a própria conta.
- Toda mutação grava em `acessos_log` (com snapshot antes/depois, sem senhas).
- Validação server-side de `permissoes` contra o catálogo (defesa contra payload forjado).

## Componente 4 — Frontend

### `/api/auth/me`
Passa a incluir `permissoes` resolvidas (`resolvePermissions`) além de `perfil`.

### `dashboard.html`
- `applyPerfilGating()` é generalizado: lê o JSON de permissões e esconde telas (botões da sidebar) e elementos não concedidos. Substitui o `IS_RESTRITO` fixo por um objeto `PERMS` + helpers (`hasScreen`, `canEdit`, `elBlocked`).
- Nova aba **"Acessos"** na sidebar, visível só para admin: tabela de usuários + modal de criar/editar (checkboxes de telas com seletor ver/editar, seletor de domínios, checkboxes de elementos — tudo renderizado de `/api/acessos/catalogo`) + aba de histórico (auditoria).
- Reforço: o gating de front é só usabilidade; segurança é o porteiro.

### `mobile.html`
`applyPerfilMobile()` generalizado de forma análoga (esconde abas conforme telas concedidas). Escopo mínimo: reaproveita o mesmo `/api/auth/me`.

## Migração / compatibilidade

1. SQL: adiciona coluna `permissoes` jsonb; cria tabela `acessos_log`; (opcional) `CHECK` em `perfil`.
2. Converte o usuário `restrito` existente (`thejoker`) para `colaborador` com `permissoes` espelhando o comportamento atual (Overview view + Campanhas view; sem país/tokens/conjuntos).
3. Usuários `admin` atuais permanecem `admin`.
4. O literal `'restrito'` no código é removido em favor do modelo novo; o porteiro novo cobre o mesmo caso (e mais).

## Segurança — resumo

- Deny-by-default no servidor; rotas novas nascem trancadas.
- Tokens Meta e país removidos no backend (não só escondidos no front).
- Filtro de domínio enforced no servidor.
- bcrypt mantido; `senha_hash` nunca trafega para o cliente.
- Validação de payload de permissões contra catálogo.
- Auditoria de todas as mutações.
- Invariante de "sempre ≥1 admin" e auto-proteção do admin logado.

## Fora de escopo (YAGNI)

- Supabase Auth / GoTrue.
- Tabelas relacionais de permissões; roles compartilhados entre usuários.
- 2FA, expiração de senha, política de complexidade (pode vir depois).
- RLS no Postgres (sem efeito com service-role key).

## Riscos / pontos de atenção

- **Mapeamento rota→tela** precisa cobrir 100% das rotas de `server.js`; uma rota esquecida fica 403 para colaboradores (falha segura, mas pode quebrar uma tela concedida) — validar com varredura das rotas na implementação.
- **Filtro por domínio** exige tocar cada rota de dados; começar pelas que já aceitam `domain` (overview/dashboard/reports) e cobrir as demais.
- DDL manual no Supabase (entregar SQL pronto e testar a coluna antes do deploy).

-- Gestão de Acessos (RBAC granular) — migração
-- Rodar no projeto do dashboard (ref vhqjkpspjpfewanlomwu).
-- Aplicar via: supabase db query --db-url "$DATABASE_URL" -f scripts/sql/add-gestao-acessos.sql

-- 1) Coluna de permissões granulares por usuário (usada só por colaboradores)
alter table usuarios add column if not exists permissoes jsonb;

-- perfil passa a aceitar admin|colaborador (sem CHECK rígido p/ não quebrar linhas legadas;
-- a validação de perfil é feita na aplicação).

-- 2) Auditoria de mudanças de acesso
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

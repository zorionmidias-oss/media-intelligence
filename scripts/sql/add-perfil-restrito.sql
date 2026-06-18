-- Acesso restrito (Overview + Campanhas, sem país/sigla/conjuntos)
-- Rodar UMA vez no Supabase → SQL Editor ANTES do deploy do código de perfil.
-- A coluna tem default 'admin', então o admin atual continua funcionando.

-- 1) Coluna de perfil
alter table usuarios add column if not exists perfil text not null default 'admin';

-- 2) Usuário restrito (login: thejoker). Senha definida fora deste arquivo;
--    senha_hash abaixo é o bcrypt correspondente (gerado em 18/06/2026).
insert into usuarios (email, senha_hash, nome, ativo, perfil)
values (
  'thejoker',
  '$2b$10$/8LD9BkexjObepY8A9pNA.JhUK1Bh6wIiWHa.8Ars45.n1.Htfjxe',
  'The Joker',
  true,
  'restrito'
);

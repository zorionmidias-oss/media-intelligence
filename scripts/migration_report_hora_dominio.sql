-- ══════════════════════════════════════════════════════════════
-- migration_report_hora_dominio.sql
-- Rodar no Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════
--
-- PROBLEMA: O índice uq_report_hora (data, hora, prefixo_ad_unit) sobreviveu
-- à migration_gam_cache_v2.sql porque aquela tentou dropar o nome
-- auto-gerado "report_hora_data_hora_prefixo_ad_unit_key", mas o índice
-- real tem nome manual "uq_report_hora".
--
-- EFEITO: saveToCache para qualquer domínio específico (dominio_id > 0)
-- falha silenciosamente com violação de uq_report_hora, porque o syncAll
-- já ocupou (data, hora, 'mku_') com dominio_id=0. Resultado: report_hora
-- para domínios específicos nunca é cacheado → Report Hora fica vazio na
-- segunda carga com domínio selecionado.
--
-- FIX:
--   1. Remove o índice antigo que bloqueia o saveToCache por domínio.
--   2. Alinha as linhas existentes com o novo esquema:
--      dominio_id=0 = global → prefixo_ad_unit deve ser '' (não 'mku_').
-- ══════════════════════════════════════════════════════════════

-- 1. Remove o índice antigo (prefixo como discriminador)
--    O substituto já existe: report_hora_data_hora_dominio_id_key (data, hora, dominio_id)
DROP INDEX IF EXISTS uq_report_hora;

-- 2. Alinha linhas globais existentes: prefixo vazio para dominio_id=0
UPDATE report_hora
SET prefixo_ad_unit = ''
WHERE dominio_id = 0
  AND prefixo_ad_unit <> '';

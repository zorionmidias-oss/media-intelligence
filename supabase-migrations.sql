-- ══════════════════════════════════════════════════
-- MIGRATIONS — Bugs 1, 3, 5
-- Rodar no Supabase SQL Editor
-- ══════════════════════════════════════════════════

-- BUG 1: Suporte a contas USD + rastreamento de taxa
ALTER TABLE meta_accounts
  ADD COLUMN IF NOT EXISTS moeda TEXT DEFAULT 'BRL';

ALTER TABLE ads_consolidados
  ADD COLUMN IF NOT EXISTS moeda_original TEXT DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS taxa_usd_aplicada DECIMAL(8,4) DEFAULT 1;

-- Marcar a conta aishafb como USD
UPDATE meta_accounts
SET moeda = 'USD'
WHERE ad_account_id = 'act_836584462796120';

-- BUG 3: Prefixo de ad_unit por domínio (para filtro GAM)
ALTER TABLE dominios
  ADD COLUMN IF NOT EXISTS prefixo_ad_unit TEXT;

-- Ajuste os valores abaixo conforme os prefixos reais dos seus ad_units no GAM
-- (verifique em Ad Manager > Inventário > Blocos de anúncios)
UPDATE dominios SET prefixo_ad_unit = 'mku_' WHERE nome ILIKE '%mkuker%';
UPDATE dominios SET prefixo_ad_unit = 'eur_' WHERE nome ILIKE '%euro%';

-- BUG 5: Tabela de taxas de câmbio históricas
CREATE TABLE IF NOT EXISTS taxas_cambio (
  data       DATE        PRIMARY KEY,
  taxa       DECIMAL(8,4) NOT NULL,
  fonte      TEXT        DEFAULT 'exchangerate-api',
  created_at TIMESTAMP   DEFAULT NOW()
);

-- Inserir taxa do dia 16/05/2026 (usada na validação)
-- Se a taxa real do dia for diferente, ajuste o valor
INSERT INTO taxas_cambio (data, taxa, fonte)
VALUES ('2026-05-16', 6.06, 'manual')
ON CONFLICT (data) DO NOTHING;

-- ── Páginas: coluna de adsets ativos ──────────────────────────────────────
ALTER TABLE paginas ADD COLUMN IF NOT EXISTS adsets_ativos INTEGER DEFAULT 0;

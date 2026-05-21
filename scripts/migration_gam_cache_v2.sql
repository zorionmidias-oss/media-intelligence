-- ══════════════════════════════════════════════════════════════
-- migration_gam_cache_v2.sql
-- Rodar no Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ── BUG 1: dominio_id nas tabelas de cache GAM ────────────────
-- Garante filtro correto por domínio sem depender de prefixo textual.
-- dominio_id = 0 → global (sem filtro de domínio)

ALTER TABLE report_hora
  ADD COLUMN IF NOT EXISTS dominio_id INT NOT NULL DEFAULT 0;

-- Troca o UNIQUE antigo (data, hora, prefixo_ad_unit) pelo novo (data, hora, dominio_id)
ALTER TABLE report_hora
  DROP CONSTRAINT IF EXISTS report_hora_data_hora_prefixo_ad_unit_key;
ALTER TABLE report_hora
  DROP CONSTRAINT IF EXISTS report_hora_data_hora_dominio_id_key;
ALTER TABLE report_hora
  ADD CONSTRAINT report_hora_data_hora_dominio_id_key
    UNIQUE (data, hora, dominio_id);

CREATE INDEX IF NOT EXISTS idx_report_hora_dominio
  ON report_hora(dominio_id, data);


ALTER TABLE report_utm_campaign
  ADD COLUMN IF NOT EXISTS dominio_id INT NOT NULL DEFAULT 0;

ALTER TABLE report_utm_campaign
  DROP CONSTRAINT IF EXISTS report_utm_campaign_data_utm_campaign_prefixo_ad_unit_key;
ALTER TABLE report_utm_campaign
  DROP CONSTRAINT IF EXISTS report_utm_campaign_data_utm_campaign_dominio_id_key;
ALTER TABLE report_utm_campaign
  ADD CONSTRAINT report_utm_campaign_data_utm_campaign_dominio_id_key
    UNIQUE (data, utm_campaign, dominio_id);

CREATE INDEX IF NOT EXISTS idx_report_utm_dominio
  ON report_utm_campaign(dominio_id, data);


-- ── BUG 3: bloquear sync automático em datas corrigidas manualmente ──
ALTER TABLE ads_consolidados
  ADD COLUMN IF NOT EXISTS manually_fixed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ads_manually_fixed
  ON ads_consolidados(data) WHERE manually_fixed = TRUE;


-- ── CACHE KPI (opcional) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS gam_kpi_diario (
  id          SERIAL PRIMARY KEY,
  data        DATE          NOT NULL,
  dominio_id  INT           NOT NULL DEFAULT 0,
  impressoes  BIGINT        DEFAULT 0,
  receita     DECIMAL(12,2) DEFAULT 0,
  ecpm        DECIMAL(10,2) DEFAULT 0,
  rps         DECIMAL(10,4) DEFAULT 0,
  pmr         DECIMAL(5,2)  DEFAULT 0,
  viewability DECIMAL(5,2)  DEFAULT 0,
  cpc         DECIMAL(10,4) DEFAULT 0,
  ctr         DECIMAL(5,2)  DEFAULT 0,
  cliques     INT           DEFAULT 0,
  updated_at  TIMESTAMP     DEFAULT NOW(),
  UNIQUE(data, dominio_id)
);

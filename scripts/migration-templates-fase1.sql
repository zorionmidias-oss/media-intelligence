-- Fase 1: Sistema de Templates de Campanha
-- Roda: DROP + RECREATE campaign_templates (JSONB schema) + meta_resources_cache

-- ── 1. campaign_templates ─────────────────────────────────────────────────────

DROP TABLE IF EXISTS campaign_templates CASCADE;

CREATE TABLE campaign_templates (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,

  -- Tipo e contexto
  tipo TEXT NOT NULL CHECK (tipo IN ('bot', 'direto', 'conversao')),
  account_id TEXT NOT NULL,
  dominio_id INT REFERENCES dominios(id) ON DELETE SET NULL,

  -- Campanha (nível 1)
  campanha_config JSONB NOT NULL DEFAULT '{}',
  -- { objective, buying_type, special_ad_categories, budget_mode,
  --   cbo_daily_budget, bid_strategy, status_inicial, agendar_meia_noite }

  -- Conjunto (nível 2)
  conjunto_config JSONB NOT NULL DEFAULT '{}',
  -- { destination_type, messenger_destination, page_id, pixel_id, custom_event_type,
  --   optimization_goal, billing_event, abo_daily_budget, bid_amount, attribution_setting,
  --   targeting { geo_locations, age_min, age_max, genders, locales, flexible_spec,
  --               exclusions, custom_audiences, excluded_custom_audiences },
  --   placements { automatic, facebook_positions, instagram_positions, ... } }

  -- Anúncio + Criativo (nível 3+4)
  criativo_config JSONB NOT NULL DEFAULT '{}',
  -- { page_id, primary_text, headline, description, call_to_action_type,
  --   link_destino_padrao, image_hash, video_id, welcome_message_template,
  --   ice_breakers }

  -- Padrões de nomenclatura com {{vars}}
  patterns JSONB NOT NULL DEFAULT '{}',
  -- { campaign_name, adset_name, ad_name, utm_url }

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  ultima_uso  TIMESTAMPTZ,
  total_usos  INT DEFAULT 0,

  CONSTRAINT campaign_templates_nome_unique UNIQUE (nome)
);

CREATE INDEX IF NOT EXISTS idx_templates_tipo    ON campaign_templates(tipo);
CREATE INDEX IF NOT EXISTS idx_templates_account ON campaign_templates(account_id);

-- ── 2. meta_resources_cache ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS meta_resources_cache (
  id            SERIAL PRIMARY KEY,
  account_id    TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  query_hash    TEXT NOT NULL DEFAULT '',
  data          JSONB NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT meta_cache_unique UNIQUE (account_id, resource_type, query_hash)
);

CREATE INDEX IF NOT EXISTS idx_meta_cache
  ON meta_resources_cache(account_id, resource_type, expires_at);

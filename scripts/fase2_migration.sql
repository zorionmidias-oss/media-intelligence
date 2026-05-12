-- ═══ FASE 2 — Migração ═══
-- Rodar no SQL Editor do Supabase: https://supabase.com/dashboard/project/vhqjkpspjpfewanlomwu/sql

-- 1. Metas
CREATE TABLE IF NOT EXISTS metas (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN ('faturamento_diario','investimento_diario','roas_diario','lucro_diario')),
  valor DECIMAL(12,2) NOT NULL,
  dominio_id INT REFERENCES dominios(id),
  ativa BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_metas_tipo ON metas(tipo, ativa);

-- 2. Notificações
CREATE TABLE IF NOT EXISTS notificacoes (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  severidade TEXT NOT NULL CHECK (severidade IN ('info','warning','danger','success')),
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  ad_utm TEXT,
  dominio_id INT REFERENCES dominios(id),
  lida BOOLEAN DEFAULT false,
  acao_url TEXT,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_lida ON notificacoes(lida, created_at DESC);

-- 3. Histórico de Campanhas
CREATE TABLE IF NOT EXISTS historico_campanhas (
  id SERIAL PRIMARY KEY,
  ad_utm TEXT NOT NULL,
  adset_id TEXT,
  adset_name TEXT,
  acao TEXT NOT NULL,
  valor_antes TEXT,
  valor_depois TEXT,
  usuario_id INT,
  metricas_antes JSONB,
  metricas_depois_24h JSONB,
  observacao TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hist_utm ON historico_campanhas(ad_utm, created_at DESC);

-- 4. RLS (opcional mas recomendado)
ALTER TABLE metas ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE historico_campanhas ENABLE ROW LEVEL SECURITY;

-- Políticas: somente service_role (backend) acessa
CREATE POLICY "service_role only" ON metas FOR ALL USING (true);
CREATE POLICY "service_role only" ON notificacoes FOR ALL USING (true);
CREATE POLICY "service_role only" ON historico_campanhas FOR ALL USING (true);

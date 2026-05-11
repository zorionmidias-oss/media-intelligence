CREATE TABLE IF NOT EXISTS dominios (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL UNIQUE,
  prefixo_campanha TEXT NOT NULL UNIQUE,
  codigo_pedido_gam TEXT,
  ativo BOOLEAN DEFAULT true,
  detectado_automaticamente BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ads_consolidados (
  id SERIAL PRIMARY KEY,
  data DATE NOT NULL,
  dominio_id INT REFERENCES dominios(id),
  ad_utm TEXT NOT NULL,
  campanha_meta TEXT,
  conjunto_meta TEXT,
  tipo TEXT CHECK (tipo IN ('bot', 'direto')) DEFAULT 'bot',
  objetivo TEXT,
  valor_gasto DECIMAL(10,2) DEFAULT 0,
  custo_resultado DECIMAL(10,2) DEFAULT 0,
  resultado INT DEFAULT 0,
  cpc DECIMAL(10,4) DEFAULT 0,
  ctr DECIMAL(5,2) DEFAULT 0,
  cliques INT DEFAULT 0,
  impressoes_gam INT DEFAULT 0,
  viewability DECIMAL(5,2) DEFAULT 0,
  ecpm DECIMAL(10,2) DEFAULT 0,
  rps DECIMAL(10,4) DEFAULT 0,
  faturamento_bruto DECIMAL(10,2) DEFAULT 0,
  faturamento_real DECIMAL(10,2) DEFAULT 0,
  lucro DECIMAL(10,2) DEFAULT 0,
  roas DECIMAL(10,4) DEFAULT 0,
  orcamento_total DECIMAL(10,2) DEFAULT 0,
  previsao_impressoes INT DEFAULT 0,
  previsao_faturamento DECIMAL(10,2) DEFAULT 0,
  previsao_faturamento_real DECIMAL(10,2) DEFAULT 0,
  previsao_lucro DECIMAL(10,2) DEFAULT 0,
  previsao_roas DECIMAL(10,4) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(data, dominio_id, ad_utm)
);

CREATE TABLE IF NOT EXISTS blocos_anuncio (
  id SERIAL PRIMARY KEY,
  data DATE NOT NULL,
  dominio_id INT REFERENCES dominios(id),
  nome_bloco TEXT NOT NULL,
  impressoes INT DEFAULT 0,
  total_clicks INT DEFAULT 0,
  receita_total DECIMAL(10,2) DEFAULT 0,
  ecpm_medio DECIMAL(10,2) DEFAULT 0,
  taxa_correspondencia_programatica DECIMAL(5,2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(data, dominio_id, nome_bloco)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  rows_processed INT DEFAULT 0,
  duration_ms INT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dominios_pendentes (
  id SERIAL PRIMARY KEY,
  prefixo_detectado TEXT NOT NULL UNIQUE,
  exemplo_nome_campanha TEXT,
  primeira_deteccao TIMESTAMP DEFAULT NOW(),
  resolvido BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_ads_data ON ads_consolidados(data);
CREATE INDEX IF NOT EXISTS idx_ads_dominio ON ads_consolidados(dominio_id);
CREATE INDEX IF NOT EXISTS idx_ads_utm ON ads_consolidados(ad_utm);
CREATE INDEX IF NOT EXISTS idx_blocos_data ON blocos_anuncio(data);

INSERT INTO dominios (nome, prefixo_campanha, codigo_pedido_gam)
VALUES ('mkuker.com', 'MKUKER', 'MKU-AdX'),
       ('euro.mkuker.com', 'EURO', 'EUR-AdX')
ON CONFLICT (nome) DO NOTHING;

-- ── Usuários ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  nome TEXT,
  ativo BOOLEAN DEFAULT true,
  ultimo_acesso TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ── Contas Meta (migrado do .env) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta_accounts (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  bm_id TEXT,
  ad_account_id TEXT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  currency TEXT DEFAULT 'BRL',
  ativo BOOLEAN DEFAULT true,
  ultimo_sync TIMESTAMP,
  ultimo_status TEXT,
  ultimo_erro TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

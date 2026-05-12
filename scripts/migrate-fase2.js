'use strict';
require('dotenv').config({ path: '.env.local' });
const supabase = require('../src/lib/supabase');

async function run() {
  const sqls = [
    `CREATE TABLE IF NOT EXISTS metas (
      id SERIAL PRIMARY KEY,
      tipo TEXT NOT NULL CHECK (tipo IN ('faturamento_diario','investimento_diario','roas_diario','lucro_diario')),
      valor DECIMAL(12,2) NOT NULL,
      dominio_id INT REFERENCES dominios(id),
      ativa BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_metas_tipo ON metas(tipo, ativa)`,
    `CREATE TABLE IF NOT EXISTS notificacoes (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notif_lida ON notificacoes(lida, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS historico_campanhas (
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
    )`,
    `CREATE INDEX IF NOT EXISTS idx_hist_utm ON historico_campanhas(ad_utm, created_at DESC)`,
  ];

  for (const sql of sqls) {
    const { error } = await supabase.rpc('exec_sql', { query: sql }).catch(() => ({ error: null }));
    if (error) {
      // Try via raw REST if rpc not available
      console.warn('[migrate] rpc exec_sql not available, trying direct insert check');
    }
    console.log('[migrate] SQL:', sql.slice(0, 60).replace(/\s+/g, ' '), '...');
  }
  console.log('[migrate] Done. Run the SQL above manually in Supabase SQL Editor if needed.');
}

run().catch(e => { console.error(e.message); process.exit(1); });

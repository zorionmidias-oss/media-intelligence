'use strict';
require('dotenv').config({ path: '.env.local' });
const axios = require('axios');
const bcrypt = require('bcrypt');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TABLES_SQL = `
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  nome TEXT,
  ativo BOOLEAN DEFAULT true,
  ultimo_acesso TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

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
`;

async function runSQL(sql) {
  try {
    const res = await axios.post(
      `${SUPABASE_URL}/rest/v1/rpc/execute_sql`,
      { query: sql },
      {
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    return { ok: true, data: res.data };
  } catch (e) {
    return { ok: false, error: e.response?.data || e.message };
  }
}

async function main() {
  console.log('=== Setup DB: criando tabelas ===\n');

  const result = await runSQL(TABLES_SQL);
  if (result.ok) {
    console.log('✅ Tabelas criadas via RPC execute_sql');
  } else {
    console.log('ℹ️  RPC execute_sql indisponível — execute o SQL manualmente no Supabase Dashboard:');
    console.log('\n--- SQL para copiar no Supabase SQL Editor ---');
    console.log(TABLES_SQL);
    console.log('---');
  }

  // Gerar hash real para admin123 e inserir via REST
  console.log('\n=== Inserindo usuário admin ===');
  const hash = await bcrypt.hash('admin123', 10);
  const insertSQL = `
    INSERT INTO usuarios (email, senha_hash, nome)
    VALUES ('admin@2juniors.com', '${hash}', '2Junior''s Admin')
    ON CONFLICT (email) DO NOTHING;
  `;

  const r2 = await runSQL(insertSQL);
  if (r2.ok) {
    console.log('✅ Usuário admin inserido (email: admin@2juniors.com, senha: admin123)');
  } else {
    console.log('ℹ️  Execute manualmente:');
    console.log(insertSQL);
  }

  console.log('\n=== Tabelas necessárias ===');
  console.log('Se o RPC falhou, copie o SQL acima para:');
  console.log(`${SUPABASE_URL.replace('https://', 'https://app.supabase.com/project/')}/sql`);
  console.log('\nHash gerado para admin123:', hash);
  console.log('Use este hash no INSERT de usuarios se precisar inserir manualmente.');
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });

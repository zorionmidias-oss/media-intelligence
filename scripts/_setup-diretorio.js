'use strict';
// One-off: cria a tabela diretorio_links no projeto correto (.env.local) via RPC execute_sql.
require('dotenv').config({ path: '.env.local' });
const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SQL = `
CREATE TABLE IF NOT EXISTS public.diretorio_links (
  id         bigint generated always as identity primary key,
  titulo     text not null,
  url        text not null,
  categoria  text not null default 'Link',
  descricao  text,
  ordem      int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS diretorio_links_categoria_idx ON public.diretorio_links (categoria);
NOTIFY pgrst, 'reload schema';
`;

async function runSQL(sql) {
  const res = await axios.post(
    `${SUPABASE_URL}/rest/v1/rpc/execute_sql`,
    { query: sql },
    { headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, 'Content-Type': 'application/json' }, timeout: 15000 }
  );
  return res.data;
}

(async () => {
  const ref = (SUPABASE_URL || '').replace('https://', '').split('.')[0];
  console.log('Projeto alvo:', ref);
  try {
    const data = await runSQL(SQL);
    console.log('✅ Tabela diretorio_links criada/ok via RPC execute_sql');
    console.log('Retorno:', JSON.stringify(data));
  } catch (e) {
    console.log('❌ RPC execute_sql falhou:', JSON.stringify(e.response?.data || e.message));
    console.log('\n--- Rode este SQL no SQL Editor do projeto ' + ref + ' ---\n' + SQL);
    process.exit(2);
  }
})();

'use strict';
// One-off: adiciona ao dominios o suporte a um 2º GAM (aditivo — não muda o atual).
//   gam_fonte     smallint default 1  → 1 = GAM legado (match por prefixo do AD_UNIT_NAME)
//                                       2 = GAM novo   (match por NOME EXATO do bloco filho)
//   ad_unit_filho text                → nome exato do bloco de anúncio filho (só p/ gam_fonte=2)
// Todo domínio existente continua gam_fonte=1 → comportamento inalterado.
// Aplicado via DATABASE_URL (banco do dashboard; o MCP do Supabase só vê o projeto do BOT).
require('dotenv').config({ path: '.env.local' });
const { Client } = require('pg'); // devDependency

const SQL = `
ALTER TABLE public.dominios ADD COLUMN IF NOT EXISTS gam_fonte     smallint NOT NULL DEFAULT 1;
ALTER TABLE public.dominios ADD COLUMN IF NOT EXISTS ad_unit_filho text;
NOTIFY pgrst, 'reload schema';
`;

(async () => {
  const ref = (process.env.SUPABASE_URL || '').replace('https://', '').split('.')[0];
  console.log('Projeto alvo:', ref);
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await c.connect();
    await c.query(SQL);
    console.log('✅ dominios: colunas gam_fonte + ad_unit_filho criadas/ok');
  } catch (e) {
    console.log('❌ falhou:', e.message);
    console.log('\n--- Rode este SQL no SQL Editor do projeto ' + ref + ' ---\n' + SQL);
    process.exit(2);
  } finally {
    await c.end().catch(() => {});
  }
})();

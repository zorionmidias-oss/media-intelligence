'use strict';
/*
 * Backfill de funil_conjunto (ponte trakeamento→dash).
 * Uso: $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/backfill-funil-conjunto.js [SINCE] [UNTIL]
 * Default: 2026-07-22 → hoje BR.
 */
const { syncFunilConjunto } = require('../src/lib/syncFunil');
const { hojeBR } = require('../src/lib/datas');

const since = process.argv[2] || '2026-07-22';
const until = process.argv[3] || hojeBR();

(async () => {
  console.log(`[backfill funil] ${since} → ${until}`);
  const n = await syncFunilConjunto({ since, until });
  console.log(`[backfill funil] OK — ${n} linhas conjunto×dia gravadas`);
})().catch(e => { console.error(e); process.exit(1); });

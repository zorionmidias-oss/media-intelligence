'use strict';
// Script temporário para forçar sync de uma data específica
// Uso: node run-sync.js 2026-05-16
require('dotenv').config({ path: '.env.local' });

const { syncAll } = require('./src/lib/sync');

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

console.log(`\n[run-sync] Iniciando sync para data: ${date}\n`);

syncAll({ since: date, until: date })
  .then(result => {
    console.log('\n[run-sync] CONCLUÍDO:', JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('\n[run-sync] ERRO:', err.message);
    console.error(err.stack);
    process.exit(1);
  });

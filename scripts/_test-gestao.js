const { atualizarPlanilhaGestao } = require('../src/lib/sheetsGestao');
const dry = process.argv[2] !== '--write';
atualizarPlanilhaGestao({ dryRun: dry })
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => { console.error('ERRO:', e.message); process.exit(1); });

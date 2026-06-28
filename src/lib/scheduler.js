'use strict';
const cron = require('node-cron');
const { syncAll } = require('./sync');
const { detectarAlertas, detectarConjuntosSemGasto } = require('./alertas');
const { atualizarPlanilhaGestao } = require('./sheetsGestao');

// Atualiza a planilha de gestão de páginas a cada sync (desliga com SHEET_GESTAO_SYNC=0).
function syncPlanilhaGestao() {
  if (process.env.SHEET_GESTAO_SYNC === '0') return Promise.resolve();
  return atualizarPlanilhaGestao()
    .then(r => console.log(`[sheets] planilha atualizada: ${r.paginas_casadas} casadas, ${r.paginas_zeradas} zeradas, ${r.tokens_sem_linha.length} tokens sem linha`))
    .catch(e => console.error('[sheets] atualizarPlanilhaGestao falhou:', e.message));
}

function startScheduler() {
  console.log('[scheduler] Iniciando sync inicial…');
  syncAll().catch(e => console.error('[scheduler] Sync inicial falhou:', e.message));

  // Every 30 minutes for intraday updates
  cron.schedule('*/30 * * * *', () => {
    console.log('[scheduler] Sync automático…');
    syncAll()
      .then(() => detectarAlertas())
      .then(() => detectarConjuntosSemGasto())
      .then(() => syncPlanilhaGestao())
      .catch(e => console.error('[scheduler] Sync cron falhou:', e.message));
  });

  // Every day at 06:00 — full backfill of yesterday's finalized data
  cron.schedule('0 6 * * *', () => {
    console.log('[scheduler] Sync diário 06h (backfill ontem)…');
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    syncAll({ since: yesterday, until: yesterday })
      .catch(e => console.error('[scheduler] Sync diário falhou:', e.message));
  });

  cron.schedule('*/10 * * * *', async () => {
    if (process.env.RENDER_EXTERNAL_URL) {
      try {
        await fetch(`${process.env.RENDER_EXTERNAL_URL}/health`);
        console.log('[keep-alive] ping ok');
      } catch (e) {
        console.log('[keep-alive] erro:', e.message);
      }
    }
  });

  console.log('[scheduler] Agendado: a cada 30 min + diário às 06h');
}

module.exports = { startScheduler };

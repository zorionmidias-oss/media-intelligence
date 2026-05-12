'use strict';
const cron = require('node-cron');
const { syncAll } = require('./sync');
const { detectarAlertas } = require('./alertas');

function startScheduler() {
  console.log('[scheduler] Iniciando sync inicial…');
  syncAll().catch(e => console.error('[scheduler] Sync inicial falhou:', e.message));

  // Every 30 minutes for intraday updates
  cron.schedule('*/30 * * * *', () => {
    console.log('[scheduler] Sync automático…');
    syncAll()
      .then(() => detectarAlertas())
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

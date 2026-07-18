'use strict';
const cron = require('node-cron');
const { syncAll } = require('./sync');
const { detectarAlertas, detectarConjuntosSemGasto, detectarUtmOrfao } = require('./alertas');
const { atualizarPlanilhaGestao } = require('./sheetsGestao');

// Atualiza a planilha de gestão de páginas a cada sync (desliga com SHEET_GESTAO_SYNC=0).
function syncPlanilhaGestao() {
  if (process.env.SHEET_GESTAO_SYNC === '0') return Promise.resolve();
  return atualizarPlanilhaGestao()
    .then(async r => {
      console.log(`[sheets] planilha atualizada: ${r.paginas_casadas} casadas, ${r.paginas_zeradas} zeradas, ${r.tokens_sem_linha.length} tokens sem linha`);
      // Página ativa na Meta sem linha EXATA na planilha (match é por igualdade —
      // colchete abreviado tipo [ELIANA] não casa com "ELIANA MARTINS"): notifica
      // em vez de deixar a página invisível na gestão. Dedup por token/dia.
      const hoje = new Date().toISOString().slice(0, 10);
      const supabase = require('./supabase');
      const avisos = [
        ...(r.tokens_sem_linha || []).map(t => ({
          tipo: 'pagina_sem_linha_planilha',
          titulo: `Página "${t}" ativa na Meta sem linha na planilha de gestão`,
          mensagem: 'Nenhuma linha da aba Páginas casa com esse token. Confira o nome na planilha vs o 2º colchete do conjunto.',
          token: t,
        })),
        ...(r.tokens_ambiguos || []).map(t => ({
          tipo: 'token_pagina_ambiguo',
          titulo: `Token "${t}" casa com mais de uma página na planilha`,
          mensagem: `Ex.: [${t}] não distingue páginas homônimas. Use o nome COMPLETO no 2º colchete do conjunto; as linhas afetadas ficaram zeradas com aviso.`,
          token: t,
        })),
      ];
      for (const a of avisos) {
        const { data: existing } = await supabase.from('notificacoes').select('id')
          .eq('tipo', a.tipo).eq('ad_utm', a.token)
          .gte('created_at', hoje + 'T00:00:00').limit(1);
        if (existing?.length) continue;
        await supabase.from('notificacoes').insert({
          tipo: a.tipo, severidade: 'warning', titulo: a.titulo, mensagem: a.mensagem, ad_utm: a.token,
        });
      }
    })
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
      .then(() => detectarUtmOrfao())
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

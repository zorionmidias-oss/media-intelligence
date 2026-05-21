'use strict';
const supabase = require('../../../lib/supabase');

async function handler(req, res) {
  try {
    const now = new Date();
    const sp = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const today = sp.toISOString().slice(0, 10);
    const horaAtual = sp.getHours();

    const { data: horaRow } = await supabase
      .from('report_hora')
      .select('hora,updated_at')
      .eq('data', today)
      .gt('impressoes', 0)
      .order('hora', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (horaRow) {
      const ultimaHora = horaRow.hora;
      const atraso = Math.max(0, horaAtual - ultimaHora - 1);
      return res.json({
        ultima_hora_com_dados: ultimaHora,
        hora_atual: horaAtual,
        horas_atraso: atraso,
        tem_atraso: atraso > 0,
        ultima_sync: horaRow.updated_at,
        fonte: 'report_hora',
      });
    }

    const { data: blocoRow } = await supabase
      .from('blocos_anuncio')
      .select('updated_at')
      .eq('data', today)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (blocoRow?.updated_at) {
      const syncTime = new Date(blocoRow.updated_at);
      const syncSP = new Date(syncTime.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      const horaSyncSP = syncSP.getHours();
      const ultimaHoraEstimada = Math.max(0, horaSyncSP - 2);
      const atraso = Math.max(0, horaAtual - ultimaHoraEstimada - 1);
      return res.json({
        ultima_hora_com_dados: ultimaHoraEstimada,
        hora_atual: horaAtual,
        horas_atraso: atraso,
        tem_atraso: atraso > 0,
        ultima_sync: blocoRow.updated_at,
        fonte: 'blocos_anuncio',
      });
    }

    res.json({
      ultima_hora_com_dados: null,
      hora_atual: horaAtual,
      horas_atraso: 0,
      tem_atraso: false,
      ultima_sync: null,
      fonte: 'sem_dados',
    });

  } catch (err) {
    console.error('[gam-status]', err.message);
    res.status(500).json({ tem_atraso: false, horas_atraso: 0, erro: err.message });
  }
}

module.exports = handler;

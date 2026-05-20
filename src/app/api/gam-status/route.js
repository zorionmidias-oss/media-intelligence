'use strict';
const supabase = require('../../../lib/supabase');

async function handler(req, res) {
  try {
    const now = new Date();
    const sp = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const today = sp.toISOString().slice(0, 10);
    const horaAtual = sp.getHours();

    const { data } = await supabase
      .from('report_hora')
      .select('hora,updated_at')
      .eq('data', today)
      .gt('impressoes', 0)
      .order('hora', { ascending: false })
      .limit(1)
      .maybeSingle();

    const ultimaHora = data?.hora ?? null;
    const atrasoRaw = ultimaHora !== null
      ? Math.max(0, horaAtual - ultimaHora - 1)
      : horaAtual;

    res.json({
      ultima_hora_com_dados: ultimaHora,
      hora_atual: horaAtual,
      horas_atraso: atrasoRaw,
      tem_atraso: atrasoRaw > 0,
      ultima_sync: data?.updated_at || null,
    });
  } catch (err) {
    console.error('[gam-status]', err.message);
    res.status(500).json({ tem_atraso: false, horas_atraso: 0, erro: err.message });
  }
}

module.exports = handler;

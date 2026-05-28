'use strict';
const supabase = require('../../../lib/supabase');

// en-CA locale gives ISO "YYYY-MM-DD" directly — no re-parsing ambiguity
function spDateHoje() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

function spHoraAtual() {
  const s = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false });
  return parseInt(s.split(':')[0], 10) % 24;
}

function dateMinusDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

async function handler(req, res) {
  try {
    const dataHoje  = spDateHoje();
    const horaAtual = spHoraAtual();
    const dataOntem = dateMinusDays(dataHoje, 1);

    // Resolve domain filter — dominio_id=0 is the global aggregate
    let did = 0;
    const domain = req.query.domain;
    if (domain && domain !== 'all' && domain !== '0' && domain !== '') {
      const { data: d } = await supabase.from('dominios')
        .select('id')
        .eq('nome', domain).maybeSingle();
      did = d?.id ?? 0;
    }

    const buildQuery = (data) =>
      supabase.from('dados_hora')
        .select('hora,receita_bruta,receita_liquida,ecpm,investimento_brl,roi,impressoes')
        .eq('data', data)
        .eq('dominio_id', did)
        .order('hora', { ascending: true });

    const [hojeRes, ontemRes] = await Promise.all([
      buildQuery(dataHoje),
      buildQuery(dataOntem),
    ]);

    const mapRows = (rows) => (rows || []).map(r => {
      const inv = +(r.investimento_brl || 0);
      const roi = r.roi != null && inv >= 1 ? +(r.roi) : null;
      return {
        hora:         r.hora,
        receita:      +(r.receita_liquida ?? (r.receita_bruta * 0.9) ?? 0),
        ecpm:         +(r.ecpm || 0),
        investimento: inv,
        roi,
        impressoes:   r.impressoes || 0,
      };
    });

    // Retorna apenas horas que existem no banco até horaAtual — sem zero-fill
    const rawHoje = mapRows(hojeRes.data);
    const hoje = rawHoje.filter(r => r.hora <= horaAtual);

    const ontem = mapRows(ontemRes.data);
    const semDados = hoje.length === 0 && ontem.length === 0;

    res.json({
      hoje,
      ontem,
      hora_atual: horaAtual,
      data_hoje:  dataHoje,
      data_ontem: dataOntem,
      sem_dados:  semDados,
    });

  } catch (err) {
    console.error('[intraday]', err.message);
    res.status(500).json({ erro: err.message, hoje: [], ontem: [], sem_dados: true });
  }
}

module.exports = handler;

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

    const domain = req.query.domain;
    const useDomain = domain && domain !== 'all';

    if (useDomain) {
      // Domain-filtered: use report_hora (mesma fonte da Tabela Report Hora)
      // investimento/roi são dados Meta globais — indisponíveis por domínio
      let dq = supabase.from('dominios').select('id');
      if (/^\d+$/.test(String(domain))) dq = dq.eq('id', Number(domain));
      else dq = dq.eq('nome', domain);
      const { data: dom } = await dq.maybeSingle();
      const did = dom?.id ?? null;

      if (!did) {
        return res.json({
          hoje: [], ontem: [], hora_atual: horaAtual,
          data_hoje: dataHoje, data_ontem: dataOntem, sem_dados: true,
        });
      }

      const buildQ = (data) =>
        supabase.from('report_hora')
          .select('hora,receita,ecpm,impressoes')
          .eq('data', data)
          .eq('dominio_id', did)
          .order('hora', { ascending: true });

      const [hojeRes, ontemRes] = await Promise.all([buildQ(dataHoje), buildQ(dataOntem)]);

      const mapDom = (rows) => (rows || []).map(r => ({
        hora:         r.hora,
        receita:      +(r.receita * 0.9).toFixed(4),  // bruta→líquida, consistente com global
        ecpm:         +(r.ecpm || 0),
        investimento: null,
        roi:          null,
        impressoes:   r.impressoes || 0,
      }));

      const rawHoje = mapDom(hojeRes.data);
      const hoje    = rawHoje.filter(r => r.hora <= horaAtual);
      const ontem   = mapDom(ontemRes.data);

      return res.json({
        hoje, ontem, hora_atual: horaAtual,
        data_hoje: dataHoje, data_ontem: dataOntem,
        sem_dados: hoje.length === 0 && ontem.length === 0,
      });
    }

    // Global: dados_hora agregado global (dominio_id = 0)
    const did = 0;

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

'use strict';
const supabase = require('../../../lib/supabase');

function spNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function yesterday(d) {
  const y = new Date(d);
  y.setDate(y.getDate() - 1);
  return y;
}

async function handler(req, res) {
  try {
    const now = spNow();
    const horaAtual = now.getHours();
    const dataHoje = isoDate(now);
    const dataOntem = isoDate(yesterday(now));

    // Resolve domain filter
    let domainId = null;
    const domain = req.query.domain;
    if (domain && domain !== 'all' && domain !== '0' && domain !== '') {
      const { data: d } = await supabase.from('dominios').select('id').eq('nome', domain).maybeSingle();
      domainId = d?.id ?? null;
    }

    // Fetch report_hora for hoje and ontem in parallel
    const buildHoraQuery = (data) => {
      let q = supabase.from('report_hora')
        .select('hora,receita_total,impressoes,ecpm')
        .eq('data', data)
        .order('hora', { ascending: true });
      if (domainId !== null) q = q.eq('dominio_id', domainId);
      return q;
    };

    // Fetch ads_consolidados investment for hoje and ontem in parallel
    const buildInvQuery = (data) => {
      let q = supabase.from('ads_consolidados')
        .select('valor_gasto')
        .eq('data', data);
      if (domainId !== null) q = q.eq('dominio_id', domainId);
      return q;
    };

    const [hojeHoraRes, ontemHoraRes, hojeInvRes, ontemInvRes] = await Promise.all([
      buildHoraQuery(dataHoje),
      buildHoraQuery(dataOntem),
      buildInvQuery(dataHoje),
      buildInvQuery(dataOntem),
    ]);

    // Aggregate by hora (sum receita_total and impressoes, recalc ecpm)
    function aggregateHoras(rows) {
      const map = {};
      for (const r of rows || []) {
        const h = r.hora;
        if (!map[h]) map[h] = { receita_total: 0, impressoes: 0 };
        map[h].receita_total += parseFloat(r.receita_total) || 0;
        map[h].impressoes    += parseFloat(r.impressoes) || 0;
      }
      return Object.entries(map)
        .sort(([a], [b]) => a - b)
        .map(([hora, v]) => ({
          hora: parseInt(hora),
          receita_total: v.receita_total,
          impressoes: v.impressoes,
          ecpm: v.impressoes > 0 ? (v.receita_total / v.impressoes) * 1000 : 0,
        }));
    }

    function sumInvestimento(rows) {
      return (rows || []).reduce((s, r) => s + (parseFloat(r.valor_gasto) || 0), 0);
    }

    function distribuirInvestimento(inv, horas) {
      const totalImp = horas.reduce((s, h) => s + h.impressoes, 0);
      if (totalImp === 0) {
        // Distribute evenly
        const base = inv / 24;
        return horas.map(h => ({ ...h, investimento: base }));
      }
      return horas.map(h => ({
        ...h,
        investimento: inv * (h.impressoes / totalImp),
      }));
    }

    function buildOutput(horas, inv) {
      const withInv = distribuirInvestimento(inv, horas);
      return withInv.map(h => {
        const receita = h.receita_total * 0.9;
        let roi = null;
        if (h.investimento > 0) {
          roi = ((receita - h.investimento) / h.investimento) * 100;
        }
        return {
          hora:         h.hora,
          receita:      +receita.toFixed(2),
          ecpm:         +h.ecpm.toFixed(4),
          investimento: +h.investimento.toFixed(2),
          roi:          roi !== null ? +roi.toFixed(2) : null,
          impressoes:   h.impressoes,
        };
      });
    }

    // Hoje: only up to horaAtual (inclusive)
    const hojeAgg = aggregateHoras(hojeHoraRes.data || [])
      .filter(h => h.hora <= horaAtual);

    // Ontem: all 24h
    const ontemAgg = aggregateHoras(ontemHoraRes.data || []);

    const invHoje  = sumInvestimento(hojeInvRes.data);
    const invOntem = sumInvestimento(ontemInvRes.data);

    res.json({
      hoje:       buildOutput(hojeAgg, invHoje),
      ontem:      buildOutput(ontemAgg, invOntem),
      hora_atual: horaAtual,
      data_hoje:  dataHoje,
      data_ontem: dataOntem,
    });

  } catch (err) {
    console.error('[intraday]', err.message);
    res.status(500).json({ erro: err.message, hoje: [], ontem: [] });
  }
}

module.exports = handler;

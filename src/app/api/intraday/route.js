'use strict';
const supabase = require('../../../lib/supabase');
const { fetchGAMHourly } = require('../../../lib/gam');

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
    let adUnitPrefix;
    const domain = req.query.domain;
    if (domain && domain !== 'all' && domain !== '0' && domain !== '') {
      const { data: d } = await supabase.from('dominios')
        .select('id,prefixo_ad_unit')
        .eq('nome', domain).maybeSingle();
      domainId = d?.id ?? null;
      adUnitPrefix = d?.prefixo_ad_unit || undefined;
    }

    // did=0 means global aggregate — consistent with saveToCache in reports-gam
    const did = domainId ?? 0;

    const buildHoraQuery = (data) =>
      supabase.from('report_hora')
        .select('hora,receita,impressoes,ecpm')
        .eq('data', data)
        .eq('dominio_id', did)
        .order('hora', { ascending: true });

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

    function aggregateHoras(rows) {
      const map = {};
      for (const r of rows || []) {
        const h = r.hora;
        if (!map[h]) map[h] = { receita: 0, impressoes: 0 };
        map[h].receita    += parseFloat(r.receita) || 0;
        map[h].impressoes += parseFloat(r.impressoes) || 0;
      }
      return Object.entries(map)
        .sort(([a], [b]) => a - b)
        .map(([hora, v]) => ({
          hora:      parseInt(hora),
          receita:   v.receita,
          impressoes: v.impressoes,
          ecpm:      v.impressoes > 0 ? (v.receita / v.impressoes) * 1000 : 0,
        }));
    }

    function sumInvestimento(rows) {
      return (rows || []).reduce((s, r) => s + (parseFloat(r.valor_gasto) || 0), 0);
    }

    function distribuirInvestimento(inv, horas) {
      const totalImp = horas.reduce((s, h) => s + h.impressoes, 0);
      if (totalImp === 0) {
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
        const receita = h.receita * 0.9;
        const roi = h.investimento > 0
          ? +((receita - h.investimento) / h.investimento * 100).toFixed(2)
          : null;
        return {
          hora:         h.hora,
          receita:      +receita.toFixed(2),
          ecpm:         +h.ecpm.toFixed(4),
          investimento: +h.investimento.toFixed(2),
          roi,
          impressoes:   h.impressoes,
        };
      });
    }

    let hojeAgg  = aggregateHoras(hojeHoraRes.data || []).filter(h => h.hora <= horaAtual);
    let ontemAgg = aggregateHoras(ontemHoraRes.data || []);

    // Fallback: if report_hora is empty, fetch live from GAM API
    if (hojeAgg.length === 0 && ontemAgg.length === 0) {
      try {
        const gamOpts = adUnitPrefix ? { adUnitPrefix } : {};
        const [rawHoje, rawOntem] = await Promise.all([
          fetchGAMHourly({ since: dataHoje, until: dataHoje, ...gamOpts }).catch(() => []),
          fetchGAMHourly({ since: dataOntem, until: dataOntem, ...gamOpts }).catch(() => []),
        ]);

        const normalize = (rows) => (rows || []).map(h => ({
          hora:      h.hora,
          receita:   h.receita   || 0,
          impressoes: h.impressoes || 0,
          ecpm:      h.ecpm      || 0,
        }));

        const gamHoje  = normalize(rawHoje);
        const gamOntem = normalize(rawOntem);

        if (gamHoje.length > 0 || gamOntem.length > 0) {
          // Persist to report_hora so next request uses cache
          const ts = new Date().toISOString();
          const toCache = (rows, data) => rows.map(h => ({
            data, hora: h.hora, dominio_id: did,
            impressoes: h.impressoes, nao_preenchidas: 0,
            receita: h.receita, ecpm: h.ecpm,
            ctr: 0, cliques: 0, cpc: 0,
            updated_at: ts,
          }));
          const cacheRows = [...toCache(gamHoje, dataHoje), ...toCache(gamOntem, dataOntem)];
          if (cacheRows.length > 0) {
            supabase.from('report_hora')
              .upsert(cacheRows, { onConflict: 'data,hora,dominio_id' })
              .catch(e => console.warn('[intraday] cache write:', e.message));
          }
          hojeAgg  = gamHoje.filter(h => h.hora <= horaAtual);
          ontemAgg = gamOntem;
        }
      } catch (e) {
        console.warn('[intraday] GAM fallback failed:', e.message);
      }
    }

    const invHoje  = sumInvestimento(hojeInvRes.data);
    const invOntem = sumInvestimento(ontemInvRes.data);
    const semDados = hojeAgg.length === 0 && ontemAgg.length === 0;

    res.json({
      hoje:       buildOutput(hojeAgg, invHoje),
      ontem:      buildOutput(ontemAgg, invOntem),
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

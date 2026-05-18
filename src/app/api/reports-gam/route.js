'use strict';
const supabase = require('../../../lib/supabase');
const { fetchGAMHourly, fetchGAMUtmCampaigns, fetchGAMUtmSources } = require('../../../lib/gam');

function calcularAtrasoGAM(hourly, until) {
  const agora = new Date();
  const horaBR = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const horaAtualBR = horaBR.getHours();
  const dataAtualBR = horaBR.toISOString().slice(0, 10);

  if (until !== dataAtualBR) {
    return { tem_atraso: false, motivo: 'periodo_passado', mensagem: 'Período passado' };
  }

  const horasComDados = (hourly || []).filter(h => h.impressoes > 0).map(h => h.hora);

  if (horasComDados.length === 0) {
    return { tem_atraso: true, horas_atraso: horaAtualBR, ultima_hora_com_dados: null, hora_atual: horaAtualBR, mensagem: 'Nenhum dado disponível para hoje' };
  }

  const ultimaHora = Math.max(...horasComDados);
  const atrasoCompensado = Math.max(0, horaAtualBR - ultimaHora - 1);

  return {
    tem_atraso: atrasoCompensado > 0,
    horas_atraso: atrasoCompensado,
    ultima_hora_com_dados: ultimaHora,
    hora_atual: horaAtualBR,
    mensagem: atrasoCompensado === 0 ? 'Atualizado' : `${atrasoCompensado}h de atraso`,
  };
}

async function handler(req, res) {
  try {
    const { since, until, domain } = req.query;
    const now = new Date();
    const df = since || new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const dt = until || now.toISOString().slice(0, 10);

    let domainId = null;
    let adUnitPrefix = null;
    if (domain && domain !== 'all') {
      // Accept domain by numeric id OR by nome string
      let dq = supabase.from('dominios').select('id,nome,prefixo_ad_unit,codigo_pedido_gam');
      if (/^\d+$/.test(String(domain))) {
        dq = dq.eq('id', Number(domain));
      } else {
        dq = dq.eq('nome', domain);
      }
      const { data: d } = await dq.maybeSingle();
      domainId = d?.id || null;
      // Derive prefix (same logic as sync.js): prefixo_ad_unit > codigo_pedido_gam > heuristic
      const rawPrefix = d?.prefixo_ad_unit
        || (d?.codigo_pedido_gam ? (d.codigo_pedido_gam.split('-')[0] + '_') : null)
        || (String(domain).replace(/[^a-z0-9]/gi, '').slice(0, 3) + '_');
      adUnitPrefix = rawPrefix.toLowerCase(); // must be lowercase — GAM units compared lowercased
      console.log(`[reports-gam] domain="${domain}" id=${domainId} prefix="${adUnitPrefix}" src=${d?.prefixo_ad_unit?'db_field':d?.codigo_pedido_gam?'gam_code':'heuristic'}`);
    }

    let gamQ = supabase
      .from('blocos_anuncio')
      .select('nome_bloco,impressoes,total_clicks,receita_total,ecpm_medio,taxa_correspondencia_programatica')
      .gte('data', df)
      .lte('data', dt);
    if (domainId) gamQ = gamQ.eq('dominio_id', domainId);

    let adsQ = supabase
      .from('ads_consolidados')
      .select('viewability,impressoes_gam,cpc_gam,ctr_gam,cliques_gam')
      .gte('data', df)
      .lte('data', dt);
    if (domainId) adsQ = adsQ.eq('dominio_id', domainId);

    const opts = { since: df, until: dt, adUnitPrefix: adUnitPrefix || undefined };

    const [
      { data: rows },
      { data: adsRows },
      hourly,
      utmCampaigns,
      utmSources,
    ] = await Promise.all([
      gamQ,
      adsQ,
      fetchGAMHourly(opts),
      fetchGAMUtmCampaigns(opts),
      fetchGAMUtmSources(opts),
    ]);

    let totImps = 0, totRev = 0, totClicks = 0;
    let _ecpmWtSum = 0, _ecpmWt = 0;
    let _pmrWtSum = 0, _pmrWt = 0;
    const adUnitMap = {};

    for (const r of rows || []) {
      const imp = Number(r.impressoes || 0);
      const rev = Number(r.receita_total || 0);
      const clk = Number(r.total_clicks || 0);
      const em = Number(r.ecpm_medio || 0);
      const pmr = Number(r.taxa_correspondencia_programatica || 0);

      totImps += imp;
      totRev += rev;
      totClicks += clk;
      if (imp > 0 && em > 0) { _ecpmWtSum += em * imp; _ecpmWt += imp; }
      if (imp > 0) { _pmrWtSum += pmr * imp; _pmrWt += imp; }

      const k = r.nome_bloco;
      if (!adUnitMap[k]) adUnitMap[k] = { name: k, impressions: 0, revenue: 0, clicks: 0, taxaProgramatica: 0, _n: 0 };
      adUnitMap[k].impressions += imp;
      adUnitMap[k].revenue += rev;
      adUnitMap[k].clicks += clk;
      adUnitMap[k].taxaProgramatica += pmr;
      adUnitMap[k]._n++;
    }

    let _viewWtSum = 0, _viewWt = 0;
    let _cpcGamWtSum = 0, _cpcGamWt = 0;
    let _cliquesGamTotal = 0, _impGamForCtr = 0;
    for (const r of adsRows || []) {
      const vw = Number(r.viewability || 0);
      const im = Number(r.impressoes_gam || 0);
      const cpcG = Number(r.cpc_gam || 0);
      const clG = Number(r.cliques_gam || 0);
      if (vw > 0 && im > 0) { _viewWtSum += vw * im; _viewWt += im; }
      if (cpcG > 0 && clG > 0) { _cpcGamWtSum += cpcG * clG; _cpcGamWt += clG; }
      _cliquesGamTotal += clG;
      _impGamForCtr += im;
    }

    const ecpm = _ecpmWt > 0 ? _ecpmWtSum / _ecpmWt : 0;
    const pmr = _pmrWt > 0 ? _pmrWtSum / _pmrWt : 0;
    const ctr = totImps > 0 ? (totClicks / totImps) * 100 : 0;
    const rps = totImps > 0 ? totRev / totImps : 0;
    const viewability = _viewWt > 0 ? _viewWtSum / _viewWt : 0;
    const cpc_gam = _cpcGamWt > 0 ? _cpcGamWtSum / _cpcGamWt : 0;
    const ctr_gam = _impGamForCtr > 0 ? (_cliquesGamTotal / _impGamForCtr) * 100 : 0;

    const adUnits = Object.values(adUnitMap).map(u => ({
      name: u.name,
      impressions: u.impressions,
      revenue: u.revenue,
      clicks: u.clicks,
      ecpm: u.impressions > 0 ? +(u.revenue / u.impressions * 1000).toFixed(2) : 0,
      taxaProgramatica: u._n > 0 ? +(u.taxaProgramatica / u._n).toFixed(2) : 0,
    })).sort((a, b) => b.impressions - a.impressions);

    res.json({
      kpis: {
        ecpm: +ecpm.toFixed(2),
        rps: +rps.toFixed(4),
        taxaProgramatica: +pmr.toFixed(2),
        viewability: +viewability.toFixed(2),
        cpc: +cpc_gam.toFixed(4),
        ctr: +ctr_gam.toFixed(2),
        cliques_gam: _cliquesGamTotal,
        faturamento: +totRev.toFixed(2),
        impressions: totImps,
      },
      adUnits,
      advertisers: [],
      hourly,
      utmCampaigns,
      utmSources,
      topUtmCampaign: utmCampaigns.slice(0, 3),
      topUtmSource: utmSources.slice(0, 3),
      atraso_gam: calcularAtrasoGAM(hourly, dt),
    });
  } catch (err) {
    console.error('[reports-gam]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;

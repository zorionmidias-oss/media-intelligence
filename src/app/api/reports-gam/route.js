'use strict';
const { hojeBR, diasAtrasBR } = require('../../../lib/datas');
const { fetchAll } = require('../../../lib/fetchAll');
const supabase = require('../../../lib/supabase');
const { fetchGAMHourly, fetchGAMUtmCampaigns, fetchGAMUtmSources } = require('../../../lib/gam');

function calcularAtrasoGAM(hourly, until) {
  const agora = new Date();
  const horaBR = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const horaAtualBR = horaBR.getHours();
  const dataAtualBR = hojeBR();

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

async function saveToCache(hourly, utmCampaigns, utmSources, df, dt, prefix, domainId) {
  const pfx = prefix || '';
  const did = domainId ?? 0; // 0 = global (sem filtro de domínio)
  const now = new Date().toISOString();

  // Save hourly (aggregate by hour across all dates in range)
  if (hourly && hourly.length > 0) {
    const horaRows = hourly.map(h => ({
      data: dt, // single date for today queries; multi-day callers pass since=until=today
      hora: h.hora,
      impressoes: h.impressoes || 0,
      nao_preenchidas: h.nao_preenchidas || 0,
      receita: h.receita || 0,
      ecpm: h.ecpm || 0,
      ctr: h.ctr || 0,
      cliques: h.cliques || 0,
      cpc: h.cpc || 0,
      prefixo_ad_unit: pfx,
      dominio_id: did,
      updated_at: now,
    }));
    const { error: horaErr } = await supabase.from('report_hora')
      .upsert(horaRows, { onConflict: 'data,hora,dominio_id' });
    if (horaErr) console.error('[reports-gam] hora upsert:', horaErr.message);
  }

  // Save UTM campaigns
  if (utmCampaigns && utmCampaigns.length > 0) {
    const rows = utmCampaigns.map(u => ({
      data: dt,
      utm_campaign: u.utm_campaign,
      impressoes: u.impressoes || 0,
      receita: u.receita || 0,
      ecpm: u.ecpm || 0,
      ctr: u.ctr || 0,
      cliques: u.cliques || 0,
      cpc: u.cpc || 0,
      prefixo_ad_unit: pfx,
      dominio_id: did,
      updated_at: now,
    }));
    const { error: campErr } = await supabase.from('report_utm_campaign')
      .upsert(rows, { onConflict: 'data,utm_campaign,dominio_id' });
    if (campErr) console.error('[reports-gam] utm_campaign upsert:', campErr.message);
  }

  // Save UTM sources
  if (utmSources && utmSources.length > 0) {
    const rows = utmSources.map(u => ({
      data: dt,
      utm_source: u.utm_source,
      impressoes: u.impressoes || 0,
      receita: u.receita || 0,
      ecpm: u.ecpm || 0,
      cliques: u.cliques || 0,
      prefixo_ad_unit: pfx,
      updated_at: now,
    }));
    const { error: srcErr } = await supabase.from('report_utm_source')
      .upsert(rows, { onConflict: 'data,utm_source,prefixo_ad_unit' });
    if (srcErr) console.error('[reports-gam] utm_source upsert:', srcErr.message);
  }
}

async function loadFromCache(df, dt, pfx, domainId) {
  const did = domainId ?? 0; // 0 = global

  // report_utm_source ainda usa prefixo_ad_unit — só filtra se pfx não-vazio
  let srcQ = supabase.from('report_utm_source')
    .select('utm_source,impressoes,receita,ecpm,cliques')
    .gte('data', df).lte('data', dt)
    .order('receita', { ascending: false });
  if (pfx) srcQ = srcQ.eq('prefixo_ad_unit', pfx);

  const [horaRes, campRes, srcRes] = await Promise.all([
    supabase.from('report_hora')
      .select('hora,impressoes,nao_preenchidas,receita,ecpm,ctr,cliques,cpc')
      .gte('data', df).lte('data', dt)
      .eq('dominio_id', did)
      .order('hora'),
    supabase.from('report_utm_campaign')
      .select('utm_campaign,impressoes,receita,ecpm,ctr,cliques,cpc')
      .gte('data', df).lte('data', dt)
      .eq('dominio_id', did)
      .order('receita', { ascending: false }),
    srcQ,
  ]);

  const hourly = (horaRes.data || []).map(h => ({
    hora: h.hora,
    impressoes: +h.impressoes,
    nao_preenchidas: +h.nao_preenchidas,
    receita: +h.receita,
    ecpm: +h.ecpm,
    ctr: +h.ctr,
    cliques: +h.cliques,
    cpc: +h.cpc,
  })).filter(h => h.impressoes > 0 || h.nao_preenchidas > 0);

  const utmCampaigns = (campRes.data || []).map(u => ({
    utm_campaign: u.utm_campaign,
    impressoes: +u.impressoes,
    receita: +u.receita,
    ecpm: +u.ecpm,
    ctr: +u.ctr,
    cliques: +u.cliques,
    cpc: +u.cpc,
  }));

  const utmSources = (srcRes.data || []).map(u => ({
    utm_source: u.utm_source,
    impressoes: +u.impressoes,
    receita: +u.receita,
    ecpm: +u.ecpm,
    cliques: +u.cliques,
  }));

  return { hourly, utmCampaigns, utmSources, fromCache: true };
}

async function handler(req, res) {
  try {
    const { since, until, domain } = req.query;
    // ?cached=false forces live GAM API call; default is cached
    const useCached = req.query.cached !== 'false';

    const now = new Date();
    const df = since || diasAtrasBR(30);
    const dt = until || hojeBR();

    let domainId = null;
    let adUnitPrefix = null;
    if (domain && domain !== 'all') {
      let dq = supabase.from('dominios').select('id,nome,prefixo_ad_unit,codigo_pedido_gam');
      if (/^\d+$/.test(String(domain))) {
        dq = dq.eq('id', Number(domain));
      } else {
        dq = dq.eq('nome', domain);
      }
      const { data: d } = await dq.maybeSingle();
      domainId = d?.id || null;
      const rawPrefix = d?.prefixo_ad_unit
        || (d?.codigo_pedido_gam ? (d.codigo_pedido_gam.split('-')[0] + '_') : null)
        || (d?.nome ? d.nome.replace(/[^a-z0-9]/gi, '').slice(0, 4) + '_' : null);
      adUnitPrefix = rawPrefix ? rawPrefix.toLowerCase() : null;
    }

    // Colaborador restrito a domínios precisa selecionar um domínio permitido; senão,
    // não servir o agregado global do cache GAM (evita vazamento entre domínios).
    if (Array.isArray(req.allowedDominios) && (domainId == null || !req.allowedDominios.includes(Number(domainId)))) {
      return res.json({
        fromCache: true,
        kpis: { ecpm: 0, rps: 0, taxaProgramatica: 0, viewability: 0, cpc: 0, ctr: 0, cliques_gam: 0, faturamento: 0, impressions: 0, par: 0, sessoes: 0, resultado: 0, conversas: 0, custo_resultado: 0, anterior: null },
        adUnits: [], advertisers: [], hourly: [], utmCampaigns: [], utmSources: [],
        topUtmCampaign: [], topUtmSource: [], atraso_gam: null,
      });
    }

    // Previous period dates (same duration, immediately before df)
    const dias = Math.round((new Date(dt) - new Date(df)) / 86400000) + 1;
    const anteriorUntilDate = new Date(df); anteriorUntilDate.setDate(anteriorUntilDate.getDate() - 1);
    const anteriorSinceDate = new Date(df); anteriorSinceDate.setDate(anteriorSinceDate.getDate() - dias);
    const anteriorDf = anteriorSinceDate.toISOString().slice(0, 10);
    const anteriorDt = anteriorUntilDate.toISOString().slice(0, 10);

    // Fábricas p/ fetchAll — período longo passa do corte de 1000 do PostgREST
    // (blocos_anuncio tem ~800 linhas/mês; 2+ meses subcontava receita)
    const gamQ = () => {
      let q = supabase
        .from('blocos_anuncio')
        .select('nome_bloco,impressoes,total_clicks,receita_total,ecpm_medio,taxa_correspondencia_programatica')
        .gte('data', df).lte('data', dt).order('data', { ascending: true });
      if (domainId) q = q.eq('dominio_id', domainId);
      return q;
    };
    const adsQ = () => {
      let q = supabase
        .from('ads_consolidados')
        .select('viewability,impressoes_gam,cpc_gam,ctr_gam,cliques_gam,valor_gasto,sessoes_meta,resultado,conversas_meta')
        .gte('data', df).lte('data', dt).order('data', { ascending: true }).order('id', { ascending: true });
      if (domainId) q = q.eq('dominio_id', domainId);
      return q;
    };
    const prevGamQ = () => {
      let q = supabase
        .from('blocos_anuncio')
        .select('impressoes,receita_total,ecpm_medio')
        .gte('data', anteriorDf).lte('data', anteriorDt).order('data', { ascending: true });
      if (domainId) q = q.eq('dominio_id', domainId);
      return q;
    };
    const prevAdsQ = () => {
      let q = supabase
        .from('ads_consolidados')
        .select('impressoes_gam,cpc_gam,cliques_gam')
        .gte('data', anteriorDf).lte('data', anteriorDt).order('data', { ascending: true }).order('id', { ascending: true });
      if (domainId) q = q.eq('dominio_id', domainId);
      return q;
    };

    const opts = { since: df, until: dt, adUnitPrefix: adUnitPrefix || undefined };
    const pfx = adUnitPrefix || '';

    let hourly, utmCampaigns, utmSources, fromCache = false;

    if (useCached) {
      const cached = await loadFromCache(df, dt, pfx, domainId);
      hourly       = cached.hourly;
      utmCampaigns = cached.utmCampaigns;
      utmSources   = cached.utmSources;
      // Só considera cache válido se trouxe dados reais
      fromCache = cached.hourly.length > 0 || cached.utmCampaigns.length > 0;
    }

    // Fallback ao vivo: cache vazio OU ?cached=false forçado
    if (!fromCache) {
      console.log('[reports-gam] cache vazio ou forced — buscando GAM ao vivo');
      [hourly, utmCampaigns, utmSources] = await Promise.all([
        fetchGAMHourly(opts),
        fetchGAMUtmCampaigns(opts),
        fetchGAMUtmSources(opts),
      ]);
      // Salvar no cache em background
      saveToCache(hourly, utmCampaigns, utmSources, df, dt, pfx, domainId).catch(e =>
        console.warn('[reports-gam] saveToCache error:', e.message)
      );
    }

    const [{ data: rows }, { data: adsRows }, { data: prevRows }, { data: prevAdsRows }] =
      await Promise.all([fetchAll(gamQ), fetchAll(adsQ), fetchAll(prevGamQ), fetchAll(prevAdsQ)]);
    console.log(`[GAM filter] dominio_id=${domainId ?? 0}, blocos=${rows?.length ?? 0}, horas=${(hourly || []).length}, utms=${(utmCampaigns || []).length}`);

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
    let _sessoes = 0, _resultado = 0, _conversas = 0, _investimento = 0;
    for (const r of adsRows || []) {
      const vw = Number(r.viewability || 0);
      const im = Number(r.impressoes_gam || 0);
      const cpcG = Number(r.cpc_gam || 0);
      const clG = Number(r.cliques_gam || 0);
      if (vw > 0 && im > 0) { _viewWtSum += vw * im; _viewWt += im; }
      if (cpcG > 0 && clG > 0) { _cpcGamWtSum += cpcG * clG; _cpcGamWt += clG; }
      _cliquesGamTotal += clG;
      _impGamForCtr += im;
      _sessoes += Number(r.sessoes_meta || 0);
      _resultado += Number(r.resultado || 0);
      _conversas += Number(r.conversas_meta || 0);
      _investimento += Number(r.valor_gasto || 0);
    }

    const ecpm = _ecpmWt > 0 ? _ecpmWtSum / _ecpmWt : 0;
    const pmr = _pmrWt > 0 ? _pmrWtSum / _pmrWt : 0;
    const ctr = totImps > 0 ? (totClicks / totImps) * 100 : 0;
    const rps = totImps > 0 ? totRev / totImps : 0;
    const viewability = _viewWt > 0 ? _viewWtSum / _viewWt : 0;
    const cpc_gam = _cpcGamWt > 0 ? _cpcGamWtSum / _cpcGamWt : 0;
    const ctr_gam = _impGamForCtr > 0 ? (_cliquesGamTotal / _impGamForCtr) * 100 : 0;
    // Métricas Meta agregadas + derivadas (mesmas fórmulas do gráfico por hora):
    // PAR = impressões GAM ÷ sessões · custo/resultado = investimento ÷ resultado.
    const par = totImps > 0 && _sessoes > 0 ? totImps / _sessoes : 0;
    const custo_resultado = _resultado > 0 ? _investimento / _resultado : 0;

    // Aggregate previous period
    let _prevEcpmWtSum = 0, _prevEcpmWt = 0, prevTotImps = 0, prevTotRev = 0;
    for (const r of prevRows || []) {
      const imp = Number(r.impressoes || 0);
      const rev = Number(r.receita_total || 0);
      const em  = Number(r.ecpm_medio || 0);
      prevTotImps += imp;
      prevTotRev  += rev;
      if (imp > 0 && em > 0) { _prevEcpmWtSum += em * imp; _prevEcpmWt += imp; }
    }
    let _prevCpcWtSum = 0, _prevCpcWt = 0, prevCliques = 0, prevImpForCtr = 0;
    for (const r of prevAdsRows || []) {
      const cpcG = Number(r.cpc_gam || 0);
      const clG  = Number(r.cliques_gam || 0);
      const im   = Number(r.impressoes_gam || 0);
      if (cpcG > 0 && clG > 0) { _prevCpcWtSum += cpcG * clG; _prevCpcWt += clG; }
      prevCliques    += clG;
      prevImpForCtr  += im;
    }
    const prevEcpm   = _prevEcpmWt > 0 ? _prevEcpmWtSum / _prevEcpmWt : 0;
    const prevRps    = prevTotImps > 0 ? prevTotRev / prevTotImps : 0;
    const prevCpc    = _prevCpcWt  > 0 ? _prevCpcWtSum / _prevCpcWt : 0;
    const prevCtrGam = prevImpForCtr > 0 ? (prevCliques / prevImpForCtr) * 100 : 0;
    const anterior = prevTotImps > 0 ? {
      ecpm: +prevEcpm.toFixed(2),
      rps:  +prevRps.toFixed(4),
      cpc:  +prevCpc.toFixed(4),
      ctr:  +prevCtrGam.toFixed(2),
      impressions: prevTotImps,
    } : null;

    const adUnits = Object.values(adUnitMap).map(u => ({
      name: u.name,
      impressions: u.impressions,
      revenue: u.revenue,
      clicks: u.clicks,
      ecpm: u.impressions > 0 ? +(u.revenue / u.impressions * 1000).toFixed(2) : 0,
      taxaProgramatica: u._n > 0 ? +(u.taxaProgramatica / u._n).toFixed(2) : 0,
    })).sort((a, b) => b.impressions - a.impressions);

    res.json({
      fromCache,
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
        par: +par.toFixed(2),
        sessoes: _sessoes,
        resultado: _resultado,
        conversas: _conversas,
        custo_resultado: +custo_resultado.toFixed(4),
        anterior,
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

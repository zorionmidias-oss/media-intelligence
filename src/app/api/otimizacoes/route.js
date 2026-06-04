'use strict';
const supabase = require('../../../lib/supabase');

// ─── Snapshot helper ──────────────────────────────────────────────────────────
// Agrega métricas de ads_consolidados por utm + campanha_name no período.
// Usada tanto no registro quanto no fechamento.
async function calcularSnapshot(utm, campaignName, since, until) {
  let q = supabase
    .from('ads_consolidados')
    .select('valor_gasto,faturamento_real,cliques,resultado,impressoes_gam,ecpm')
    .eq('ad_utm', utm)
    .gte('data', since)
    .lte('data', until);

  if (campaignName) q = q.eq('campanha_meta', campaignName);

  const { data: rows, error } = await q;
  if (error) throw new Error(`snapshot query: ${error.message}`);

  const inv       = (rows || []).reduce((s, r) => s + Number(r.valor_gasto      || 0), 0);
  const fat       = (rows || []).reduce((s, r) => s + Number(r.faturamento_real || 0), 0);
  const cliques   = (rows || []).reduce((s, r) => s + Number(r.cliques          || 0), 0);
  const resultado = (rows || []).reduce((s, r) => s + Number(r.resultado        || 0), 0);
  const imps      = (rows || []).reduce((s, r) => s + Number(r.impressoes_gam   || 0), 0);
  const ecpmSum   = (rows || []).reduce((s, r) =>
    s + Number(r.ecpm || 0) * Number(r.impressoes_gam || 0), 0);

  return {
    investido:        +inv.toFixed(2),
    faturamento:      +fat.toFixed(2),
    lucro:            +(fat - inv).toFixed(2),
    roas:             inv > 0   ? +(fat      / inv).toFixed(4)     : null,
    cpc:              cliques > 0 ? +(inv    / cliques).toFixed(4) : null,
    custo_resultado:  resultado > 0 ? +(inv  / resultado).toFixed(2) : null,
    resultados:       resultado,
    cliques,
    impressoes:       imps,
    ecpm:             imps > 0 ? +(ecpmSum / imps).toFixed(2)      : null,
  };
}

// ─── Timeline helper ──────────────────────────────────────────────────────────
// Retorna série diária por utm + campanha_name entre since e until.
async function calcularTimeline(utm, campaignName, since, until) {
  let q = supabase
    .from('ads_consolidados')
    .select('data,valor_gasto,faturamento_real,cliques,resultado,impressoes_gam,ecpm')
    .eq('ad_utm', utm)
    .gte('data', since)
    .lte('data', until)
    .order('data');

  if (campaignName) q = q.eq('campanha_meta', campaignName);

  const { data: rows, error } = await q;
  if (error) throw new Error(`timeline query: ${error.message}`);

  const byDay = {};
  for (const r of rows || []) {
    if (!byDay[r.data]) byDay[r.data] = { inv: 0, fat: 0, cliques: 0, res: 0, imps: 0, ecpmSum: 0 };
    const d = byDay[r.data];
    d.inv     += Number(r.valor_gasto      || 0);
    d.fat     += Number(r.faturamento_real || 0);
    d.cliques += Number(r.cliques          || 0);
    d.res     += Number(r.resultado        || 0);
    d.imps    += Number(r.impressoes_gam   || 0);
    d.ecpmSum += Number(r.ecpm || 0) * Number(r.impressoes_gam || 0);
  }

  const dias = Object.keys(byDay).sort();
  return {
    dias,
    series: {
      investido:       dias.map(d => +byDay[d].inv.toFixed(2)),
      faturamento:     dias.map(d => +byDay[d].fat.toFixed(2)),
      lucro:           dias.map(d => +(byDay[d].fat - byDay[d].inv).toFixed(2)),
      roas:            dias.map(d => byDay[d].inv > 0   ? +(byDay[d].fat     / byDay[d].inv).toFixed(4)     : null),
      cpc:             dias.map(d => byDay[d].cliques > 0 ? +(byDay[d].inv   / byDay[d].cliques).toFixed(4) : null),
      custo_resultado: dias.map(d => byDay[d].res > 0   ? +(byDay[d].inv     / byDay[d].res).toFixed(2)     : null),
      resultados:      dias.map(d => byDay[d].res),
      cliques:         dias.map(d => byDay[d].cliques),
      ecpm:            dias.map(d => byDay[d].imps > 0  ? +(byDay[d].ecpmSum / byDay[d].imps).toFixed(2)    : null),
    },
  };
}

// ─── Tipos de ação ────────────────────────────────────────────────────────────
async function listTipos(req, res) {
  const { data, error } = await supabase
    .from('otimizacoes_tipos_acao')
    .select('*')
    .eq('ativo', true)
    .order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function createTipo(req, res) {
  const { nome, prazo_horas } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });
  const { data, error } = await supabase
    .from('otimizacoes_tipos_acao')
    .insert({ nome, prazo_horas: prazo_horas || 72 })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
}

async function updateTipo(req, res) {
  const { id } = req.params;
  const { nome, prazo_horas, ativo } = req.body || {};
  const updates = {};
  if (nome       !== undefined) updates.nome        = nome;
  if (prazo_horas !== undefined) updates.prazo_horas = prazo_horas;
  if (ativo      !== undefined) updates.ativo       = ativo;
  const { data, error } = await supabase
    .from('otimizacoes_tipos_acao')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

async function deleteTipo(req, res) {
  const { id } = req.params;
  const { error } = await supabase
    .from('otimizacoes_tipos_acao')
    .update({ ativo: false })
    .eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}

// ─── Pendentes por UTM ────────────────────────────────────────────────────────
async function pendentesPorUtm(req, res) {
  const { data, error } = await supabase
    .from('otimizacoes')
    .select('utm')
    .eq('status', 'pendente');
  if (error) return res.status(500).json({ error: error.message });
  const counts = {};
  for (const r of data || []) counts[r.utm] = (counts[r.utm] || 0) + 1;
  res.json(counts);
}

// ─── Lista registros ──────────────────────────────────────────────────────────
async function listOtimizacoes(req, res) {
  const { utm, status } = req.query;
  let q = supabase
    .from('otimizacoes')
    .select('*')
    .order('criado_em', { ascending: false });
  if (utm)    q = q.eq('utm', utm);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

// ─── Criar registro ───────────────────────────────────────────────────────────
async function createOtimizacao(req, res) {
  const {
    utm, campaign_id, campaign_name, adset_id, adset_name,
    account_id, tipo_acao_id, observacao, since, until,
  } = req.body || {};

  if (!utm || !campaign_id || !tipo_acao_id || !since || !until)
    return res.status(400).json({ error: 'utm, campaign_id, tipo_acao_id, since e until são obrigatórios' });

  // Buscar tipo para prazo e desnormalizar nome
  const { data: tipo, error: tipoErr } = await supabase
    .from('otimizacoes_tipos_acao')
    .select('nome, prazo_horas')
    .eq('id', tipo_acao_id)
    .single();
  if (tipoErr || !tipo) return res.status(404).json({ error: 'Tipo de ação não encontrado' });

  // Backend calcula snapshot — não confia em métricas do frontend
  let snapshot_metricas;
  try {
    snapshot_metricas = await calcularSnapshot(utm, campaign_name || null, since, until);
  } catch (e) {
    return res.status(500).json({ error: `Erro ao calcular snapshot: ${e.message}` });
  }

  const revisar_em = new Date(Date.now() + tipo.prazo_horas * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from('otimizacoes')
    .insert({
      utm,
      account_id:      account_id || null,
      campaign_id,
      campaign_name:   campaign_name || null,
      adset_id:        adset_id || null,
      adset_name:      adset_name || null,
      tipo_acao_id,
      tipo_acao_nome:  tipo.nome,
      observacao:      observacao || null,
      periodo_since:   since,
      periodo_until:   until,
      snapshot_metricas,
      revisar_em,
      status: 'pendente',
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
}

// ─── Revisar hoje ─────────────────────────────────────────────────────────────
async function revisarHoje(req, res) {
  const agora = new Date().toISOString();
  const { data, error } = await supabase
    .from('otimizacoes')
    .select('*')
    .eq('status', 'pendente')
    .lte('revisar_em', agora)
    .order('revisar_em', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

// ─── Timeline por id ──────────────────────────────────────────────────────────
async function timeline(req, res) {
  const { id } = req.params;
  const { data: reg, error: regErr } = await supabase
    .from('otimizacoes')
    .select('utm, campaign_name, criado_em, periodo_since, periodo_until')
    .eq('id', id)
    .single();
  if (regErr || !reg) return res.status(404).json({ error: 'Registro não encontrado' });

  // Série desde a data do registro até hoje
  const since = new Date(reg.criado_em).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);

  try {
    const result = await calcularTimeline(reg.utm, reg.campaign_name || null, since, until);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── Fechar revisão ───────────────────────────────────────────────────────────
async function fechar(req, res) {
  const { id } = req.params;
  const { veredito, decisao, observacao_fechamento } = req.body || {};

  if (!veredito || !decisao)
    return res.status(400).json({ error: 'veredito e decisao são obrigatórios' });

  const { data: reg, error: regErr } = await supabase
    .from('otimizacoes')
    .select('utm, campaign_name, periodo_since, periodo_until, status')
    .eq('id', id)
    .single();
  if (regErr || !reg) return res.status(404).json({ error: 'Registro não encontrado' });
  if (reg.status === 'revisado') return res.status(409).json({ error: 'Já revisado' });

  // Snapshot revisão usa o mesmo período do registro para comparação justa
  let snapshot_revisao;
  try {
    snapshot_revisao = await calcularSnapshot(
      reg.utm, reg.campaign_name || null,
      reg.periodo_since, reg.periodo_until
    );
  } catch (e) {
    return res.status(500).json({ error: `Erro ao calcular snapshot revisão: ${e.message}` });
  }

  const { data, error } = await supabase
    .from('otimizacoes')
    .update({
      status:                'revisado',
      revisado_em:           new Date().toISOString(),
      snapshot_revisao,
      veredito,
      decisao,
      observacao_fechamento: observacao_fechamento || null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
}

// ─── Snapshot preview (sem criar registro) ────────────────────────────────────
async function snapshotPreview(req, res) {
  const { utm, campaign_name, since, until } = req.query;
  if (!utm || !since || !until)
    return res.status(400).json({ error: 'utm, since e until são obrigatórios' });
  try {
    const snap = await calcularSnapshot(utm, campaign_name || null, since, until);
    res.json(snap);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

module.exports = {
  listTipos, createTipo, updateTipo, deleteTipo,
  pendentesPorUtm, listOtimizacoes, createOtimizacao,
  revisarHoje, timeline, fechar, snapshotPreview,
};

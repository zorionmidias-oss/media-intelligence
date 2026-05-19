'use strict';
const supabase = require('../../../lib/supabase');

// ── Helpers ────────────────────────────────────────────────────────────────────
const TIPOS_VALIDOS = ['bot', 'direto', 'conversao'];

function validarTemplate(body) {
  const erros = [];
  if (!body.nome || body.nome.trim().length < 3) erros.push('nome deve ter ao menos 3 caracteres');
  if (body.nome && body.nome.trim().length > 80) erros.push('nome deve ter no máximo 80 caracteres');
  if (!TIPOS_VALIDOS.includes(body.tipo)) erros.push('tipo inválido (bot | direto | conversao)');
  if (!body.account_id) erros.push('account_id é obrigatório');
  if (!body.objetivo) erros.push('objetivo é obrigatório');
  if (!body.optimization_goal) erros.push('optimization_goal é obrigatório');
  if (!body.campaign_name_pattern) erros.push('campaign_name_pattern é obrigatório');
  if (!body.adset_name_pattern) erros.push('adset_name_pattern é obrigatório');
  if (!body.ad_name_pattern) erros.push('ad_name_pattern é obrigatório');
  if (!body.campaign_name_pattern?.includes('{{utm_campaign}}'))
    erros.push('campaign_name_pattern deve conter {{utm_campaign}}');
  if (!body.publico || typeof body.publico !== 'object') erros.push('publico é obrigatório (objeto)');
  const orc = Number(body.orcamento_diario_padrao);
  if (isNaN(orc) || orc < 1 || orc > 100000) erros.push('orcamento_diario_padrao deve ser entre R$1 e R$100.000');
  return erros;
}

function sanitizar(body) {
  return {
    nome: body.nome?.trim(),
    descricao: body.descricao?.trim() || null,
    tipo: body.tipo,
    account_id: String(body.account_id).startsWith('act_') ? body.account_id : `act_${body.account_id}`,
    dominio_id: body.dominio_id ? Number(body.dominio_id) : null,
    objetivo: body.objetivo,
    optimization_goal: body.optimization_goal,
    billing_event: body.billing_event || 'IMPRESSIONS',
    campaign_name_pattern: body.campaign_name_pattern?.trim(),
    adset_name_pattern: body.adset_name_pattern?.trim(),
    ad_name_pattern: body.ad_name_pattern?.trim(),
    utm_pattern_url: body.utm_pattern_url?.trim() || null,
    orcamento_diario_padrao: Number(body.orcamento_diario_padrao) || 6,
    bid_strategy: body.bid_strategy || 'LOWEST_COST_WITHOUT_CAP',
    bid_amount: body.bid_amount ? Number(body.bid_amount) : null,
    agendar_meia_noite: body.agendar_meia_noite !== false,
    publico: body.publico || {},
    placements: body.placements || { facebook: ['feed', 'reels'], instagram: ['stream', 'reels'] },
    criativo_base: body.criativo_base || null,
    pixel_id: body.pixel_id || null,
    custom_event_type: body.custom_event_type || null,
    special_ad_categories: body.special_ad_categories || [],
    updated_at: new Date().toISOString(),
  };
}

// ── Handler ────────────────────────────────────────────────────────────────────
async function handler(req, res) {
  const id = req.params?.id ? Number(req.params.id) : null;
  const action = req.params?.action || null; // 'duplicar'

  try {
    // POST /:id/duplicar
    if (req.method === 'POST' && action === 'duplicar') {
      const { data: orig, error: oErr } = await supabase
        .from('campaign_templates').select('*').eq('id', id).single();
      if (oErr || !orig) return res.status(404).json({ erro: 'Template não encontrado' });

      const { id: _id, created_at, updated_at, ultima_uso, total_usos, nome, ...rest } = orig;
      let novoNome = `Cópia de ${nome}`;
      // Garante unicidade se já existir outra cópia
      const { data: existe } = await supabase.from('campaign_templates')
        .select('id').eq('nome', novoNome).maybeSingle();
      if (existe) novoNome = `Cópia de ${nome} ${Date.now()}`;

      const { data, error } = await supabase.from('campaign_templates')
        .insert({ ...rest, nome: novoNome, total_usos: 0, updated_at: new Date().toISOString() })
        .select().single();
      if (error) return res.status(500).json({ erro: error.message });
      return res.json(data);
    }

    // GET /templates
    if (req.method === 'GET' && !id) {
      let q = supabase.from('campaign_templates').select('*').order('created_at', { ascending: false });
      if (req.query.tipo) q = q.eq('tipo', req.query.tipo);
      if (req.query.account_id) q = q.eq('account_id', req.query.account_id);
      const { data, error } = await q;
      if (error) return res.status(500).json({ erro: error.message });
      return res.json(data || []);
    }

    // GET /templates/:id
    if (req.method === 'GET' && id) {
      const { data, error } = await supabase.from('campaign_templates').select('*').eq('id', id).single();
      if (error || !data) return res.status(404).json({ erro: 'Template não encontrado' });
      return res.json(data);
    }

    // POST /templates — criar
    if (req.method === 'POST') {
      const erros = validarTemplate(req.body);
      if (erros.length) return res.status(400).json({ erro: erros.join('; ') });

      // Verifica se conta existe
      const { data: conta } = await supabase.from('meta_accounts')
        .select('id').eq('ad_account_id', sanitizar(req.body).account_id).maybeSingle();
      if (!conta) return res.status(400).json({ erro: 'Conta Meta não encontrada' });

      const row = sanitizar(req.body);
      const { data, error } = await supabase.from('campaign_templates').insert(row).select().single();
      if (error) {
        if (error.message.includes('unique')) return res.status(409).json({ erro: 'Já existe um template com esse nome' });
        return res.status(500).json({ erro: error.message });
      }
      return res.status(201).json(data);
    }

    // PUT /templates/:id
    if (req.method === 'PUT' && id) {
      const erros = validarTemplate(req.body);
      if (erros.length) return res.status(400).json({ erro: erros.join('; ') });
      const row = sanitizar(req.body);
      const { data, error } = await supabase.from('campaign_templates')
        .update(row).eq('id', id).select().single();
      if (error) {
        if (error.message.includes('unique')) return res.status(409).json({ erro: 'Já existe um template com esse nome' });
        return res.status(500).json({ erro: error.message });
      }
      return res.json(data);
    }

    // DELETE /templates/:id
    if (req.method === 'DELETE' && id) {
      const { data: t } = await supabase.from('campaign_templates')
        .select('nome,total_usos').eq('id', id).single();
      if (!t) return res.status(404).json({ erro: 'Template não encontrado' });
      const { error } = await supabase.from('campaign_templates').delete().eq('id', id);
      if (error) return res.status(500).json({ erro: error.message });
      return res.json({ ok: true, nome: t.nome });
    }

    res.status(405).json({ erro: 'Método não suportado' });
  } catch (err) {
    console.error('[/api/templates]', err.message);
    res.status(500).json({ erro: err.message });
  }
}

// ── Seed — 3 templates de exemplo ─────────────────────────────────────────────
async function seedTemplates(accountId) {
  const seeds = [
    {
      nome: 'BOT — Visualização de Conteúdo',
      descricao: 'Template padrão para campanhas BOT com objetivo de tráfego',
      tipo: 'bot',
      account_id: accountId,
      objetivo: 'OUTCOME_TRAFFIC',
      optimization_goal: 'LANDING_PAGE_VIEWS',
      billing_event: 'IMPRESSIONS',
      campaign_name_pattern: '[{{dominio_curto}}] [{{utm_source}}] [{{utm_campaign}}]',
      adset_name_pattern: '[{{utm_source}}] [{{utm_campaign}}] V{{numero}}',
      ad_name_pattern: '{{numero}}-{{utm_campaign}}',
      utm_pattern_url: '{{link_destino}}?utm_source={{utm_source}}&utm_campaign={{utm_campaign}}&utm_medium=bloco{{bloco}}-botao{{botao}}-{{utm_campaign}}',
      orcamento_diario_padrao: 6.00,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      agendar_meia_noite: true,
      publico: { tipo: 'custom', paises: ['BR'], idade_min: 18, idade_max: 65, genero: 'all' },
      placements: { facebook: ['feed', 'reels'], instagram: ['stream', 'reels'] },
    },
    {
      nome: 'Tráfego Direto — Link Clicks',
      descricao: 'Template para campanhas de tráfego direto otimizadas por cliques',
      tipo: 'direto',
      account_id: accountId,
      objetivo: 'OUTCOME_TRAFFIC',
      optimization_goal: 'LINK_CLICKS',
      billing_event: 'IMPRESSIONS',
      campaign_name_pattern: '[{{dominio_curto}}] [Direto] [{{utm_campaign}}]',
      adset_name_pattern: '[Direto] [{{utm_campaign}}] V{{numero}}',
      ad_name_pattern: '{{numero}}-{{utm_campaign}}-direto',
      utm_pattern_url: '{{link_destino}}?utm_source={{utm_source}}&utm_campaign={{utm_campaign}}&utm_medium=direto',
      orcamento_diario_padrao: 10.00,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      agendar_meia_noite: true,
      publico: { tipo: 'custom', paises: ['BR'], idade_min: 18, idade_max: 65, genero: 'all' },
      placements: { facebook: ['feed', 'reels'], instagram: ['stream', 'reels'] },
    },
    {
      nome: 'Conversão — Purchase',
      descricao: 'Template para campanhas de conversão com Pixel (compras)',
      tipo: 'conversao',
      account_id: accountId,
      objetivo: 'OUTCOME_SALES',
      optimization_goal: 'OFFSITE_CONVERSIONS',
      billing_event: 'IMPRESSIONS',
      campaign_name_pattern: '[{{dominio_curto}}] [Conversao] [{{utm_campaign}}]',
      adset_name_pattern: '[Conv] [{{utm_campaign}}] V{{numero}}',
      ad_name_pattern: '{{numero}}-{{utm_campaign}}-conv',
      orcamento_diario_padrao: 20.00,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      agendar_meia_noite: true,
      publico: { tipo: 'custom', paises: ['BR'], idade_min: 18, idade_max: 65, genero: 'all' },
      placements: { facebook: ['feed', 'reels'], instagram: ['stream', 'reels'] },
      custom_event_type: 'PURCHASE',
    },
  ];

  const results = [];
  for (const s of seeds) {
    const { data, error } = await supabase.from('campaign_templates')
      .upsert(s, { onConflict: 'nome', ignoreDuplicates: true }).select().single();
    if (!error && data) results.push(data);
  }
  return results;
}

async function seedHandler(req, res) {
  try {
    // Pega primeira conta ativa
    const { data: conta } = await supabase.from('meta_accounts')
      .select('ad_account_id').eq('ativo', true).order('id').limit(1).single();
    if (!conta) return res.status(400).json({ erro: 'Nenhuma conta Meta ativa encontrada' });
    const criados = await seedTemplates(conta.ad_account_id);
    res.json({ ok: true, criados: criados.length, templates: criados });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
}

module.exports = { handler, seedHandler };

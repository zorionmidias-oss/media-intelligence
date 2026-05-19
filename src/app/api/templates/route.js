'use strict';
const supabase = require('../../../lib/supabase');
const { validateTemplate } = require('../../../lib/template-validator');

function normalizeAccountId(v) {
  const s = String(v || '');
  return s.startsWith('act_') ? s : `act_${s}`;
}

function sanitizar(body) {
  return {
    nome: body.nome?.trim(),
    descricao: body.descricao?.trim() || null,
    tipo: body.tipo,
    account_id: normalizeAccountId(body.account_id),
    dominio_id: body.dominio_id ? Number(body.dominio_id) : null,
    campanha_config: body.campanha_config || {},
    conjunto_config: body.conjunto_config || {},
    criativo_config: body.criativo_config || {},
    patterns: body.patterns || {},
    updated_at: new Date().toISOString(),
  };
}

async function handler(req, res) {
  const id = req.params?.id ? Number(req.params.id) : null;
  const action = req.params?.action || null;

  try {
    // ── POST /:id/duplicar ──────────────────────────────────────────────────
    if (req.method === 'POST' && action === 'duplicar') {
      const { data: orig, error: oErr } = await supabase
        .from('campaign_templates').select('*').eq('id', id).single();
      if (oErr || !orig) return res.status(404).json({ erro: 'Template não encontrado' });

      const { id: _id, created_at, updated_at, ultima_uso, total_usos, nome, ...rest } = orig;
      let novoNome = `Cópia de ${nome}`;
      let counter = 2;
      // Garante nome único
      while (true) {
        const { data: existe } = await supabase.from('campaign_templates')
          .select('id').eq('nome', novoNome).maybeSingle();
        if (!existe) break;
        novoNome = `Cópia de ${nome} ${counter++}`;
      }

      const { data, error } = await supabase.from('campaign_templates')
        .insert({ ...rest, nome: novoNome, total_usos: 0, ultima_uso: null, updated_at: new Date().toISOString() })
        .select().single();
      if (error) return res.status(500).json({ erro: error.message });
      return res.json(data);
    }

    // ── GET /templates ──────────────────────────────────────────────────────
    if (req.method === 'GET' && !id) {
      let q = supabase.from('campaign_templates').select('*')
        .order('ultima_uso', { ascending: false, nullsFirst: false })
        .order('total_usos', { ascending: false })
        .order('created_at', { ascending: false });
      if (req.query.tipo) q = q.eq('tipo', req.query.tipo);
      if (req.query.account_id) q = q.eq('account_id', normalizeAccountId(req.query.account_id));
      const { data, error } = await q;
      if (error) return res.status(500).json({ erro: error.message });
      return res.json(data || []);
    }

    // ── GET /templates/:id ──────────────────────────────────────────────────
    if (req.method === 'GET' && id) {
      const { data, error } = await supabase.from('campaign_templates').select('*').eq('id', id).single();
      if (error || !data) return res.status(404).json({ erro: 'Template não encontrado' });
      return res.json(data);
    }

    // ── POST /templates ─────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { valid, errors } = await validateTemplate(req.body);
      if (!valid) return res.status(400).json({ erro: 'Validação falhou', errors });

      const row = sanitizar(req.body);
      const { data, error } = await supabase.from('campaign_templates').insert(row).select().single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um template com esse nome' });
        return res.status(500).json({ erro: error.message });
      }
      return res.status(201).json(data);
    }

    // ── PUT /templates/:id ──────────────────────────────────────────────────
    if (req.method === 'PUT' && id) {
      const { valid, errors } = await validateTemplate(req.body);
      if (!valid) return res.status(400).json({ erro: 'Validação falhou', errors });

      const row = sanitizar(req.body);
      const { data, error } = await supabase.from('campaign_templates')
        .update(row).eq('id', id).select().single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ erro: 'Já existe um template com esse nome' });
        return res.status(500).json({ erro: error.message });
      }
      if (!data) return res.status(404).json({ erro: 'Template não encontrado' });
      return res.json(data);
    }

    // ── DELETE /templates/:id ───────────────────────────────────────────────
    if (req.method === 'DELETE' && id) {
      const { data: t } = await supabase.from('campaign_templates')
        .select('nome,total_usos').eq('id', id).single();
      if (!t) return res.status(404).json({ erro: 'Template não encontrado' });
      if ((t.total_usos || 0) > 0 && req.query.confirm !== 'true')
        return res.status(409).json({
          erro: `Template usado ${t.total_usos} vez(es). Adicione ?confirm=true para confirmar.`,
          total_usos: t.total_usos,
        });
      const { error } = await supabase.from('campaign_templates').delete().eq('id', id);
      if (error) return res.status(500).json({ erro: error.message });
      return res.json({ deleted: true, nome: t.nome });
    }

    res.status(405).json({ erro: 'Método não suportado' });
  } catch (err) {
    console.error('[/api/templates]', err.message);
    res.status(500).json({ erro: err.message });
  }
}

// ── Seed ───────────────────────────────────────────────────────────────────────
async function seedTemplates(accountId) {
  const seeds = [
    {
      nome: 'BOT — Visualização de Conteúdo',
      descricao: 'Template padrão para campanhas BOT com objetivo de tráfego via Messenger',
      tipo: 'bot',
      account_id: accountId,
      campanha_config: {
        objective: 'OUTCOME_TRAFFIC',
        buying_type: 'AUCTION',
        special_ad_categories: [],
        budget_mode: 'abo',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        status_inicial: 'PAUSED',
        agendar_meia_noite: true,
      },
      conjunto_config: {
        destination_type: 'MESSENGER',
        optimization_goal: 'LANDING_PAGE_VIEWS',
        billing_event: 'IMPRESSIONS',
        abo_daily_budget: 6.00,
        targeting: {
          geo_locations: { countries: ['BR'] },
          age_min: 18,
          age_max: 65,
        },
        placements: { automatic: false, facebook_positions: ['feed', 'reels'], instagram_positions: ['stream', 'reels'] },
      },
      criativo_config: { call_to_action_type: 'MESSAGE_PAGE' },
      patterns: {
        campaign_name: '[{{dominio_curto}}] [{{utm_source}}] [{{utm_campaign}}]',
        adset_name: '[{{utm_source}}] [{{utm_campaign}}] V{{numero}}',
        ad_name: '{{numero}}-{{utm_campaign}}',
        utm_url: '{{link_destino}}?utm_source={{utm_source}}&utm_campaign={{utm_campaign}}&utm_medium=bloco{{bloco}}-botao{{botao}}-{{utm_campaign}}',
      },
    },
    {
      nome: 'Tráfego Direto — Link Clicks',
      descricao: 'Template para campanhas de tráfego direto otimizadas por cliques',
      tipo: 'direto',
      account_id: accountId,
      campanha_config: {
        objective: 'OUTCOME_TRAFFIC',
        buying_type: 'AUCTION',
        special_ad_categories: [],
        budget_mode: 'abo',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        status_inicial: 'PAUSED',
        agendar_meia_noite: true,
      },
      conjunto_config: {
        destination_type: 'WEBSITE',
        optimization_goal: 'LINK_CLICKS',
        billing_event: 'IMPRESSIONS',
        abo_daily_budget: 10.00,
        targeting: {
          geo_locations: { countries: ['BR'] },
          age_min: 18,
          age_max: 65,
        },
        placements: { automatic: false, facebook_positions: ['feed', 'reels'], instagram_positions: ['stream', 'reels'] },
      },
      criativo_config: { call_to_action_type: 'LEARN_MORE' },
      patterns: {
        campaign_name: '[{{dominio_curto}}] [Direto] [{{utm_campaign}}]',
        adset_name: '[Direto] [{{utm_campaign}}] V{{numero}}',
        ad_name: '{{numero}}-{{utm_campaign}}-direto',
        utm_url: '{{link_destino}}?utm_source={{utm_source}}&utm_campaign={{utm_campaign}}&utm_medium=direto',
      },
    },
    {
      nome: 'Conversão — Purchase',
      descricao: 'Template para campanhas de conversão com Pixel (compras)',
      tipo: 'conversao',
      account_id: accountId,
      campanha_config: {
        objective: 'OUTCOME_SALES',
        buying_type: 'AUCTION',
        special_ad_categories: [],
        budget_mode: 'abo',
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        status_inicial: 'PAUSED',
        agendar_meia_noite: true,
      },
      conjunto_config: {
        destination_type: 'WEBSITE',
        optimization_goal: 'OFFSITE_CONVERSIONS',
        billing_event: 'IMPRESSIONS',
        abo_daily_budget: 20.00,
        pixel_id: null,
        custom_event_type: 'PURCHASE',
        targeting: {
          geo_locations: { countries: ['BR'] },
          age_min: 18,
          age_max: 65,
        },
        placements: { automatic: false, facebook_positions: ['feed', 'reels'], instagram_positions: ['stream', 'reels'] },
      },
      criativo_config: { call_to_action_type: 'SHOP_NOW' },
      patterns: {
        campaign_name: '[{{dominio_curto}}] [Conversao] [{{utm_campaign}}]',
        adset_name: '[Conv] [{{utm_campaign}}] V{{numero}}',
        ad_name: '{{numero}}-{{utm_campaign}}-conv',
      },
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

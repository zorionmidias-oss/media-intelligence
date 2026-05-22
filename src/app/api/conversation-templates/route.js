'use strict';
const supabase = require('../../../lib/supabase');

async function handler(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('conversation_templates')
      .select('*')
      .order('criado_em', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  if (req.method === 'POST') {
    const { nome, saudacao, perguntas, acompanhamento } = req.body || {};
    if (!nome) return res.status(400).json({ error: 'nome é obrigatório' });
    const { data, error } = await supabase
      .from('conversation_templates')
      .insert({ nome, saudacao: saudacao || null, perguntas: perguntas || [], acompanhamento: acompanhamento || null })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  }

  if (req.method === 'DELETE') {
    const id = req.params?.id;
    if (!id) return res.status(400).json({ error: 'id obrigatório' });
    const { error } = await supabase.from('conversation_templates').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}

module.exports = handler;

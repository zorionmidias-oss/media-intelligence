'use strict';
const supabase = require('../../../lib/supabase');

async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('metas')
        .select('*')
        .eq('ativa', true)
        .order('tipo');
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data || []);
    }

    if (req.method === 'POST') {
      const { tipo, valor, dominio_id } = req.body || {};
      if (!tipo || valor == null) return res.status(400).json({ error: 'tipo e valor são obrigatórios' });
      // Deactivate existing meta of same type+domain before inserting
      await supabase.from('metas').update({ ativa: false })
        .eq('tipo', tipo)
        .eq('ativa', true)
        .is('dominio_id', dominio_id ?? null);
      const { data, error } = await supabase.from('metas')
        .insert({ tipo, valor: +valor, dominio_id: dominio_id ?? null })
        .select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    if (req.method === 'PUT') {
      const id = Number(req.params?.id);
      const { valor } = req.body || {};
      if (!id || valor == null) return res.status(400).json({ error: 'id e valor são obrigatórios' });
      const { data, error } = await supabase.from('metas')
        .update({ valor: +valor, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json(data);
    }

    if (req.method === 'DELETE') {
      const id = Number(req.params?.id);
      if (!id) return res.status(400).json({ error: 'id é obrigatório' });
      const { error } = await supabase.from('metas').update({ ativa: false }).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[metas]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = handler;

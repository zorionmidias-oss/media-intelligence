'use strict';
const supabase = require('../../../lib/supabase');

async function handler(req, res) {
  try {
    const { lidas, limit = 30 } = req.query;

    let q = supabase.from('notificacoes').select('*').order('created_at', { ascending: false }).limit(+limit);
    if (lidas === 'false') q = q.eq('lida', false);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  } catch (err) {
    console.error('[notificacoes]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function marcarLida(req, res) {
  try {
    const id = Number(req.params.id);
    const { error } = await supabase.from('notificacoes').update({ lida: true }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function marcarTodasLidas(req, res) {
  try {
    const { error } = await supabase.from('notificacoes').update({ lida: true }).eq('lida', false);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { handler, marcarLida, marcarTodasLidas };

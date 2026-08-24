'use strict';
// Cliente Supabase do projeto de TRAKEAMENTO (ybiibmvpmzmgfsmlrmjb) — service role.
// Fonte de leads_entrada (cid do bot) e sessões do blog. Ver [[project_trakeamento_cid]].
const { createClient } = require('@supabase/supabase-js');

const url = process.env.TRAKEAMENTO_SUPABASE_URL;
const key = process.env.TRAKEAMENTO_SERVICE_ROLE_KEY;

// Export nulo se não configurado — o sync do funil deve pular graciosamente (não derrubar o syncAll).
const supabaseTrak = (url && key) ? createClient(url, key) : null;

module.exports = supabaseTrak;

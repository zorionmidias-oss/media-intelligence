// Integração com o 2Junior's Bot (tela Estrutura): expõe SÓ page_id + adsets ativos + hora da sync.
const crypto = require('crypto');

function chaveValida(recebida, segredo) {
  if (!segredo || typeof recebida !== 'string') return false;
  const a = Buffer.from(recebida);
  const b = Buffer.from(segredo);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function paginasAtivas() {
  // require tardio: o cliente Supabase exige env no load; assim o módulo é testável offline.
  const supabase = require('./supabase');
  const { data, error } = await supabase.from('paginas').select('page_id,adsets_ativos,ultima_sync');
  if (error) throw new Error(error.message);
  return data || [];
}

// Handler da rota (fábrica p/ permitir stub de `paginasAtivas` nos testes).
function paginasAtivasHandler({ buscar = paginasAtivas, getSegredo = () => process.env.INTEGRACAO_ESTRUTURA_CHAVE || '' } = {}) {
  return async (req, res) => {
    if (!chaveValida(req.get('x-integracao-chave'), getSegredo())) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      res.json({ paginas: await buscar() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

module.exports = { chaveValida, paginasAtivas, paginasAtivasHandler };

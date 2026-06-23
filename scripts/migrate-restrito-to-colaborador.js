'use strict';
// Migra usuários com perfil legado 'restrito' para 'colaborador', espelhando o
// comportamento antigo (Overview + Campanhas em leitura; sem país/tokens/conjuntos).
// Uso: $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/migrate-restrito-to-colaborador.js
const supabase = require('../src/lib/supabase');
(async () => {
  const perms = {
    telas: { overview: 'view', campaigns: 'view' },
    dominios: { todos: true, ids: [] },
    elementos: { ver_tokens: false, ver_pais: false, criar_campanha: false, expandir_conjuntos: false, coluna_acoes: false },
  };
  const { data, error } = await supabase.from('usuarios')
    .update({ perfil: 'colaborador', permissoes: perms })
    .eq('perfil', 'restrito').select('id,email');
  console.log(error ? `ERRO: ${error.message}` : `migrados: ${(data || []).map(u => u.email).join(', ') || 'nenhum'}`);
  process.exit(error ? 1 : 0);
})();

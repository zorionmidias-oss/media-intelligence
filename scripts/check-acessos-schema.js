'use strict';
// Verifica que a migração de gestão de acessos foi aplicada.
// Uso: $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/check-acessos-schema.js
const supabase = require('../src/lib/supabase');
(async () => {
  const u = await supabase.from('usuarios').select('id,permissoes').limit(1);
  console.log('usuarios.permissoes ok?', !u.error, u.error?.message || '');
  const l = await supabase.from('acessos_log').select('id').limit(1);
  console.log('acessos_log ok?', !l.error, l.error?.message || '');
  process.exit(u.error || l.error ? 1 : 0);
})();

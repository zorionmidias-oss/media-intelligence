// scripts/check-permissions-catalog.js
'use strict';
const P = require('../src/lib/permissions');
const colaborador = { perfil: 'colaborador', permissoes: {
  telas: { overview: 'view', campaigns: 'edit' },
  dominios: { todos: false, ids: [1, 2] },
  elementos: { ver_tokens: false, ver_pais: false },
} };
const admin = { perfil: 'admin' };
const cases = [
  ['admin total',        admin,       'GET',  '/api/contas',                 true],
  ['colab overview ok',  colaborador, 'GET',  '/api/overview',               true],
  ['colab contas NEG',   colaborador, 'GET',  '/api/contas',                 false],
  ['colab camp write ok',colaborador, 'POST', '/api/meta/adset/9/toggle',    true],
  ['colab camp read-only get drilldown', colaborador, 'GET', '/api/drilldown/abc', true],
  ['colab rota nova NEG',colaborador, 'GET',  '/api/futura-rota',            false],
  ['colab notif common', colaborador, 'GET',  '/api/notificacoes',           true],
  ['colab criar_campanha NEG', colaborador, 'POST', '/api/campaigns/criar',  false],
];
let fail = 0;
for (const [nome, u, m, p, exp] of cases) {
  const got = P.checkAccess(u, m, p).allow;
  const ok = got === exp;
  if (!ok) fail++;
  console.log(`${ok ? 'OK ' : 'XX '} ${nome}: esperado=${exp} obtido=${got}`);
}
console.log('domínios colaborador:', P.allowedDomainIds(colaborador));   // [1,2]
console.log('domínios admin:', P.allowedDomainIds(admin));               // null
console.log(fail === 0 ? 'TODOS PASSARAM' : `${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);

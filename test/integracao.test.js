const { test } = require('node:test');
const assert = require('node:assert');
const { chaveValida } = require('../src/lib/integracao');

test('aceita a chave certa', () => assert.strictEqual(chaveValida('abc123', 'abc123'), true));
test('recusa chave errada do mesmo tamanho', () => assert.strictEqual(chaveValida('abc124', 'abc123'), false));
test('recusa tamanho diferente', () => assert.strictEqual(chaveValida('abc', 'abc123'), false));
test('recusa quando o segredo não está configurado', () => assert.strictEqual(chaveValida('x', ''), false));
test('recusa header ausente', () => assert.strictEqual(chaveValida(undefined, 'abc123'), false));

// Rota montada num express mínimo, com `buscar` stubado (sem rede).
const express = require('express');
const http = require('node:http');
const { paginasAtivasHandler } = require('../src/lib/integracao');

function get(handlerOpts, headers) {
  const app = express();
  app.get('/api/integracao/paginas-ativas', paginasAtivasHandler(handlerOpts));
  const srv = app.listen(0);
  return new Promise((resolve, reject) => {
    http.get({ port: srv.address().port, path: '/api/integracao/paginas-ativas', headers }, r => {
      let b = ''; r.on('data', c => b += c);
      r.on('end', () => { srv.close(); resolve({ status: r.statusCode, body: b }); });
    }).on('error', e => { srv.close(); reject(e); });
  });
}
const rows = [{ page_id: '1', adsets_ativos: 2, ultima_sync: '2026-11-24T10:00:00Z' }];

test('rota: sem chave -> 401', async () => {
  const r = await get({ buscar: async () => rows, getSegredo: () => 'segredo' }, {});
  assert.strictEqual(r.status, 401);
});
test('rota: chave errada -> 401', async () => {
  const r = await get({ buscar: async () => rows, getSegredo: () => 'segredo' }, { 'x-integracao-chave': 'errada' });
  assert.strictEqual(r.status, 401);
});
test('rota: chave certa -> 200 com paginas', async () => {
  const r = await get({ buscar: async () => rows, getSegredo: () => 'segredo' }, { 'x-integracao-chave': 'segredo' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(JSON.parse(r.body), { paginas: rows });
});
test('rota: erro na busca -> 500', async () => {
  const r = await get({ buscar: async () => { throw new Error('boom'); }, getSegredo: () => 's' }, { 'x-integracao-chave': 's' });
  assert.strictEqual(r.status, 500);
});

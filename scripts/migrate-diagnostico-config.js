'use strict';
/*
 * Cria diagnostico_config no banco do dash — pisos/thresholds EDITÁVEIS do motor de diagnóstico.
 * "Pisos editáveis por tela" (plano da repaginação): a config vive no banco, não em arquivo,
 * pra tela de Parâmetros poder alterar em runtime. Override por domínio: linha com dominio_id
 * vence a global (dominio_id null). Ver [[project_repaginacao_dash]].
 *
 * Uso: $env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/migrate-diagnostico-config.js
 */
const { Client } = require('pg');

const SQL = `
create table if not exists diagnostico_config (
  chave       text        not null,
  dominio_id  integer,                 -- null = global; linha por domínio sobrepõe a global
  valor       numeric     not null,
  descricao   text,
  updated_at  timestamptz not null default now()
);
-- unicidade por (chave, domínio) tratando null como -1 (global)
create unique index if not exists uq_diag_config on diagnostico_config (chave, coalesce(dominio_id, -1));
comment on table diagnostico_config is 'Pisos e thresholds editáveis do motor de diagnóstico (src/lib/diagnostico.js). Linha com dominio_id sobrepõe a global (dominio_id null). Editável pela tela de Parâmetros.';
`;

// Defaults globais — vindos dos mockups do Kayke (mockupsupd/). Editáveis depois pela tela.
const SEED = [
  ['piso_par',           3.00, 'PAR mínimo saudável (impressões GAM por sessão). Abaixo disso = alerta de piso mesmo sem desvio da mediana.'],
  ['desvio_amber',       0.90, 'Fator < isto (relativo à mediana 7d) pinta o nó de amarelo (atenção).'],
  ['desvio_bad',         0.75, 'Fator < isto pinta o nó de vermelho (gargalo forte).'],
  ['roi_matar',          0.20, 'Banda de veredito: ROAS < isto = matar.'],
  ['roi_ultima_chance',  0.60, 'ROAS < isto (e >= matar) = última chance até D4.'],
  ['roi_maturacao',      0.90, 'ROAS < isto = em maturação.'],
  ['roi_vivo',           1.40, 'ROAS < isto = vivo porém não escala.'],
  ['roi_bom',            2.00, 'ROAS < isto = bom (escala leve); >= isto = candidato a escala.'],
  ['volume_min_brl',    60.00, 'Gasto acumulado mínimo (BRL) para um conjunto receber veredito de ROAS. Abaixo só gatilhos de topo.'],
  ['sistemico_pct',      0.60, 'Fração dos conjuntos ativos com o mesmo gargalo para classificá-lo como SISTÊMICO (vs LOCAL).'],
  ['aproveitamento_min', 0.22, 'Aproveitamento mínimo de links do fluxo (sessões efetivas / oportunidades). Abaixo = fluxo subaproveitado.'],
  ['taxa_gam',           0.10, 'Taxa aplicada sobre a receita bruta GAM (receita líquida = bruta × (1 - taxa)).'],
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(SQL);
  for (const [chave, valor, descricao] of SEED) {
    // não sobrescreve valor já editado pelo usuário; só garante que a chave global existe
    await c.query(
      `insert into diagnostico_config (chave, dominio_id, valor, descricao)
       values ($1, null, $2, $3)
       on conflict (chave, coalesce(dominio_id, -1)) do update set descricao = excluded.descricao`,
      [chave, valor, descricao]
    );
  }
  const r = await c.query('select chave, valor from diagnostico_config where dominio_id is null order by chave');
  console.log('diagnostico_config pronta. globais:');
  for (const row of r.rows) console.log(`  ${row.chave.padEnd(20)} = ${row.valor}`);
  await c.end();
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });

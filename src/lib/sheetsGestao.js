'use strict';
// Atualiza a planilha "Gestão de páginas" (aba Páginas) com base nos dados ao vivo da Meta:
//   • QTD CONJUNTO ATIVO  ← nº de conjuntos que vão gastar hoje (lógica do KPI)
//   • ORÇAMENTO DIARIO    ← soma do orçamento (BRL) desses conjuntos
//   • Status              ← "Em uso" (≥1 conjunto) | "Disponível" (0)
// Match: token de página (2º colchete do nome do conjunto) × nome na coluna Página,
// por prefixo de palavras (escolhe o token de mais palavras p/ desambiguar).
const { google } = require('googleapis');
const { computeOrcamentoContas } = require('./orcamento');

const SS_ID = process.env.SHEET_GESTAO_ID || '1HIx10S1kGmjsposvvpdM1OMdclbm3t0Z92ERz_QzF0A';
const ABA = process.env.SHEET_GESTAO_ABA || 'Paginas';
const SA_JSON_CONTENT = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON_CONTENT;
const KEY_FILE = process.env.GOOGLE_ADM_SERVICE_ACCOUNT_JSON || './credentials/google-service-account.json';

function getSheetsClient() {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  const auth = SA_JSON_CONTENT
    ? new google.auth.GoogleAuth({ credentials: JSON.parse(SA_JSON_CONTENT), scopes })
    : new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes });
  return google.sheets({ version: 'v4', auth });
}

// Normaliza p/ comparação: maiúsculas, sem acento, ignora "(...)", só palavras.
function normWords(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')                          // remove "(...)"
    .replace(/[^A-Z0-9]+/g, ' ')                         // só alfanumérico
    .trim().split(/\s+/).filter(Boolean);
}

// Índice de coluna (0-based) → letra A1 (0→A, 26→AA).
function colLetter(i) {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

// Acha a coluna cujo header (normalizado) contém um dos termos.
function acharCol(headers, termos) {
  for (let i = 0; i < headers.length; i++) {
    const h = normWords(headers[i]).join(' ');
    if (termos.some(t => h.includes(t))) return i;
  }
  return -1;
}

// Constrói matcher: dado um nome (col Página), devolve o melhor token.
function montarMatcher(tokens) {
  // tokens ordenados por nº de palavras desc (depois comprimento) p/ priorizar match longo
  const lista = tokens
    .map(t => ({ token: t, words: normWords(t) }))
    .filter(t => t.words.length)
    .sort((a, b) => b.words.length - a.words.length || b.token.length - a.token.length);
  return (nome) => {
    const nw = normWords(nome);
    if (!nw.length) return null;
    for (const t of lista) {
      if (t.words.length <= nw.length &&
          t.words.every((w, i) => w === nw[i])) return t.token;
    }
    return null;
  };
}

// dryRun=true: calcula e devolve o relatório SEM escrever na planilha.
async function atualizarPlanilhaGestao({ dryRun = false } = {}) {
  const sheets = getSheetsClient();
  const { paginas } = await computeOrcamentoContas();

  // token → { conjuntos, orcamento_brl }
  const porToken = {};
  for (const p of paginas) porToken[p.token] = p;
  const matcher = montarMatcher(paginas.map(p => p.token));

  // Lê a aba inteira
  const range = `'${ABA}'!A1:Z2000`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SS_ID, range });
  const rows = resp.data.values || [];
  if (!rows.length) throw new Error(`Aba "${ABA}" vazia ou inexistente`);

  const headers = rows[0];
  const colPagina = acharCol(headers, ['PAGINA']);
  const colQtd    = acharCol(headers, ['CONJUNTO']);
  const colOrc    = acharCol(headers, ['ORCAMENTO']);
  const colStatus = acharCol(headers, ['STATUS']);
  if (colPagina < 0 || colQtd < 0 || colOrc < 0) {
    throw new Error(`Colunas não encontradas (pagina=${colPagina} qtd=${colQtd} orc=${colOrc}). Headers: ${headers.join(' | ')}`);
  }

  // Coluna de Observação: usa a existente, ou cria logo após a última coluna do cabeçalho.
  let colObs = acharCol(headers, ['OBSERVA']);
  const criarColObs = colObs < 0;
  if (criarColObs) colObs = headers.length;   // próxima coluna (ex.: H)

  const updates = [];   // { range, values:[[v]] }
  if (criarColObs) {
    updates.push({ range: `'${ABA}'!${colLetter(colObs)}1`, values: [['Observação']] });
  }
  const matched = [];
  const zeradas = [];   // linhas sem conjunto ativo (→ 0 / Disponível)
  const tokenUsado = {};
  const desambiguadas = [];   // linhas que perderam o token p/ um nome mais específico

  // Passo 1: token candidato por linha
  const linhas = [];
  for (let r = 1; r < rows.length; r++) {
    const nome = (rows[r][colPagina] || '').trim();
    if (!nome) continue;
    linhas.push({ linha: r + 1, nome, token: matcher(nome), specificidade: normWords(nome).length * 100 + nome.length });
  }

  // Passo 2: desambiguação — quando um token casa em >1 linha, o NOME MAIS ESPECÍFICO
  // (mais palavras, depois mais longo) fica com os conjuntos; as outras vão p/ 0/Disponível.
  const porTokenLinhas = {};
  for (const l of linhas) if (l.token) (porTokenLinhas[l.token] ||= []).push(l);
  const vencedora = {};   // token → linha vencedora
  for (const [tok, ls] of Object.entries(porTokenLinhas)) {
    vencedora[tok] = ls.slice().sort((a, b) => b.specificidade - a.specificidade)[0].linha;
  }

  // Passo 3: monta updates
  for (const l of linhas) {
    let token = l.token;
    if (token && vencedora[token] !== l.linha) { desambiguadas.push(l.nome); token = null; }
    const info = token ? porToken[token] : null;
    const conjuntos = info ? info.conjuntos : 0;
    const orcamento = info ? info.orcamento_brl : 0;
    // Status da Meta: "Em uso" | "com anomalia" (qualquer conjunto travado) | "Disponível"
    const status = info ? info.status : 'Disponível';
    const observacao = info ? (info.observacao || '') : '';

    if (token) { tokenUsado[token] = (tokenUsado[token] || 0) + 1; matched.push({ ...l, token, conjuntos, orcamento, status }); }
    else zeradas.push({ linha: l.linha, nome: l.nome });

    updates.push({ range: `'${ABA}'!${colLetter(colQtd)}${l.linha}`, values: [[`${conjuntos} CONJUNTO${conjuntos === 1 ? '' : 'S'}`]] });
    updates.push({ range: `'${ABA}'!${colLetter(colOrc)}${l.linha}`, values: [[conjuntos > 0 ? orcamento : '']] });
    if (colStatus >= 0) updates.push({ range: `'${ABA}'!${colLetter(colStatus)}${l.linha}`, values: [[status]] });
    updates.push({ range: `'${ABA}'!${colLetter(colObs)}${l.linha}`, values: [[observacao]] });
  }

  // Diagnósticos
  const tokensSemLinha = paginas.filter(p => !tokenUsado[p.token]).map(p => p.token);
  const ambiguos = Object.entries(porTokenLinhas).filter(([, ls]) => ls.length > 1).map(([t]) => t);
  const comAnomalia = matched.filter(m => m.status === 'com anomalia').map(m => m.nome);

  const relatorio = {
    aba: ABA,
    total_linhas: linhas.length,
    paginas_casadas: matched.length,
    paginas_zeradas: zeradas.length,
    com_anomalia: comAnomalia,               // ativo sem gastar → "com anomalia"
    tokens_meta: paginas.length,
    tokens_sem_linha: tokensSemLinha,        // página ativa na Meta sem linha na planilha
    tokens_ambiguos: ambiguos,               // mesmo token casou em >1 linha
    desambiguadas,                           // linhas que perderam p/ nome mais específico
    zeradas: zeradas.map(z => z.nome),       // linhas → Disponível
    dryRun,
  };

  if (!dryRun && updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SS_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: updates },
    });
  }

  return relatorio;
}

module.exports = { atualizarPlanilhaGestao };

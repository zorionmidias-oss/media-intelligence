'use strict';
// Atualiza a planilha "Gestão de páginas" (aba Páginas) com base nos dados ao vivo da Meta:
//   • QTD CONJUNTO ATIVO  ← nº de conjuntos que vão gastar hoje (lógica do KPI)
//   • ORÇAMENTO DIARIO    ← soma do orçamento (BRL) desses conjuntos
//   • Status              ← "Em uso" (≥1 conjunto) | "Disponível" (0)
// Match: token de página (2º colchete do nome do conjunto) × nome na coluna Página,
// por prefixo de palavras (escolhe o token de mais palavras p/ desambiguar).
const { google } = require('googleapis');
const { DateTime } = require('luxon');
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

// ── Dashboard "Overview" (sala de controle) ───────────────────────────────
const OV = {
  bg:'#0B0E14', panel:'#161B26', panel2:'#11161F', line:'#2A3242',
  text:'#E8ECF1', muted:'#8A93A3', faint:'#5A6373',
  menta:'#2BD4A0', ambar:'#FFB020', azul:'#4C9AFF', branco:'#FFFFFF',
};
const LEX = 'Lexend', MONO = 'Roboto Mono';
function ovHex(h){const n=h.replace('#','');return {red:parseInt(n.slice(0,2),16)/255,green:parseInt(n.slice(2,4),16)/255,blue:parseInt(n.slice(4,6),16)/255};}
function ovBorder(color=OV.line){return {style:'SOLID',color:ovHex(color)};}
function ovFmt(f={}){
  const fmt={backgroundColor:ovHex(f.bg||OV.bg),verticalAlignment:f.valign||'MIDDLE',wrapStrategy:'CLIP'};
  fmt.textFormat={fontFamily:f.font||LEX,fontSize:f.size||10,bold:!!f.bold,foregroundColor:ovHex(f.color||OV.text)};
  if(f.align)fmt.horizontalAlignment=f.align;
  fmt.padding={left:f.padL!=null?f.padL:10,right:10,top:2,bottom:2};
  if(f.currency)fmt.numberFormat={type:'CURRENCY',pattern:'"R$" #,##0.00'};
  if(f.borders)fmt.borders=f.borders;
  return fmt;
}
function ovCell(value,f={}){
  const c={userEnteredFormat:ovFmt(f)};
  if(value!==null&&value!==undefined&&value!=='') c.userEnteredValue=typeof value==='number'?{numberValue:value}:{stringValue:String(value)};
  return c;
}
// Reconstrói a aba Overview inteira com base nos agregados (dados).
async function montarOverview(sheets, sheetId, d) {
  const requests=[];
  const reqs=(rowIndex,colIndex,cells)=>requests.push({updateCells:{rows:[{values:cells}],fields:'userEnteredValue,userEnteredFormat',start:{sheetId,rowIndex,columnIndex:colIndex}}});
  const merge=(r1,c1,r2,c2)=>requests.push({mergeCells:{mergeType:'MERGE_ALL',range:{sheetId,startRowIndex:r1,endRowIndex:r2,startColumnIndex:c1,endColumnIndex:c2}}});
  const blank=(n,bg=OV.bg)=>Array.from({length:n},()=>ovCell('',{bg}));
  const rowH=(r,px)=>requests.push({updateDimensionProperties:{range:{sheetId,dimension:'ROWS',startIndex:r,endIndex:r+1},properties:{pixelSize:px},fields:'pixelSize'}});

  requests.push({updateSheetProperties:{properties:{sheetId,gridProperties:{hideGridlines:true}},fields:'gridProperties.hideGridlines'}});
  requests.push({updateDimensionProperties:{range:{sheetId,dimension:'COLUMNS',startIndex:0,endIndex:1},properties:{pixelSize:22},fields:'pixelSize'}});
  requests.push({updateDimensionProperties:{range:{sheetId,dimension:'COLUMNS',startIndex:1,endIndex:9},properties:{pixelSize:230},fields:'pixelSize'}});
  requests.push({updateDimensionProperties:{range:{sheetId,dimension:'COLUMNS',startIndex:9,endIndex:10},properties:{pixelSize:22},fields:'pixelSize'}});
  requests.push({unmergeCells:{range:{sheetId,startRowIndex:0,endRowIndex:120,startColumnIndex:0,endColumnIndex:14}}});
  requests.push({repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:200,startColumnIndex:0,endColumnIndex:40},cell:{},fields:'userEnteredValue,userEnteredFormat'}});
  requests.push({repeatCell:{range:{sheetId,startRowIndex:0,endRowIndex:120,startColumnIndex:0,endColumnIndex:40},cell:{userEnteredFormat:{backgroundColor:ovHex(OV.bg)}},fields:'userEnteredFormat.backgroundColor'}});

  let R=1;
  // cabeçalho
  reqs(R,1,[ovCell('GESTÃO DE PÁGINAS',{font:LEX,size:22,bold:true,color:OV.branco}),...blank(7)]); merge(R,1,R+1,9); rowH(R,42); R++;
  reqs(R,1,[ovCell('Visão geral da operação · Relacionamento',{color:OV.muted,size:11,borders:{bottom:ovBorder()}}),...Array.from({length:3},()=>ovCell('',{borders:{bottom:ovBorder()}})),ovCell('atualizado '+d.atualizado,{color:OV.faint,size:10,align:'RIGHT',borders:{bottom:ovBorder()}}),...Array.from({length:3},()=>ovCell('',{borders:{bottom:ovBorder()}}))]);
  merge(R,1,R+1,5); merge(R,5,R+1,9); R++; R++;

  // Helper: faixa de 4 cards (2 colunas cada)
  const cardBand = (labels, nums, colors, subs, numSize, curr) => {
    const sep=i=>(i%2===1&&i<7);
    const lc=[],nc=[],sc=[];
    for(let i=0;i<8;i++){const card=Math.floor(i/2),L=i%2===0;
      const bl={top:ovBorder()}; if(sep(i))bl.right=ovBorder(OV.bg);
      lc.push(ovCell(L?labels[card]:'',{bg:OV.panel,color:OV.muted,size:9,bold:true,borders:bl}));
      const bn={}; if(sep(i))bn.right=ovBorder(OV.bg);
      nc.push(ovCell(L?nums[card]:'',{bg:OV.panel,color:colors[card],size:numSize,bold:true,font:MONO,align:'LEFT',currency:!!(curr&&curr[card]),borders:Object.keys(bn).length?bn:undefined}));
      const bs={bottom:ovBorder()}; if(sep(i))bs.right=ovBorder(OV.bg);
      sc.push(ovCell(L?subs[card]:'',{bg:OV.panel,color:OV.faint,size:9,borders:bs}));}
    const r0=R; reqs(R,1,lc); R++; reqs(R,1,nc); R++; reqs(R,1,sc); R++;
    for(let c=0;c<4;c++){merge(r0,1+c*2,r0+1,3+c*2);merge(r0+1,1+c*2,r0+2,3+c*2);merge(r0+2,1+c*2,r0+3,3+c*2);}
    rowH(r0+1,46); R++;
  };

  // KPIs
  cardBand(
    ['FROTA','EM USO','ANOMALIA','DISPONÍVEL'],
    [d.total,d.emUso,d.anomalia,d.disponivel],
    [OV.branco,OV.menta,OV.ambar,OV.azul],
    [`${d.total} páginas`,`${d.pctUso}% da frota`,`R$ ${d.parado.toFixed(2).replace('.',',')} parado`,'ociosas'],
    30
  );

  // Métricas financeiras (4 cards)
  const ativas = d.emUso + d.anomalia;
  const media = ativas ? d.orcamento/ativas : 0;
  cardBand(
    ['ORÇAMENTO DIÁRIO','PARADO · ANOMALIA','CONJUNTOS ATIVOS','MÉDIA / PÁGINA'],
    [d.orcamento, d.parado, d.conjuntos, media],
    [OV.menta, OV.ambar, OV.branco, OV.azul],
    ['ativo · vai gastar hoje', `${d.anomalia} páginas afetadas`, `em ${ativas} páginas`, 'orçamento ÷ ativas'],
    22,
    [true,true,false,true]
  );
  R++;

  const secTitle=(t,a=OV.menta)=>{reqs(R,1,[ovCell(t,{color:a,size:11,bold:true,borders:{bottom:ovBorder()}}),...Array.from({length:7},()=>ovCell('',{borders:{bottom:ovBorder()}}))]);merge(R,1,R+1,9);R++;};
  const tHead=(cols,orcFrom)=>{const cs=[];for(let i=0;i<8;i++)cs.push(ovCell(cols[i]||'',{color:OV.muted,size:9,bold:true,align:i===0?'LEFT':'RIGHT'}));reqs(R,1,cs);if(orcFrom)merge(R,orcFrom,R+1,9);R++;};

  // POR PAÍS
  secTitle('POR PAÍS');
  tHead(['PAÍS','PÁGINAS','EM USO','ANOMALIA','CONJUNTOS','ORÇAMENTO','',''],6);
  d.paisArr.forEach((p,idx)=>{const bg=idx%2===0?OV.panel2:OV.bg;
    reqs(R,1,[ovCell(p.pais,{bg,color:OV.text,bold:true,size:11}),ovCell(p.paginas,{bg,color:OV.text,font:MONO,align:'RIGHT'}),ovCell(p.emUso,{bg,color:OV.menta,font:MONO,align:'RIGHT'}),ovCell(p.anomalia,{bg,color:p.anomalia>0?OV.ambar:OV.faint,font:MONO,align:'RIGHT'}),ovCell(p.conjuntos,{bg,color:OV.text,font:MONO,align:'RIGHT'}),ovCell(p.orcamento,{bg,color:OV.text,font:MONO,align:'RIGHT',currency:true}),ovCell('',{bg}),ovCell('',{bg})]);
    merge(R,6,R+1,9);R++;}); R++;

  // POR NICHO
  secTitle('POR NICHO');
  tHead(['NICHO','','','PÁGINAS','','ORÇAMENTO','',''],6);
  d.nichoArr.forEach((n,idx)=>{const bg=idx%2===0?OV.panel2:OV.bg;
    reqs(R,1,[ovCell(n.nicho,{bg,color:OV.text,bold:true,size:11}),ovCell('',{bg}),ovCell('',{bg}),ovCell(n.paginas,{bg,color:OV.text,font:MONO,align:'RIGHT'}),ovCell('',{bg}),ovCell(n.orcamento,{bg,color:OV.text,font:MONO,align:'RIGHT',currency:true}),ovCell('',{bg}),ovCell('',{bg})]);
    merge(R,1,R+1,4);merge(R,6,R+1,9);R++;}); R++;

  // ANOMALIA
  secTitle('⚠ EXIGEM ATENÇÃO · ANOMALIA',OV.ambar);
  tHead(['PÁGINA','','PAÍS','OBSERVAÇÃO','','','','']);
  if(!d.anomalias.length){reqs(R,1,[ovCell('Nenhuma anomalia agora — tudo gastando normalmente.',{color:OV.faint,size:10}),...blank(7)]);merge(R,1,R+1,9);R++;}
  else d.anomalias.forEach((a,idx)=>{const bg=idx%2===0?OV.panel2:OV.bg;
    reqs(R,1,[ovCell(a.nome,{bg,color:OV.text,bold:true,size:11,borders:{left:ovBorder(OV.ambar)}}),ovCell('',{bg}),ovCell(a.pais,{bg,color:OV.muted,font:MONO,align:'CENTER'}),ovCell(a.obs,{bg,color:OV.ambar,size:10}),...Array.from({length:4},()=>ovCell('',{bg}))]);
    merge(R,1,R+1,3);merge(R,4,R+1,9);R++;});

  await sheets.spreadsheets.batchUpdate({spreadsheetId:SS_ID,requestBody:{requests}});
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
  const colNicho  = acharCol(headers, ['NICHO']);
  const colPais   = acharCol(headers, ['PAIS']);
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

  // Passo 1: token candidato por linha (+ nicho/país p/ a Overview)
  const linhas = [];
  for (let r = 1; r < rows.length; r++) {
    const nome = (rows[r][colPagina] || '').trim();
    if (!nome) continue;
    const nicho = colNicho >= 0 ? ((rows[r][colNicho] || '—').trim() || '—') : '—';
    const pais  = colPais  >= 0 ? ((rows[r][colPais]  || '—').trim() || '—') : '—';
    linhas.push({ linha: r + 1, nome, nicho, pais, token: matcher(nome), specificidade: normWords(nome).length * 100 + nome.length });
  }

  // Passo 2: desambiguação — quando um token casa em >1 linha, o NOME MAIS ESPECÍFICO
  // (mais palavras, depois mais longo) fica com os conjuntos; as outras vão p/ 0/Disponível.
  const porTokenLinhas = {};
  for (const l of linhas) if (l.token) (porTokenLinhas[l.token] ||= []).push(l);
  const vencedora = {};   // token → linha vencedora
  for (const [tok, ls] of Object.entries(porTokenLinhas)) {
    vencedora[tok] = ls.slice().sort((a, b) => b.specificidade - a.specificidade)[0].linha;
  }

  // Agregadores p/ a Overview
  const ag = { total:0, emUso:0, anomalia:0, disponivel:0, conjuntos:0, orcamento:0, parado:0 };
  const porPais = {}; const porNicho = {}; const anomalias = [];

  // Passo 3: monta updates
  for (const l of linhas) {
    let token = l.token;
    if (token && vencedora[token] !== l.linha) { desambiguadas.push(l.nome); token = null; }
    const info = token ? porToken[token] : null;
    const conjuntos = info ? info.conjuntos : 0;
    const orcamento = info ? info.orcamento_brl : 0;
    const parado = info ? (info.parado_brl || 0) : 0;
    // Status da Meta: "Em uso" | "com anomalia" (qualquer conjunto travado) | "Disponível"
    const status = info ? info.status : 'Disponível';
    const observacao = info ? (info.observacao || '') : '';

    if (token) { tokenUsado[token] = (tokenUsado[token] || 0) + 1; matched.push({ ...l, token, conjuntos, orcamento, status }); }
    else zeradas.push({ linha: l.linha, nome: l.nome });

    // agrega
    ag.total++; ag.conjuntos += conjuntos; ag.orcamento += orcamento; ag.parado += parado;
    if (status === 'Em uso') ag.emUso++; else if (status === 'com anomalia') ag.anomalia++; else ag.disponivel++;
    const P = porPais[l.pais] || (porPais[l.pais] = { pais:l.pais, paginas:0, emUso:0, anomalia:0, conjuntos:0, orcamento:0 });
    P.paginas++; P.conjuntos += conjuntos; P.orcamento += orcamento;
    if (status === 'Em uso') P.emUso++; else if (status === 'com anomalia') P.anomalia++;
    const N = porNicho[l.nicho] || (porNicho[l.nicho] = { nicho:l.nicho, paginas:0, orcamento:0 });
    N.paginas++; N.orcamento += orcamento;
    if (status === 'com anomalia') anomalias.push({ nome:l.nome, pais:l.pais, obs:observacao });

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

    // Reconstrói o dashboard "Overview" com os agregados
    try {
      const dados = {
        ...ag,
        pctUso: ag.total ? Math.round((ag.emUso / ag.total) * 100) : 0,
        paisArr: Object.values(porPais).sort((a, b) => b.orcamento - a.orcamento),
        nichoArr: Object.values(porNicho).sort((a, b) => b.orcamento - a.orcamento),
        anomalias: anomalias.sort((a, b) => (b.obs > a.obs ? 1 : -1)),
        atualizado: DateTime.now().setZone('America/Sao_Paulo').toFormat("dd/MM/yyyy 'às' HH:mm"),
      };
      const meta = await sheets.spreadsheets.get({ spreadsheetId: SS_ID, fields: 'sheets.properties(sheetId,title)' });
      const ov = (meta.data.sheets || []).find(s => s.properties.title === 'Overview');
      if (ov) await montarOverview(sheets, ov.properties.sheetId, dados);
    } catch (e) {
      console.warn('[sheets] Overview falhou:', e.message);
    }
  }

  relatorio.overview = { conjuntos: ag.conjuntos, orcamento: +ag.orcamento.toFixed(2), parado: +ag.parado.toFixed(2) };
  return relatorio;
}

module.exports = { atualizarPlanilhaGestao };

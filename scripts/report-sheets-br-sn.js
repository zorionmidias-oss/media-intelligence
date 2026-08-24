require('dotenv').config({path:'.env.local'});
const supabase = require('../src/lib/supabase');
const { google } = require('googleapis');
const KEYFILE = './credentials/google-service-account.json';
const SHARE_WITH = 'kaykepicao@gmail.com';

const periods = {
  'Hoje (22/06)': ['2026-06-22','2026-06-22'],
  'Ontem (21/06)': ['2026-06-21','2026-06-21'],
  'Últimos 3 dias (20-22/06)': ['2026-06-20','2026-06-22'],
  'Últimos 7 dias (16-22/06)': ['2026-06-16','2026-06-22'],
};
const countries = {BR:'Brasil', SN:'Senegal'};
const n=(x)=>Number(x||0);
function agg(rows){
  const o={gasto:0,fbruto:0,freal:0,lucro:0,resultado:0,conversas:0,sessoes:0,cliques:0,imp:0,cliquesgam:0,orc:0,utms:new Set()};
  for(const r of rows){o.gasto+=n(r.valor_gasto);o.fbruto+=n(r.faturamento_bruto);o.freal+=n(r.faturamento_real);o.lucro+=n(r.lucro);o.resultado+=n(r.resultado);o.conversas+=n(r.conversas_meta);o.sessoes+=n(r.sessoes_meta);o.cliques+=n(r.cliques);o.imp+=n(r.impressoes_gam);o.cliquesgam+=n(r.cliques_gam);o.orc+=n(r.orcamento_total);o.utms.add(r.ad_utm);}
  o.roas=o.gasto?o.freal/o.gasto:0;o.ecpm=o.imp?o.fbruto/o.imp*1000:0;o.cpc=o.cliques?o.gasto/o.cliques:0;o.cpr=o.resultado?o.gasto/o.resultado:0;o.rps=o.sessoes?o.freal/o.sessoes:0;o.ctrgam=o.imp?o.cliquesgam/o.imp*100:0;o.nutms=o.utms.size;
  return o;
}
const r2=(x)=>Math.round(n(x)*100)/100;
const HEAD=['Período','Campanha','Gasto R$','Fat. Bruto','Fat. Líquido','Lucro R$','ROAS','Resultados','Conversas','Sessões','Cliques Meta','CPC R$','Custo/Result.','Impr. GAM','eCPM','RPS','Cliques GAM','CTR GAM %','Orçamento','UTMs'];
function row(per,name,a){return [per,name,r2(a.gasto),r2(a.fbruto),r2(a.freal),r2(a.lucro),r2(a.roas),r2(a.resultado),r2(a.conversas),r2(a.sessoes),a.cliques,r2(a.cpc),r2(a.cpr),a.imp,r2(a.ecpm),r2(a.rps),a.cliquesgam,r2(a.ctrgam),r2(a.orc),a.nutms];}

(async()=>{
  // build per-country rows
  const tabs={};
  for(const [sig,cname] of Object.entries(countries)){
    const rows=[HEAD];
    for(const [pname,[d1,d2]] of Object.entries(periods)){
      const {data,error}=await supabase.from('ads_consolidados').select('*').eq('pais_sigla',sig).gte('data',d1).lte('data',d2).limit(5000);
      if(error)throw error;
      const byCamp={};
      for(const r of data){const k=r.campanha_meta||'(sem campanha)';(byCamp[k]=byCamp[k]||[]).push(r);}
      const camps=Object.entries(byCamp).map(([k,rs])=>[k,agg(rs)]).sort((a,b)=>b[1].gasto-a[1].gasto);
      rows.push(row(pname,'�w TOTAL '+pname,agg(data)));
      for(const [k,a] of camps) rows.push(row(pname,k,a));
      rows.push(new Array(HEAD.length).fill(''));
    }
    tabs[cname]=rows;
  }

  // auth sheets+drive
  const auth=new google.auth.GoogleAuth({keyFile:KEYFILE,scopes:['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive']});
  const client=await auth.getClient();
  const sheets=google.sheets({version:'v4',auth:client});
  const drive=google.drive({version:'v3',auth:client});

  const create=await sheets.spreadsheets.create({requestBody:{properties:{title:'Análise Campanhas BR & Senegal — 22/06/2026'},sheets:Object.keys(tabs).map((t,i)=>({properties:{title:t,index:i}}))}});
  const ssId=create.data.spreadsheetId;
  const url=create.data.spreadsheetUrl;

  for(const [t,rows] of Object.entries(tabs)){
    await sheets.spreadsheets.values.update({spreadsheetId:ssId,range:`'${t}'!A1`,valueInputOption:'RAW',requestBody:{values:rows}});
  }
  // share
  await drive.permissions.create({fileId:ssId,sendNotificationEmail:true,requestBody:{type:'user',role:'writer',emailAddress:SHARE_WITH}});
  console.log('OK_URL='+url);
})().catch(e=>{console.error('FAIL:',e.errors?JSON.stringify(e.errors):e.message);process.exit(1);});

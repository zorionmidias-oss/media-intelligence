'use strict';
// Print da tabela Campanhas com DADOS REAIS (de _shots/real-camp.json), dark.
const http=require('http'),fs=require('fs'),path=require('path');
const { chromium }=require('playwright');
const ROOT=path.join(__dirname,'..','public');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.map':'application/json'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/dashboard.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){res.statusCode=404;res.end('404');return;}res.setHeader('Content-Type',MIME[path.extname(p)]||'application/octet-stream');res.end(d);});});
const OUT=path.join(__dirname,'..','_shots');
const camp=JSON.parse(fs.readFileSync(path.join(OUT,'real-camp.json'),'utf8'));

const lastBracket=s=>{const m=String(s||'').match(/\[([^\]]*)\]\s*$/);return m?m[1].trim():s;};
const estr=s=>{const m=String(s||'').match(/\[(E\d+)\]/);return m?m[1]:'';};
const ROWS=camp.campanhas.filter(c=>c.campaign_id).sort((a,b)=>b.gasto-a.gasto).slice(0,12).map(c=>({
  ad_utm:lastBracket(c.campaign_name),campaign_id:c.campaign_id,dominio:'',pagina:'',
  valor_gasto:c.gasto,faturamento_real:c.receita_liq,lucro:+(c.receita_liq-c.gasto).toFixed(2),roas:c.roas,
  cpc:0,custo_resultado:0,resultado:c.results,impressoes_gam:c.imp_gam,ecpm:0,rps:0,
  sessoes:c.sessoes,par:0,sessao_por_conversa:null,breakeven:c.gasto>0?c.gasto/(c.receita_liq||1):null,
  data_inicio:'',estrutura:estr(c.campaign_name),campanha_meta:c.campaign_name,
}));
const DIAG={};camp.campanhas.forEach(c=>{if(c.campaign_id)DIAG[c.campaign_id]=c;});

(async()=>{
  await new Promise(r=>server.listen(8127,r));
  const browser=await chromium.launch({channel:'chrome'});
  const page=await browser.newPage({viewport:{width:2100,height:760}});
  await page.goto('http://localhost:8127/dashboard.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForTimeout(1200);
  await page.evaluate(({rows,diag})=>{
    document.documentElement.setAttribute('data-theme','dark');
    const ov=document.getElementById('loading-overlay');if(ov)ov.remove();
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('on'));
    document.getElementById('tab-campaigns').classList.add('on');
    S.diagByCamp=diag;S.campRows=rows;renderCampTable(rows);
  },{rows:ROWS,diag:DIAG});
  await page.waitForTimeout(400);
  const tbl=await page.$('#camp-table');
  await tbl.screenshot({path:path.join(OUT,'camp-real.png')});
  console.log('saved camp-real.png');
  await browser.close();server.close();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});

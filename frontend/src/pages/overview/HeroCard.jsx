import { useState } from 'react';
import { BRL, PCT, NUM, DDMM } from '../../lib/format.js';

// Formatadores por tipo de valor (mesmos de frontend/src/lib/format.js).
const FMT = { money: BRL, pct: (n) => PCT(n, 1), num: NUM };

// Limites verticais do viewBox 0..100 usados tanto pelas barras quanto pelo hover
// (mesma escala — porta yT/yB de metricSVG()/hoverCard() de overview-v3.html).
const Y_TOP = 12, Y_BOTTOM = 86;

// Barras normalizadas (min/max da série) em viewBox 0..100 — porta metricSVG(series,'barras') de overview-v3.html.
function bars(vals) {
  const n = vals.length;
  if (n === 0) return [];
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const sp = mx - mn || 1;
  const bw = (100 / n) * 0.6;
  return vals.map((v, i) => {
    const x = n > 1 ? (100 * i) / (n - 1) : 50;
    const y = Y_BOTTOM - ((v - mn) / sp) * (Y_BOTTOM - Y_TOP);
    return { x: x - bw / 2, y, w: bw, h: 100 - y };
  });
}

/**
 * Card principal (herói) de KPI: número grande + gráfico de barras + delta (▲/▼) + pico/mín/méd.
 * Porta `.pcard`/`.region`/`.pbig`/`.pfoot` de overview-v3.html (accent via `tone`, sem hex fixo).
 *
 * @param {string} label - título do card (ex.: "Receita")
 * @param {number} value - valor atual (bruto, não formatado)
 * @param {number|null} deltaPct - variação vs. período anterior (null quando não há base de comparação)
 * @param {number[]} trend - série diária (mesma unidade de `value`) usada nas barras e no pico/mín/méd
 * @param {string[]} dates - datas (ISO, `trend[].date`) casadas 1:1 com `trend`, usadas no tooltip de hover
 * @param {'money'|'pct'|'num'} fmt - formato do valor grande e das estatísticas do rodapé
 * @param {'pos'|'neg'} tone - cor de destaque (barras/gradiente/seta do delta)
 * @param {'%'|'pts'} deltaUnit - unidade do delta (ROI usa pontos percentuais, o resto usa % relativo)
 */
export default function HeroCard({ label, value, deltaPct, trend = [], dates = [], fmt = 'money', tone = 'pos', deltaUnit = '%' }) {
  const format = FMT[fmt] || BRL;
  const accent = tone === 'neg' ? 'var(--neg)' : 'var(--pos)';
  const hasTrend = trend.length > 0;
  const b = bars(trend);
  const n = trend.length;

  const pico = hasTrend ? Math.max(...trend) : null;
  const minV = hasTrend ? Math.min(...trend) : null;
  const media = hasTrend ? trend.reduce((a, v) => a + v, 0) / trend.length : null;

  const up = deltaPct != null && deltaPct >= 0;
  const deltaTxt = deltaPct == null
    ? '—'
    : deltaUnit === 'pts'
      ? `${PCT(Math.abs(deltaPct), 1).replace('%', '')} pts`
      : PCT(Math.abs(deltaPct), 1);

  // Hover (crosshair + ponto + tooltip) — porta hoverCard(region,series,fmt) de
  // overview-v3.html: cursor x → índice mais próximo → valor/data da série real.
  const [hoverIdx, setHoverIdx] = useState(null);
  const mn = hasTrend ? Math.min(...trend) : 0;
  const mx = hasTrend ? Math.max(...trend) : 0;
  const sp = mx - mn || 1;

  function handleMove(e) {
    if (!hasTrend) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const fr = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(fr * (n - 1)));
  }
  function handleLeave() {
    setHoverIdx(null);
  }

  const hover = hoverIdx != null && hasTrend
    ? {
        fx: n > 1 ? (100 * hoverIdx) / (n - 1) : 50,
        fy: Y_BOTTOM - ((trend[hoverIdx] - mn) / sp) * (Y_BOTTOM - Y_TOP),
      }
    : null;

  return (
    <div className="pcard">
      <div className={`region${hover ? ' hov' : ''}`} onMouseMove={handleMove} onMouseLeave={handleLeave}>
        <div className="grad" style={{ background: `linear-gradient(to left, color-mix(in srgb, ${accent} 15%, transparent), transparent 72%)` }} />
        <div className="dots" style={{ color: `color-mix(in srgb, var(--fg2) 22%, transparent)` }} />
        <svg className="pchart" viewBox="0 0 100 100" preserveAspectRatio="none">
          {b.map((bar, i) => (
            <rect key={i} className="pbar" x={bar.x} y={bar.y} width={bar.w} height={Math.max(bar.h, 0)} rx="0.6" style={{ fill: accent }} />
          ))}
        </svg>
        {hover && (
          <>
            <div className="hcross" style={{ left: `${hover.fx}%`, background: accent }} />
            <div className="hdot" style={{ left: `${hover.fx}%`, top: `${hover.fy}%`, background: accent }} />
            <div className="htip" style={{ left: `${Math.max(16, Math.min(84, hover.fx))}%`, top: `${hover.fy}%` }}>
              <b>{format(trend[hoverIdx])}</b>
              <span>{DDMM(dates[hoverIdx])}</span>
            </div>
          </>
        )}
      </div>

      <div className="pcontent">
        <div className="phead">
          <div className="pleft"><h3>{label}</h3></div>
          <div className="pright">
            <span className={`ptrend ${deltaPct == null ? '' : up ? 'pos' : 'neg'}`}>
              {deltaPct != null ? (up ? '▲' : '▼') : ''} {deltaTxt}
            </span>
            <span className="pperiod">{trend.length} dias</span>
          </div>
        </div>
        <div className="pbig">{format(value)}</div>
      </div>

      <div className="pfoot">
        <span className="pstats">
          {hasTrend ? <><b>{format(pico)}</b> pico · <b>{format(minV)}</b> mín · <b>{format(media)}</b> méd</> : '—'}
        </span>
      </div>
    </div>
  );
}

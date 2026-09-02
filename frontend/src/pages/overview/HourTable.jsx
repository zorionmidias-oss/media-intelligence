import { useState } from 'react';
import { useApi } from '../../hooks/useApi.js';
import { HourLines } from '../../design-system/Chart.jsx';
import { BRL, PCT, NUM, filterQs } from '../../lib/format.js';

// Dinheiro com 2 casas (mesmo padrão de Overview.jsx — R$ 0,00).
const money = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',');
// Número simples com 1 casa (PAR).
const num1 = (n) => (Number(n) || 0).toFixed(1).replace('.', ',');

// Métricas do toggle — mesma lista/ordem de .superpowers/brainstorm/.../overview-v3.html (MET)
// e do /api/intraday (src/app/api/intraday/route.js): cada objeto por hora traz todas essas chaves.
const HOUR_METRICS = [
  { key: 'receita', label: 'Receita', fmt: BRL },
  { key: 'investimento', label: 'Investimento', fmt: BRL },
  { key: 'roi', label: 'ROI', fmt: (v) => PCT(v, 1) },
  { key: 'ecpm', label: 'eCPM', fmt: money },
  { key: 'impressoes', label: 'Impressões', fmt: NUM },
  { key: 'sessoes', label: 'Sessões', fmt: NUM },
  { key: 'resultado', label: 'Resultado', fmt: NUM },
  { key: 'conversas', label: 'Conversas', fmt: NUM },
  { key: 'custo_resultado', label: 'Custo/Result', fmt: money },
  { key: 'par', label: 'PAR', fmt: num1 },
];

/**
 * Performance por hora (intraday) — Hoje (sólido, menta) vs Ontem (tracejado, cinza),
 * com toggle de métrica (pills) e marcador "agora Xh". Porta o painel #iv-* de
 * overview-v3.html (linhas ~145-149, ~218-242), sem o toggle de estilo linhas/barras/área
 * (fora do escopo desta task — só o modo "linhas" do protótipo).
 *
 * Consome `GET /api/intraday` (2ª fonte de dados, separada de /api/overview). Recebe
 * period/domain do App (mesmos filtros globais); domain refiltra o hoje/ontem no backend,
 * since/until vão na querystring por consistência mas a janela do intraday é sempre
 * hoje vs. ontem (o endpoint os ignora — ver src/app/api/intraday/route.js).
 */
export default function HourTable({ period, domain }) {
  const [metric, setMetric] = useState('receita');
  const qs = filterQs({ since: period?.since, until: period?.until, domain });
  const { data, loading, error } = useApi(`/intraday${qs}`, [period?.since, period?.until, domain]);

  const curMetric = HOUR_METRICS.find((m) => m.key === metric) || HOUR_METRICS[0];
  const horaAtual = data?.hora_atual;

  return (
    <div className="panel iv-panel">
      <div className="ph">
        <h3>Performance por hora</h3>
        <div className="sub">
          {horaAtual != null && <>hoje até {String(horaAtual).padStart(2, '0')}h · Brasília &nbsp;·&nbsp; </>}
          <span className="iv-hoje">Hoje</span> vs <span className="iv-ontem">Ontem</span>
        </div>
      </div>

      <div className="ivbar">
        {HOUR_METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`pill ${metric === m.key ? 'on' : ''}`}
            onClick={() => setMetric(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading && <div className="ov-skel iv-skel" />}

      {!loading && error && <p className="ov-error">Erro ao carregar: {error}</p>}

      {!loading && !error && data?.sem_dados && (
        <div className="iv-empty">Sem dados intraday para hoje ainda.</div>
      )}

      {!loading && !error && data && !data.sem_dados && (
        <HourLines
          hoje={data.hoje || []}
          ontem={data.ontem || []}
          metricKey={curMetric.key}
          color="var(--rev)"
          nowHour={horaAtual}
          valueFormatter={curMetric.fmt}
        />
      )}
    </div>
  );
}

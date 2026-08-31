// Galeria de primitivos do design system — só para validação por screenshot (?demo=1).
import { useState } from 'react';
import { GlassCard, Segment, ThemeToggle, Gauge, KpiCard, GlassTable } from './index.js';

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--fg-3)', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

export default function Demo() {
  const [seg, setSeg] = useState('14d');
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 32 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.03em', marginBottom: 24 }}>Design System · Primitivos</h1>

      <Section title="GlassCard">
        <GlassCard style={{ padding: 20, width: 220 }}>Cartão de vidro padrão</GlassCard>
        <GlassCard hover style={{ padding: 20, width: 220 }}>Cartão com hover (lift)</GlassCard>
      </Section>

      <Section title="Segment">
        <Segment
          options={[{ value: '7d', label: '7d' }, { value: '14d', label: '14d' }, { value: '30d', label: '30d' }]}
          value={seg}
          onChange={setSeg}
        />
      </Section>

      <Section title="ThemeToggle">
        <ThemeToggle />
      </Section>

      <Section title="Gauge">
        <GlassCard style={{ padding: 20 }}>
          <Gauge value={0.69} cap="Saudável · custo/sessão ÷ RPS" />
        </GlassCard>
      </Section>

      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--fg-3)', marginBottom: 12 }}>KpiCard</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 28 }}>
        <KpiCard label="Investimento Meta" value="R$ 12.480" delta="6,2%" deltaTone="up" spark={[20, 18, 19, 14, 15, 11, 12, 7, 9]} />
        <KpiCard label="Receita GAM (líq.)" value="R$ 21.350" delta="9,8%" deltaTone="up" tone="pos" spark={[21, 19, 16, 17, 12, 13, 8, 9, 5]} />
        <KpiCard label="Lucro líquido" value="R$ 8.870" delta="14,1%" deltaTone="up" tone="pos" spark={[22, 20, 21, 15, 16, 10, 11, 6, 4]} />
        <KpiCard label="ROI" value="71,1%" delta="3,4 pts" deltaTone="up" spark={[17, 18, 15, 16, 13, 14, 11, 12, 9]} />
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--fg-3)', marginBottom: 12 }}>GlassTable</div>
      <GlassTable
        title="Top campanhas"
        columns={[
          { key: 'camp', label: 'Campanha' },
          { key: 'pais', label: 'País' },
          { key: 'gasto', label: 'Gasto', align: 'right', render: (r) => <span className="num">{r.gasto}</span> },
          { key: 'rec', label: 'Receita', align: 'right', render: (r) => <span className="num">{r.rec}</span> },
          { key: 'roi', label: 'ROI', align: 'right', render: (r) => <span className={`num ${r.pos ? 'pos' : 'neg'}`}>{r.roi}</span> },
        ]}
        rows={[
          { camp: 'E1 · khanyisafb', pais: '🇿🇦 ZA', gasto: 'R$ 3.210', rec: 'R$ 6.480', roi: '+102%', pos: true },
          { camp: 'E2 · yetundefb', pais: '🇳🇬 NG', gasto: 'R$ 2.740', rec: 'R$ 4.120', roi: '+50%', pos: true },
          { camp: 'E1 · amarafb', pais: '🇰🇪 KE', gasto: 'R$ 1.980', rec: 'R$ 2.610', roi: '+32%', pos: true },
          { camp: 'E3 · kwamefb', pais: '🇬🇭 GH', gasto: 'R$ 1.640', rec: 'R$ 1.510', roi: '−8%', pos: false },
        ]}
      />
    </div>
  );
}

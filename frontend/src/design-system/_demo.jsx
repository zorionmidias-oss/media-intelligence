// Galeria de primitivos do design system — só para validação por screenshot (?demo=1).
import { useState } from 'react';
import { GlassCard, Segment, ThemeToggle, Gauge } from './index.js';

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
    </div>
  );
}

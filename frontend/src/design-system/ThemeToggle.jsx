import { useTheme } from '../theme/ThemeProvider';

// Botão ☾/☀ — alterna claro/escuro via ThemeProvider.
export default function ThemeToggle() {
  const { mode, toggle } = useTheme();
  return (
    <button className="ds-icbtn" onClick={toggle} title="Claro / Escuro" aria-label="Alternar tema">
      {mode === 'dark' ? '☾' : '☀'}
    </button>
  );
}

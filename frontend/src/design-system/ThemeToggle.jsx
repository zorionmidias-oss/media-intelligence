import { useEffect, useState } from 'react';

const KEY = 'mi-theme';

// Lê o tema já aplicado no <html> por main.jsx (ou localStorage, se por algum motivo
// rodar antes disso) — evita re-derivar e descasar do que já está na tela.
function initialTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
}

// Alterna Escuro/Claro — escreve data-theme no <html> direto e persiste em localStorage.
// Não depende do ThemeProvider legado (design-system antigo, atributo [data-mode]).
export default function ThemeToggle() {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  return (
    <div className="flt-theme-seg" role="group" aria-label="Tema">
      <button type="button" className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>Escuro</button>
      <button type="button" className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>Claro</button>
    </div>
  );
}

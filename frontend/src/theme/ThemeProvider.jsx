import { createContext, useContext, useEffect, useState } from 'react';

const KEY = 'app-theme';
const Ctx = createContext(null);

function initialMode() {
  const saved = localStorage.getItem(KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  // Padrão do produto = escuro (só muda quando o usuário alterna e a escolha persiste).
  return 'dark';
}

export default function ThemeProvider({ children }) {
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    document.documentElement.setAttribute('data-mode', mode);
    localStorage.setItem(KEY, mode);
  }, [mode]);

  const toggle = () => setMode((m) => (m === 'dark' ? 'light' : 'dark'));

  return <Ctx.Provider value={{ mode, setMode, toggle }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

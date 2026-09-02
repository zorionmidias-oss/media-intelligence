import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import './theme/tokens.css'
import './styles/base.css'

// Tema (Black & Menta, tokens novos em theme/tokens.css) — lido do localStorage antes do
// primeiro paint pra não piscar o tema errado. Padrão do produto = escuro. Escrito aqui e
// pelo Filters/ThemeToggle (design-system/ThemeToggle.jsx), que não depende mais do
// ThemeProvider legado (esse só existia para o design system antigo, chave [data-mode]).
const savedTheme = localStorage.getItem('mi-theme')
document.documentElement.setAttribute('data-theme', savedTheme === 'light' ? 'light' : 'dark')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

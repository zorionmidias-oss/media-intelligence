import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ThemeProvider from './theme/ThemeProvider.jsx'
import './index.css'
import './theme/tokens.css'
import './styles/base.css'

// Tema padrão do produto = Black & Menta escuro (tokens novos em theme/tokens.css).
document.documentElement.setAttribute('data-theme', 'dark')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
)

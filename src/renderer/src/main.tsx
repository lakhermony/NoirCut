import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initTauriBridgeIfNeeded } from './lib/tauri-bridge'

initTauriBridgeIfNeeded()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

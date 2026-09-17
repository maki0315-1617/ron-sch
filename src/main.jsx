import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // 旧バージョンで登録された、ページを制御しないFCM専用SW(iOSでプッシュ配信が不安定になる原因)を解除する
    navigator.serviceWorker.getRegistration('/firebase-cloud-messaging-push-scope').then((old) => {
      if (old) old.unregister().catch(() => {})
    }).catch(() => {})

    navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.error('Service Worker の登録に失敗しました:', error)
    })
  })
}
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

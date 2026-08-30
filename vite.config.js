import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase/firestore')) return 'vendor-firebase-db'
            if (id.includes('firebase/messaging')) return 'vendor-firebase-msg'
            if (id.includes('firebase')) return 'vendor-firebase'
            if (id.includes('lucide-react')) return 'vendor-icons'
            if (id.includes('react') || id.includes('react-dom')) return 'vendor-react'
            return 'vendor'
          }
        }
      }
    }
  }
})
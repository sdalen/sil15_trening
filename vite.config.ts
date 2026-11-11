import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Relativ base: fungerer både lokalt og på GitHub Pages (https://<bruker>.github.io/<repo>/)
  base: './',
  plugins: [react(), tailwindcss()],
})

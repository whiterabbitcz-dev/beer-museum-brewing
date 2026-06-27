import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages: web běží na .../beer-museum-brewing/ → base musí sedět na název repa.
// https://vite.dev/config/
export default defineConfig({
  base: '/beer-museum-brewing/',
  plugins: [react()],
})

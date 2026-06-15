import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base: './' keeps asset URLs relative, so the same build works on Vercel,
// Netlify, and GitHub Pages project sites (served under /<repo>/) without
// needing to hard-code a repository name. See README for details.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})

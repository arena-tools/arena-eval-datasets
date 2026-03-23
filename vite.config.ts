import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-dataset-manifest',
      writeBundle() {
        const manifestSrc = path.join(__dirname, 'datasets', 'src', 'manifest.json')
        const destDir = path.join(__dirname, 'dist', 'datasets', 'src')
        if (fs.existsSync(manifestSrc)) {
          fs.mkdirSync(destDir, { recursive: true })
          fs.copyFileSync(manifestSrc, path.join(destDir, 'manifest.json'))
        }
      },
      configureServer(server) {
        server.middlewares.use('/datasets', (req, res, next) => {
          const filePath = path.join(__dirname, 'datasets', req.url || '')
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Content-Type', 'application/json')
            fs.createReadStream(filePath).pipe(res)
          } else {
            next()
          }
        })
      }
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    open: false,
  }
})

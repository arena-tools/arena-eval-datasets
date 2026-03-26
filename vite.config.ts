import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const DATASETS_DIR = path.join(__dirname, 'datasets', 'schematic_rule_check')

/** Scan for CSV files and build a manifest */
function buildManifest() {
  if (!fs.existsSync(DATASETS_DIR)) return { datasets: [] }
  const files = fs.readdirSync(DATASETS_DIR).filter(name => name.endsWith('.csv'))
  const datasets = files.map(file => ({
    filename: file,
    prefix: file.replace(/\.csv$/, ''),
  }))
  return { datasets }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'generate-dataset-manifest',
      writeBundle() {
        const manifest = buildManifest()
        const destDir = path.join(__dirname, 'dist', 'datasets', 'schematic_rule_check')
        fs.mkdirSync(destDir, { recursive: true })
        fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
      },
      configureServer(server) {
        server.middlewares.use('/datasets/schematic_rule_check/manifest.json', (_req, res) => {
          const manifest = buildManifest()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(manifest, null, 2))
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

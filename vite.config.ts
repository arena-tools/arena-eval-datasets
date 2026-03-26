import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const DATASETS_DIR = path.join(__dirname, 'datasets', 'schematic_rule_check')

/** Scan board directories and build a manifest from their metadata.json files */
function buildManifest() {
  if (!fs.existsSync(DATASETS_DIR)) return { datasets: [] }
  const dirs = fs.readdirSync(DATASETS_DIR).filter(name => {
    const dir = path.join(DATASETS_DIR, name)
    return fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'metadata.json'))
  })
  const datasets = dirs.map(dir => {
    const meta = JSON.parse(fs.readFileSync(path.join(DATASETS_DIR, dir, 'metadata.json'), 'utf-8'))
    return {
      boardId: meta.boardId,
      directory: dir,
      datasetNamePrefix: meta.datasetNamePrefix,
      description: meta.description,
      author: meta.author,
    }
  })
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
        // Serve a live-generated manifest during dev
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

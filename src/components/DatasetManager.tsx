import { useState, useRef, useCallback, useEffect } from 'react'
import { convertAll, DatasetOutput } from '../converters/srcDatasetConverters'
import './DatasetManager.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UploadHistoryEntry {
  uploadedAt: string
  commitHash: string
  datasets: { name: string; datasetName: string; itemCount: number }[]
}

interface ManifestEntry {
  boardId: string
  directory: string
  datasetNamePrefix: string
  description?: string
  author?: string
  uploadHistory: UploadHistoryEntry[]
}

interface Manifest {
  datasets: ManifestEntry[]
  generatedAt: string
}

interface WorkflowRun {
  id: number
  status: string
  conclusion: string | null
  html_url: string
  created_at: string
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

const GITHUB_API = 'https://api.github.com'

function getGitHubConfig() {
  const owner = (import.meta.env.VITE_GITHUB_OWNER as string) || ''
  const repo = (import.meta.env.VITE_GITHUB_REPO as string) || ''
  return { owner, repo }
}

async function githubRequest(
  pat: string,
  method: string,
  endpoint: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${GITHUB_API}${endpoint}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${pat}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // not JSON
  }

  return { ok: res.ok, status: res.status, data }
}

async function commitFiles(
  pat: string,
  owner: string,
  repo: string,
  files: { path: string; content: string }[],
  message: string,
  branch: string = 'main',
  maxRetries: number = 3,
): Promise<void> {
  const treeEntries = []
  for (const file of files) {
    const blobRes = await githubRequest(pat, 'POST', `/repos/${owner}/${repo}/git/blobs`, {
      content: btoa(unescape(encodeURIComponent(file.content))),
      encoding: 'base64',
    })
    if (!blobRes.ok) throw new Error(`Failed to create blob for ${file.path}: ${blobRes.status}`)
    treeEntries.push({
      path: file.path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha: (blobRes.data as { sha: string }).sha,
    })
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const refRes = await githubRequest(pat, 'GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`)
    if (!refRes.ok) throw new Error(`Failed to get branch ref: ${refRes.status}`)
    const currentSha = (refRes.data as { object: { sha: string } }).object.sha

    const commitRes = await githubRequest(pat, 'GET', `/repos/${owner}/${repo}/git/commits/${currentSha}`)
    if (!commitRes.ok) throw new Error(`Failed to get commit: ${commitRes.status}`)
    const treeSha = (commitRes.data as { tree: { sha: string } }).tree.sha

    const newTreeRes = await githubRequest(pat, 'POST', `/repos/${owner}/${repo}/git/trees`, {
      base_tree: treeSha,
      tree: treeEntries,
    })
    if (!newTreeRes.ok) throw new Error(`Failed to create tree: ${newTreeRes.status}`)
    const newTreeSha = (newTreeRes.data as { sha: string }).sha

    const newCommitRes = await githubRequest(pat, 'POST', `/repos/${owner}/${repo}/git/commits`, {
      message,
      tree: newTreeSha,
      parents: [currentSha],
    })
    if (!newCommitRes.ok) throw new Error(`Failed to create commit: ${newCommitRes.status}`)
    const newCommitSha = (newCommitRes.data as { sha: string }).sha

    const updateRes = await githubRequest(pat, 'PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      sha: newCommitSha,
    })

    if (updateRes.ok) return

    const errMsg = (updateRes.data as { message?: string })?.message || ''
    if (updateRes.status === 422 && errMsg.includes('not a fast forward') && attempt < maxRetries - 1) {
      console.warn(`Branch moved during commit (attempt ${attempt + 1}/${maxRetries}), retrying...`)
      continue
    }

    throw new Error(`Failed to update branch: ${updateRes.status} ${errMsg}`)
  }
}

async function triggerWorkflowDispatch(
  pat: string,
  owner: string,
  repo: string,
  boardId: string,
  dryRun: boolean = false,
): Promise<void> {
  const res = await githubRequest(
    pat,
    'POST',
    `/repos/${owner}/${repo}/actions/workflows/upload-datasets.yml/dispatches`,
    {
      ref: 'main',
      inputs: {
        board_id: boardId,
        dry_run: String(dryRun),
      },
    },
  )
  if (!res.ok) throw new Error(`Failed to trigger workflow: ${res.status} ${JSON.stringify(res.data)}`)
}

async function getLatestWorkflowRun(
  pat: string,
  owner: string,
  repo: string,
): Promise<WorkflowRun | null> {
  const res = await githubRequest(
    pat,
    'GET',
    `/repos/${owner}/${repo}/actions/workflows/upload-datasets.yml/runs?per_page=1`,
  )
  if (!res.ok) return null
  const runs = (res.data as { workflow_runs: WorkflowRun[] }).workflow_runs
  return runs[0] || null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DatasetManager() {
  // Auth — GitHub
  const [pat, setPat] = useState(() => localStorage.getItem('github_pat') || '')
  const [patValid, setPatValid] = useState(false)

  // Tabs
  const [activeTab, setActiveTab] = useState<'datasets' | 'upload'>('datasets')

  // Manifest / dataset list
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [manifestLoading, setManifestLoading] = useState(true)

  // Expanded boards (to show version list)
  const [expandedBoards, setExpandedBoards] = useState<Set<string>>(new Set())

  // Upload form
  const [file, setFile] = useState<File | null>(null)
  const [boardId, setBoardId] = useState('')
  const [datasetPrefix, setDatasetPrefix] = useState('')
  const [description, setDescription] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preview
  const [preview, setPreview] = useState<DatasetOutput[] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  // Status
  const [submitting, setSubmitting] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null)
  const [workflowRun, setWorkflowRun] = useState<WorkflowRun | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // GitHub config
  const { owner, repo } = getGitHubConfig()

  // ── Load manifest ──
  useEffect(() => {
    loadManifest()
  }, [])

  async function loadManifest() {
    setManifestLoading(true)
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}datasets/schematic_rule_check/manifest.json`)
      if (res.ok) {
        setManifest(await res.json())
      } else {
        if (pat && owner && repo) {
          const ghRes = await githubRequest(pat, 'GET', `/repos/${owner}/${repo}/contents/datasets/schematic_rule_check/manifest.json`)
          if (ghRes.ok) {
            const content = atob((ghRes.data as { content: string }).content.replace(/\n/g, ''))
            setManifest(JSON.parse(content))
          }
        }
      }
    } catch {
      // manifest not available
    } finally {
      setManifestLoading(false)
    }
  }

  // ── Validate PAT ──
  useEffect(() => {
    if (!pat) {
      setPatValid(false)
      return
    }
    localStorage.setItem('github_pat', pat)
    let cancelled = false
    ;(async () => {
      try {
        const res = await githubRequest(pat, 'GET', '/user')
        if (!cancelled) setPatValid(res.ok)
      } catch {
        if (!cancelled) setPatValid(false)
      }
    })()
    return () => { cancelled = true }
  }, [pat])

  // ── Toggle board expansion ──
  function toggleBoard(directory: string) {
    setExpandedBoards(prev => {
      const next = new Set(prev)
      if (next.has(directory)) next.delete(directory)
      else next.add(directory)
      return next
    })
  }

  // ── File handling ──
  const acceptFile = useCallback((f: File) => {
    setFile(f)
    setPreview(null)
    setPreviewError(null)
    setStatusMsg(null)

    f.text().then(text => {
      try {
        if (!boardId.trim()) {
          setPreviewError('Enter a Board ID to preview conversion')
          return
        }
        const results = convertAll(text, boardId.trim())
        setPreview(results)
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : 'Preview failed')
      }
    })
  }, [boardId])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) {
      if (!dropped.name.endsWith('.csv')) {
        setPreviewError('Please drop a CSV file')
        return
      }
      acceptFile(dropped)
    }
  }, [acceptFile])

  // Re-preview when boardId changes
  useEffect(() => {
    if (!file || !boardId.trim()) return
    file.text().then(text => {
      try {
        const results = convertAll(text, boardId.trim())
        setPreview(results)
        setPreviewError(null)
      } catch (err) {
        setPreviewError(err instanceof Error ? err.message : 'Preview failed')
        setPreview(null)
      }
    })
  }, [boardId, file])

  // ── Submit: commit to GitHub + trigger workflow ──
  async function handleSubmit() {
    if (!pat || !patValid) {
      setStatusMsg({ type: 'error', text: 'Please enter a valid GitHub PAT' })
      return
    }
    if (!owner || !repo) {
      setStatusMsg({ type: 'error', text: 'GitHub repo not configured (VITE_GITHUB_OWNER / VITE_GITHUB_REPO)' })
      return
    }
    if (!file || !boardId.trim() || !datasetPrefix.trim()) {
      setStatusMsg({ type: 'error', text: 'Please fill in all required fields' })
      return
    }

    setSubmitting(true)
    setStatusMsg({ type: 'info', text: 'Committing files to repository...' })

    try {
      const csvContent = await file.text()
      const metadata: Record<string, unknown> = {
        boardId: boardId.trim(),
        datasetNamePrefix: datasetPrefix.trim(),
        description: description.trim() || undefined,
        createdAt: new Date().toISOString(),
      }

      const dirName = boardId.trim()
      const files = [
        { path: `datasets/schematic_rule_check/${dirName}/src-eval.csv`, content: csvContent },
        { path: `datasets/schematic_rule_check/${dirName}/metadata.json`, content: JSON.stringify(metadata, null, 2) + '\n' },
      ]

      await commitFiles(pat, owner, repo, files, `feat: add SRC eval dataset for board ${boardId.trim()}`)

      setStatusMsg({ type: 'info', text: 'Committed. Upload workflow triggered automatically. Polling for status...' })

      startPolling()
    } catch (err) {
      setStatusMsg({ type: 'error', text: err instanceof Error ? err.message : 'Commit failed' })
    } finally {
      setSubmitting(false)
    }
  }

  // ── Re-upload: trigger workflow_dispatch ──
  async function handleReUpload(boardDir: string) {
    if (!pat || !patValid || !owner || !repo) return

    setStatusMsg({ type: 'info', text: `Triggering re-upload for ${boardDir}...` })
    try {
      await triggerWorkflowDispatch(pat, owner, repo, boardDir)
      setStatusMsg({ type: 'info', text: 'Workflow dispatched. Polling for status...' })
      startPolling()
    } catch (err) {
      setStatusMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to trigger workflow' })
    }
  }

  // ── Poll workflow runs ──
  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current)

    const poll = async () => {
      if (!pat || !owner || !repo) return
      const run = await getLatestWorkflowRun(pat, owner, repo)
      if (run) {
        setWorkflowRun(run)
        if (run.status === 'completed') {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          if (run.conclusion === 'success') {
            setStatusMsg({ type: 'success', text: 'Upload workflow completed successfully!' })
            loadManifest()
          } else {
            setStatusMsg({ type: 'error', text: `Workflow finished with conclusion: ${run.conclusion}` })
          }
        }
      }
    }

    poll()
    pollRef.current = setInterval(poll, 5000)
  }

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // ── Render ──
  return (
    <div className="dataset-manager">
      <div className="dm-header">
        <h2>Dataset Manager</h2>
        <p>Manage SRC eval datasets — commit to Git, auto-upload to Langfuse via GitHub Actions</p>
      </div>

      {/* Auth bar */}
      <div className="dm-auth-bar">
        <label>GitHub PAT:</label>
        <input
          type="password"
          value={pat}
          onChange={e => setPat(e.target.value)}
          placeholder="ghp_..."
        />
        <span className={`dm-auth-status ${patValid ? 'connected' : 'disconnected'}`}>
          {patValid ? 'Connected' : pat ? 'Invalid' : 'Not set'}
        </span>
        {owner && repo && (
          <span style={{ fontSize: '0.75rem', color: '#868e96' }}>{owner}/{repo}</span>
        )}
      </div>

      {/* Tabs */}
      <div className="dm-tabs">
        <button className={`dm-tab ${activeTab === 'datasets' ? 'active' : ''}`} onClick={() => setActiveTab('datasets')}>
          Datasets {manifest ? `(${manifest.datasets.length})` : ''}
        </button>
        <button className={`dm-tab ${activeTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveTab('upload')}>
          Upload New
        </button>
      </div>

      {/* Status messages */}
      {statusMsg && (
        <div className={`dm-status-msg ${statusMsg.type}`}>{statusMsg.text}</div>
      )}
      {workflowRun && workflowRun.status !== 'completed' && (
        <div className="dm-workflow-status">
          <div className="dm-spinner" />
          <span>Workflow running...</span>
          <a href={workflowRun.html_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem' }}>View on GitHub</a>
        </div>
      )}

      <div className="dm-content">
        {/* ── Datasets Tab ── */}
        {activeTab === 'datasets' && (
          <>
            {manifestLoading ? (
              <div className="dm-empty"><p>Loading...</p></div>
            ) : !manifest || manifest.datasets.length === 0 ? (
              <div className="dm-empty">
                <p>No datasets found.</p>
                <p>Upload your first SRC eval dataset to get started.</p>
                <button className="dm-btn dm-btn-primary" onClick={() => setActiveTab('upload')}>
                  Upload New
                </button>
              </div>
            ) : (
              <div className="dm-dataset-list">
                {manifest.datasets.map(entry => {
                  const history = entry.uploadHistory || []
                  const isExpanded = expandedBoards.has(entry.directory)

                  return (
                    <div key={entry.directory} className="dm-dataset-card">
                      <div className="dm-dataset-row" onClick={() => history.length > 0 && toggleBoard(entry.directory)} style={{ cursor: history.length > 0 ? 'pointer' : 'default' }}>
                        <div className="dm-dataset-info">
                          <div className="dm-dataset-title">
                            {history.length > 0 && (
                              <span className="dm-expand-icon">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                            )}
                            {entry.boardId}
                          </div>
                          <div className="dm-dataset-meta">
                            <span>Prefix: {entry.datasetNamePrefix}</span>
                            {entry.description && <span>{entry.description}</span>}
                            {entry.author && <span>by {entry.author}</span>}
                            <span>{history.length} version{history.length !== 1 ? 's' : ''}</span>
                          </div>
                        </div>
                        <div className="dm-dataset-status">
                          <span className={`dm-status-badge ${history.length > 0 ? 'success' : 'never'}`}>
                            {history.length > 0 ? 'Uploaded' : 'Never uploaded'}
                          </span>
                          {patValid && (
                            <button
                              className="dm-btn dm-btn-secondary"
                              onClick={e => { e.stopPropagation(); handleReUpload(entry.directory) }}
                            >
                              Re-upload
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Version history */}
                      {isExpanded && history.length > 0 && (
                        <div className="dm-version-list">
                          <div className="dm-version-header">
                            <span>Commit</span>
                            <span>Uploaded</span>
                            <span>Datasets</span>
                          </div>
                          {[...history].reverse().map((h, i) => (
                            <div key={`${h.commitHash}-${i}`} className="dm-version-row">
                              <span className="dm-version-hash">
                                <code>{h.commitHash}</code>
                              </span>
                              <span className="dm-version-date">
                                {new Date(h.uploadedAt).toLocaleDateString()}{' '}
                                {new Date(h.uploadedAt).toLocaleTimeString()}
                              </span>
                              <span className="dm-version-datasets">
                                {h.datasets.map(d => (
                                  <span key={d.datasetName} className="dm-version-ds-tag" title={d.datasetName}>
                                    {d.name}: {d.itemCount}
                                  </span>
                                ))}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ── Upload New Tab ── */}
        {activeTab === 'upload' && (
          <div className="dm-upload-section">
            <div className="dm-upload-form">
              {/* CSV File */}
              <div className="dm-form-group">
                <label>SRC Eval Dataset CSV <span className="required">*</span></label>
                {file ? (
                  <div className="dm-file-badge">
                    <span>{file.name}</span>
                    <button onClick={() => { setFile(null); setPreview(null); setPreviewError(null) }}>&times;</button>
                  </div>
                ) : (
                  <div
                    className={`dm-drop-zone ${dragActive ? 'drag-active' : ''}`}
                    onDrop={handleDrop}
                    onDragOver={e => { e.preventDefault(); setDragActive(true) }}
                    onDragLeave={e => { e.preventDefault(); setDragActive(false) }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <p>{dragActive ? 'Drop here' : 'Drag & drop CSV or click to browse'}</p>
                    <p className="hint">SRC eval dataset CSV file</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={e => { const f = e.target.files?.[0]; if (f) acceptFile(f) }}
                  style={{ display: 'none' }}
                />
              </div>

              {/* Board ID */}
              <div className="dm-form-group">
                <label>Board ID <span className="required">*</span></label>
                <input
                  type="text"
                  value={boardId}
                  onChange={e => setBoardId(e.target.value)}
                  placeholder="e.g. 139-4947"
                />
              </div>

              {/* Dataset Name Prefix */}
              <div className="dm-form-group">
                <label>Dataset Name Prefix <span className="required">*</span></label>
                <input
                  type="text"
                  value={datasetPrefix}
                  onChange={e => setDatasetPrefix(e.target.value)}
                  placeholder="e.g. tida-global-rules"
                />
              </div>

              {/* Description */}
              <div className="dm-form-group">
                <label>Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Global rules for TIDA-010933 power supply"
                />
              </div>

              {/* Preview */}
              {previewError && <div className="dm-status-msg error">{previewError}</div>}
              {preview && (
                <div className="dm-preview">
                  <h4>Conversion Preview</h4>
                  <div className="dm-preview-datasets">
                    {preview.map(ds => (
                      <div key={ds.name} className="dm-preview-card">
                        <div className="dm-preview-card-title">
                          {ds.name} {'\u2192'} {datasetPrefix}-{ds.name}
                        </div>
                        <div className="dm-preview-card-count">{ds.rows.length} items</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Submit */}
              <div className="dm-submit-area">
                <button
                  className="dm-submit-btn"
                  onClick={handleSubmit}
                  disabled={submitting || !file || !boardId.trim() || !datasetPrefix.trim() || !patValid}
                >
                  {submitting ? 'Committing...' : 'Commit & Upload'}
                </button>
                <span style={{ fontSize: '0.75rem', color: '#868e96' }}>
                  Commits to {owner}/{repo} and triggers the upload workflow
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

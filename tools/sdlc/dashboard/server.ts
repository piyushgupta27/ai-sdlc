/**
 * Dashboard server at localhost:3001.
 *
 * v1: zero-dependency HTTP server using node:http + node:fs.
 *
 * Routes:
 *   GET  /                       — home: project list + pending gates
 *   GET  /projects/<slug>        — project detail (mirror of `pnpm sdlc status`)
 *   GET  /queue                  — all pending HITL gates across projects
 *   GET  /queue/<gate-id>        — gate detail + response form
 *   POST /api/queue/<gate-id>    — record a response (form submit)
 *   GET  /static/styles.css      — minimal CSS
 *   GET  /healthz                — health check (returns "ok\n")
 *
 * v1.5+ may upgrade to Next.js for richer UI (analytics, charts).
 * For v1 the dashboard's job is small: surface the queue + let the
 * user respond to G2 gates. Plain HTML is enough.
 *
 * Security: binds to 127.0.0.1 only. Not accessible from network.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import { join } from 'node:path'
import { checkResponse, listPending, recordResponse } from '../orchestrator/hitl-queue.js'
import { listProjects, projectDir, readState } from '../orchestrator/state.js'
import { type HITLResponse, asProjectSlug } from '../types/index.js'
import {
  STYLES_CSS,
  renderError,
  renderGateDetail,
  renderHome,
  renderProjectDetail,
  renderQueue,
} from './views.js'

const PORT = 3001
const HOST = '127.0.0.1'

/**
 * Start the server. Returns a stop function.
 */
export function startServer(opts: { port?: number; host?: string } = {}): {
  readonly stop: () => Promise<void>
  readonly url: string
} {
  const port = opts.port ?? PORT
  const host = opts.host ?? HOST
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((cause) => {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(renderError('Internal error', String(cause)))
    })
  })

  server.listen(port, host)

  return {
    url: `http://${host}:${port}`,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      }),
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? '/'
  const method = req.method ?? 'GET'

  // Static assets
  if (url === '/static/styles.css') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/css; charset=utf-8')
    res.end(STYLES_CSS)
    return
  }

  // Health check
  if (url === '/healthz') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('ok\n')
    return
  }

  // API: record gate response
  if (method === 'POST' && url.startsWith('/api/queue/')) {
    const gateId = decodeURIComponent(url.slice('/api/queue/'.length))
    await handleGateResponse(req, res, gateId)
    return
  }

  // GET /queue/<id>
  if (method === 'GET' && url.startsWith('/queue/')) {
    const gateId = decodeURIComponent(url.slice('/queue/'.length))
    await handleGateDetail(res, gateId)
    return
  }

  // GET /queue
  if (method === 'GET' && url === '/queue') {
    await handleQueue(res)
    return
  }

  // GET /projects/<slug>
  if (method === 'GET' && url.startsWith('/projects/')) {
    const slug = decodeURIComponent(url.slice('/projects/'.length))
    await handleProjectDetail(res, slug)
    return
  }

  // GET / (home)
  if (method === 'GET' && url === '/') {
    await handleHome(res)
    return
  }

  res.statusCode = 404
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(renderError('Not found', `No route for ${method} ${url}`))
}

// ─── route handlers ──────────────────────────────────────────────────────

async function handleHome(res: ServerResponse): Promise<void> {
  const projects = await listProjects()
  if (!projects.ok) {
    res.statusCode = 500
    res.end(renderError('Failed to list projects', projects.error.message))
    return
  }

  const rows: ProjectRow[] = []
  for (const slug of projects.value) {
    const state = await readState(slug)
    if (!state.ok || state.value === null) continue
    const repoPath = await readRepoPath(slug)
    let pendingCount = 0
    if (repoPath && existsSync(repoPath)) {
      const pending = await listPending(repoPath)
      if (pending.ok) pendingCount = pending.value.length
    }
    rows.push({
      slug,
      trustState: state.value.trustState,
      readinessScore: state.value.readinessScore,
      inFlightCount: state.value.inFlightTaskIds.length,
      pendingGates: pendingCount,
    })
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(renderHome(rows))
}

async function handleProjectDetail(res: ServerResponse, slug: string): Promise<void> {
  const projectSlug = asProjectSlug(slug)
  const state = await readState(projectSlug)
  if (!state.ok) {
    res.statusCode = 500
    res.end(renderError('Failed to read state', state.error.message))
    return
  }
  if (state.value === null) {
    res.statusCode = 404
    res.end(renderError('Not onboarded', `Project ${slug} has no state.json`))
    return
  }

  const repoPath = await readRepoPath(projectSlug)
  let pending: import('../types/index.js').HITLRequest[] = []
  if (repoPath && existsSync(repoPath)) {
    const result = await listPending(repoPath)
    if (result.ok) pending = [...result.value]
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(
    renderProjectDetail({
      state: state.value,
      repoPath: repoPath ?? '(unknown)',
      pendingGates: pending,
    }),
  )
}

async function handleQueue(res: ServerResponse): Promise<void> {
  const projects = await listProjects()
  if (!projects.ok) {
    res.statusCode = 500
    res.end(renderError('Failed to list projects', projects.error.message))
    return
  }

  const allGates: Array<{ project: string; gate: import('../types/index.js').HITLRequest }> = []
  for (const slug of projects.value) {
    const repoPath = await readRepoPath(slug)
    if (!repoPath || !existsSync(repoPath)) continue
    const pending = await listPending(repoPath)
    if (!pending.ok) continue
    for (const gate of pending.value) {
      allGates.push({ project: slug, gate })
    }
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(renderQueue(allGates))
}

async function handleGateDetail(res: ServerResponse, gateId: string): Promise<void> {
  // Find which project owns this gate (linear scan; v1 scale)
  const projects = await listProjects()
  if (!projects.ok) {
    res.statusCode = 500
    res.end(renderError('Failed to list projects', projects.error.message))
    return
  }

  for (const slug of projects.value) {
    const repoPath = await readRepoPath(slug)
    if (!repoPath || !existsSync(repoPath)) continue
    const pending = await listPending(repoPath)
    if (!pending.ok) continue
    const gate = pending.value.find((g) => g.id === gateId)
    if (gate) {
      const response = await checkResponse(repoPath, gateId)
      const existingResponse = response.ok ? response.value : null
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(renderGateDetail({ project: slug, gate, existingResponse }))
      return
    }
  }

  res.statusCode = 404
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(renderError('Gate not found', `No pending gate with id ${gateId}`))
}

async function handleGateResponse(
  req: IncomingMessage,
  res: ServerResponse,
  gateId: string,
): Promise<void> {
  // Read POST body
  const body = await readBody(req)
  const params = new URLSearchParams(body)
  const decision = params.get('decision') as HITLResponse['decision'] | null
  const comment = params.get('comment') ?? undefined
  const approvalToken = params.get('approvalToken') ?? undefined

  if (!decision) {
    res.statusCode = 400
    res.end(renderError('Bad request', 'Missing decision field'))
    return
  }

  // Find the gate's project (same scan as handleGateDetail)
  const projects = await listProjects()
  if (!projects.ok) {
    res.statusCode = 500
    res.end(renderError('Failed to list projects', projects.error.message))
    return
  }

  for (const slug of projects.value) {
    const repoPath = await readRepoPath(slug)
    if (!repoPath || !existsSync(repoPath)) continue
    const pending = await listPending(repoPath)
    if (!pending.ok) continue
    if (!pending.value.find((g) => g.id === gateId)) continue

    const response: HITLResponse = {
      gateId,
      decision,
      respondedAt: new Date().toISOString(),
      ...(comment ? { comment } : {}),
      ...(approvalToken ? { approvalToken } : {}),
    }
    const writeResult = await recordResponse(repoPath, response)
    if (!writeResult.ok) {
      res.statusCode = 500
      res.end(renderError('Failed to record response', writeResult.error.message))
      return
    }

    // Redirect back to /queue
    res.statusCode = 303
    res.setHeader('Location', '/queue')
    res.end()
    return
  }

  res.statusCode = 404
  res.end(renderError('Gate not found', `No pending gate with id ${gateId}`))
}

// ─── helpers ─────────────────────────────────────────────────────────────

interface ProjectRow {
  readonly slug: string
  readonly trustState: string
  readonly readinessScore: number
  readonly inFlightCount: number
  readonly pendingGates: number
}

async function readRepoPath(slug: import('../types/index.js').ProjectSlug): Promise<string | null> {
  const cfgPath = join(projectDir(slug), 'config.json')
  if (!existsSync(cfgPath)) return null
  try {
    const raw = await readFile(cfgPath, 'utf8')
    const cfg = JSON.parse(raw) as { repoPath?: string }
    return cfg.repoPath ?? null
  } catch {
    return null
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

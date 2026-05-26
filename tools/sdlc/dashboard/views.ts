/**
 * Dashboard HTML rendering — template strings, no JSX, no framework.
 *
 * Aesthetic: monospace, dark theme by default (terminal-adjacent),
 * minimal chrome. Functional > pretty for v1.
 */

import type { HITLRequest, HITLResponse, ProjectState } from '../types/index.js'

/**
 * Escape user-supplied content to avoid HTML injection. v1 dashboard is
 * local-only but we still escape; cheap insurance.
 */
function esc(s: string | undefined | null): string {
  if (s == null) return ''
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ai-sdlc</title>
<link rel="stylesheet" href="/static/styles.css">
</head>
<body>
<header>
  <a href="/" class="brand">ai-sdlc</a>
  <nav>
    <a href="/">Home</a>
    <a href="/queue">Queue</a>
  </nav>
</header>
<main>
${body}
</main>
<footer>
  <a href="https://github.com/piyushgupta27/ai-sdlc">github.com/piyushgupta27/ai-sdlc</a>
</footer>
</body>
</html>`
}

export function renderHome(
  rows: ReadonlyArray<{
    readonly slug: string
    readonly trustState: string
    readonly readinessScore: number
    readonly inFlightCount: number
    readonly pendingGates: number
  }>,
): string {
  const totalPending = rows.reduce((a, r) => a + r.pendingGates, 0)
  const totalInFlight = rows.reduce((a, r) => a + r.inFlightCount, 0)

  const rowsHtml = rows
    .map(
      (r) => `
    <tr>
      <td><a href="/projects/${esc(r.slug)}">${esc(r.slug)}</a></td>
      <td>${esc(r.trustState)}</td>
      <td>${r.readinessScore}%</td>
      <td>${r.inFlightCount}</td>
      <td>${r.pendingGates > 0 ? `<span class="pending">${r.pendingGates}</span>` : '0'}</td>
    </tr>`,
    )
    .join('')

  return layout(
    'Home',
    `
<section class="summary">
  <h1>ai-sdlc dashboard</h1>
  <p class="muted">${rows.length} projects · ${totalInFlight} in-flight · ${totalPending} pending HITL gates · last activity (audit log)</p>
</section>

${rows.length === 0 ? '<p>No projects onboarded yet. Run <code>pnpm sdlc onboard --slug &lt;name&gt; --repo &lt;path&gt;</code>.</p>' : ''}

<section>
  <h2>Projects</h2>
  <table>
    <thead>
      <tr><th>Project</th><th>Trust state</th><th>Readiness</th><th>In-flight</th><th>HITL</th></tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</section>
`,
  )
}

export function renderProjectDetail(opts: {
  readonly state: ProjectState
  readonly repoPath: string
  readonly pendingGates: readonly HITLRequest[]
}): string {
  const s = opts.state
  const gatesHtml =
    opts.pendingGates.length === 0
      ? '<p class="muted">No pending gates.</p>'
      : `<ul>${opts.pendingGates
          .map(
            (g) =>
              `<li><a href="/queue/${esc(g.id)}">${esc(g.gate)} — ${esc(g.summary)}</a> <span class="muted">${esc(g.id)}</span></li>`,
          )
          .join('')}</ul>`

  return layout(
    s.slug,
    `
<section class="summary">
  <h1>${esc(s.slug)}</h1>
  <p class="muted">Repo: <code>${esc(opts.repoPath)}</code></p>
</section>

<section>
  <h2>State</h2>
  <dl>
    <dt>Trust state</dt><dd>${esc(s.trustState)}</dd>
    <dt>Readiness</dt><dd>${s.readinessScore}/100 (context=${s.readinessBreakdown.context} testing=${s.readinessBreakdown.testing} cicd=${s.readinessBreakdown.cicd})</dd>
    <dt>In-flight tasks</dt><dd>${s.inFlightTaskIds.length} ${s.inFlightTaskIds.length > 0 ? `(${esc(s.inFlightTaskIds.join(', '))})` : ''}</dd>
    <dt>Defect rate 7d</dt><dd>${(s.defectRate7d * 100).toFixed(1)}%</dd>
    <dt>Last readiness check</dt><dd>${esc(s.lastReadinessCheck)}</dd>
  </dl>
</section>

<section>
  <h2>Pending HITL gates</h2>
  ${gatesHtml}
</section>
`,
  )
}

export function renderQueue(items: ReadonlyArray<{ project: string; gate: HITLRequest }>): string {
  const rowsHtml =
    items.length === 0
      ? '<p class="muted">Queue empty. All clear.</p>'
      : `<table>
    <thead><tr><th>Gate</th><th>Project</th><th>Task</th><th>Tier</th><th>Summary</th><th>Age</th></tr></thead>
    <tbody>${items
      .map(
        ({ project, gate }) => `
      <tr>
        <td><a href="/queue/${esc(gate.id)}">${esc(gate.gate)}</a></td>
        <td>${esc(project)}</td>
        <td>${esc(gate.taskId)}</td>
        <td>${gate.tier}</td>
        <td>${esc(gate.summary)}</td>
        <td>${ageOf(gate.createdAt)}</td>
      </tr>`,
      )
      .join('')}</tbody>
  </table>`

  return layout(
    'Queue',
    `
<section class="summary">
  <h1>HITL queue</h1>
  <p class="muted">${items.length} pending</p>
</section>
${rowsHtml}
`,
  )
}

export function renderGateDetail(opts: {
  readonly project: string
  readonly gate: HITLRequest
  readonly existingResponse: HITLResponse | null
}): string {
  const g = opts.gate
  const optionsHtml = g.options
    .map(
      (opt, idx) => `
    <div class="radio-row">
      <input type="radio" name="decision" id="opt-${idx}" value="${esc(opt.id)}" ${idx === 0 ? 'checked' : ''}>
      <label for="opt-${idx}">${esc(opt.label)}</label>
    </div>`,
    )
    .join('')

  const responseSection = opts.existingResponse
    ? `<section class="response-recorded">
        <h3>Response recorded</h3>
        <p><strong>Decision:</strong> ${esc(opts.existingResponse.decision)}</p>
        ${opts.existingResponse.comment ? `<p><strong>Comment:</strong> ${esc(opts.existingResponse.comment)}</p>` : ''}
        <p class="muted">at ${esc(opts.existingResponse.respondedAt)}</p>
      </section>`
    : `<form method="POST" action="/api/queue/${esc(g.id)}">
        <fieldset>
          <legend>Your decision</legend>
          ${optionsHtml}
        </fieldset>
        <fieldset>
          <legend>Comment (optional)</legend>
          <textarea name="comment" rows="4" cols="60" placeholder="Feedback sent to BUILDER on retry; visible in audit"></textarea>
        </fieldset>
        ${
          g.tier <= 1
            ? `<fieldset>
          <legend>Approval token (Tier ${g.tier} Red zone)</legend>
          <input type="text" name="approvalToken" placeholder="${esc(g.id)}" value="${esc(g.id)}" size="40">
          <p class="muted">Hook will verify this against the HITL record.</p>
        </fieldset>`
            : ''
        }
        <button type="submit">Submit</button>
      </form>`

  return layout(
    `${g.gate} · ${opts.project}`,
    `
<section class="summary">
  <h1>${esc(g.gate)} — ${esc(g.taskId)}</h1>
  <p class="muted">${esc(opts.project)} · Tier ${g.tier} · opened ${ageOf(g.createdAt)} ago · gate id <code>${esc(g.id)}</code></p>
</section>

<section>
  <h2>Summary</h2>
  <p>${esc(g.summary)}</p>
</section>

<section>
  <h2>Reason</h2>
  <pre class="reason">${esc(g.reason)}</pre>
</section>

<section>
  <h2>Artifacts</h2>
  <ul>
    ${g.artifacts.diff ? `<li>Diff: <code>${esc(g.artifacts.diff)}</code></li>` : ''}
    ${g.artifacts.reviewReport ? `<li>Review report: <code>${esc(g.artifacts.reviewReport)}</code></li>` : ''}
    ${g.artifacts.demoVideo ? `<li>Demo video: <code>${esc(g.artifacts.demoVideo)}</code></li>` : ''}
    ${g.artifacts.auditRun ? `<li>Audit run: <code>${esc(g.artifacts.auditRun)}</code></li>` : ''}
    ${g.artifacts.adrDraft ? `<li>ADR draft: <code>${esc(g.artifacts.adrDraft)}</code></li>` : ''}
  </ul>
</section>

${responseSection}
`,
  )
}

export function renderError(title: string, detail: string): string {
  return layout(
    title,
    `
<section class="summary">
  <h1>${esc(title)}</h1>
  <pre>${esc(detail)}</pre>
  <p><a href="/">Back to home</a></p>
</section>
`,
  )
}

// ─── helpers ─────────────────────────────────────────────────────────────

function ageOf(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '?'
  const seconds = Math.floor((Date.now() - then) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

export const STYLES_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0d1117;
  --fg: #c9d1d9;
  --muted: #8b949e;
  --accent: #58a6ff;
  --pending: #f0883e;
  --border: #30363d;
  --code-bg: #161b22;
}
body {
  background: var(--bg);
  color: var(--fg);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
  font-size: 14px;
  line-height: 1.5;
  padding: 0 24px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 32px;
}
header .brand {
  font-size: 16px;
  font-weight: bold;
  text-decoration: none;
  color: var(--fg);
}
header nav a {
  margin-left: 20px;
  color: var(--muted);
  text-decoration: none;
}
header nav a:hover { color: var(--fg); }
main { max-width: 1100px; margin: 0 auto; padding-bottom: 60px; }
h1 { font-size: 24px; margin-bottom: 8px; }
h2 { font-size: 18px; margin: 24px 0 12px; color: var(--accent); }
h3 { font-size: 16px; margin: 16px 0 8px; }
section.summary { margin-bottom: 32px; }
section { margin-bottom: 32px; }
.muted { color: var(--muted); font-size: 13px; }
.pending { color: var(--pending); font-weight: bold; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
}
code { padding: 2px 6px; font-size: 13px; }
pre { padding: 12px; overflow-x: auto; font-size: 13px; }
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
}
th, td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
th { color: var(--muted); font-weight: normal; font-size: 12px; text-transform: uppercase; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
dt { color: var(--muted); }
fieldset {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 16px;
}
legend { color: var(--muted); padding: 0 8px; font-size: 12px; }
.radio-row { padding: 6px 0; }
.radio-row label { margin-left: 8px; cursor: pointer; }
textarea, input[type="text"] {
  background: var(--code-bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  font-family: inherit;
  font-size: 13px;
  width: 100%;
}
button {
  background: var(--accent);
  color: var(--bg);
  border: none;
  padding: 10px 18px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
  font-weight: bold;
}
button:hover { opacity: 0.9; }
.reason {
  white-space: pre-wrap;
  word-break: break-word;
}
.response-recorded {
  border-left: 3px solid var(--accent);
  padding-left: 16px;
}
footer {
  border-top: 1px solid var(--border);
  margin-top: 60px;
  padding: 20px 0;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
}
`

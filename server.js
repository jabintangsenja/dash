/* global process */
import express from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { exec } from 'child_process'
import { execFileSync } from 'child_process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = Number(process.env.PORT || 7070)
const HOST = process.env.HOST || '0.0.0.0'
const DIST_DIR = path.join(__dirname, 'dist')
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const COMMANDS_FILE = path.join(DATA_DIR, 'commands.json')
const REPORTS_DB_FILE = path.join(DATA_DIR, 'reports.sqlite')
const MEMORY_FILE = path.join(DATA_DIR, 'memory.md')
const OPENCLAW_ROOT = process.env.OPENCLAW_ROOT || '/root/.openclaw'
const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(OPENCLAW_ROOT, 'workspace')
const OPENCLAW_STATUS_PATH = process.env.OPENCLAW_STATUS_PATH || ''
const OPENCLAW_LOG_DIR = process.env.OPENCLAW_LOG_DIR || '/tmp/openclaw'
const OPENCLAW_CLI_PATH = process.env.OPENCLAW_CLI_PATH || 'openclaw'
const OPENCLAW_STATE_DIR = process.env.OPENCLAW_STATE_DIR || OPENCLAW_ROOT
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || path.join(OPENCLAW_STATE_DIR, 'openclaw.json')
const TASK_RUN_TIMEOUT_SECONDS = Number(process.env.OPENCLAW_TASK_RUN_TIMEOUT_SECONDS || 180)
const STATUS_FILE_STALE_MS = Number(process.env.OPENCLAW_STATUS_STALE_MS || 60000)
const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Jakarta'
const ARTIFACT_EXTENSIONS = new Set(['.md', '.json', '.log', '.pdf'])
const ARTIFACT_IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.cache'])
const ARTIFACT_DENY_PATTERNS = [/secret/i, /token/i, /credential/i, /password/i, /\.env/i, /private[-_.]?key/i]
const REQUIRED_ACTION_HEADER = 'x-openclaw-action'
const REQUIRED_ACTION_VALUE = '1'

const TASK_STATUSES = new Set(['inbox', 'assigned', 'todo', 'in-progress', 'waiting-review', 'blocked', 'done'])
const TASK_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const ALLOWED_COMMANDS = new Set(['openclaw', 'docker', 'git', 'node', 'npm', 'pwd', 'ls', 'cat', 'echo'])
const AGENT_RUNTIME_MAP = {
  main: 'main',
  coding: 'coding',
  reasoning: 'reasoning',
  vision: 'vision',
}

const DEFAULT_SETTINGS = {
  organizationName: 'OpenClaw Labs',
  defaultWorkspace: 'OpenClaw Ops',
  region: 'Asia/Jakarta',
  timeFormat: '24-hour',
  criticalAlerts: 'Email + In-app',
  approvalReminders: 'Every 10 minutes',
  digestSummary: 'Daily at 18:00',
  incidentChannel: '#ops-alerts',
  primaryModel: 'gpt5.4-inv',
  fallbackModel: 'gpt5.3-fast',
  maxAutoRuns: '4',
  budgetGuardrail: '$120/day',
}

const AGENT_DEFINITIONS = [
  { id: 'main', name: 'Zeta', role: 'Main orchestrator', model: 'gpt5.4-inv' },
  { id: 'coding', name: 'Cyrus', role: 'Coding specialist', model: 'gpt5.4-inv' },
  { id: 'reasoning', name: 'Rheon', role: 'Reasoning specialist', model: 'gpt5.4-inv' },
  { id: 'vision', name: 'Vista', role: 'Vision specialist', model: 'gpt5.4-inv' },
]

const streamClients = new Set()

let statusCache = {
  checkedAt: 0,
  path: null,
  mtimeMs: 0,
}

let cliStatusCache = {
  checkedAt: 0,
  data: null,
}

let openClawCliAvailable = null
let reportDb = null
const actionRateLimitStore = new Map()

app.use(express.json({ limit: '2mb' }))
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
  if (!req.path.startsWith('/api/')) return next()
  if (
    req.path.startsWith('/api/tasks') ||
    req.path.startsWith('/api/settings') ||
    req.path.startsWith('/api/command')
  ) {
    return enforceActionGuard(req, res, next)
  }
  return next()
})

ensureDataStore()

function ensureDataStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(TASKS_FILE)) fs.writeFileSync(TASKS_FILE, '[]\n')
  if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`)
  if (!fs.existsSync(COMMANDS_FILE)) fs.writeFileSync(COMMANDS_FILE, '[]\n')
  if (!fs.existsSync(MEMORY_FILE)) {
    fs.writeFileSync(
      MEMORY_FILE,
      [
        '# Zeta Memory Recap',
        '',
        'Auto-generated recap for all completed tasks.',
        '',
      ].join('\n'),
      'utf8',
    )
  }
  initReportsDb()
  backfillDoneTaskReports()
}

function initReportsDb() {
  if (reportDb) return

  reportDb = new DatabaseSync(REPORTS_DB_FILE)
  reportDb.exec(`
    CREATE TABLE IF NOT EXISTS task_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL UNIQUE,
      completed_at TEXT NOT NULL,
      completed_date TEXT NOT NULL,
      completed_time TEXT NOT NULL,
      title TEXT NOT NULL,
      participants_json TEXT NOT NULL,
      models_json TEXT NOT NULL,
      work_done TEXT NOT NULL,
      output TEXT NOT NULL,
      conclusion TEXT NOT NULL,
      improvement_suggestions TEXT NOT NULL,
      pros_json TEXT NOT NULL,
      cons_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'zeta-auto',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_reports_completed_at ON task_reports(completed_at DESC);
  `)
}

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function parseJsonFromText(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function readCommandHistory() {
  return readJsonSafe(COMMANDS_FILE, [])
}

function appendCommandHistory(entry) {
  const rows = readCommandHistory()
  rows.unshift(entry)
  writeJson(COMMANDS_FILE, rows.slice(0, 200))
}

function hasSensitiveArtifactName(name) {
  return ARTIFACT_DENY_PATTERNS.some((pattern) => pattern.test(name))
}

function sameOriginRequest(req) {
  const host = String(req.headers.host || '')
  const origin = String(req.headers.origin || '')
  const referer = String(req.headers.referer || '')
  if (!host) return false
  if (!origin && !referer) return true
  return origin.includes(host) || referer.includes(host)
}

function actionRateLimitKey(req) {
  return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.path}`
}

function checkActionRateLimit(req, windowMs = 60000, maxHits = 120) {
  const key = actionRateLimitKey(req)
  const now = Date.now()
  const state = actionRateLimitStore.get(key) || { count: 0, resetAt: now + windowMs }
  if (now > state.resetAt) {
    state.count = 0
    state.resetAt = now + windowMs
  }
  state.count += 1
  actionRateLimitStore.set(key, state)
  return state.count <= maxHits
}

function enforceActionGuard(req, res, next) {
  if (!checkActionRateLimit(req)) {
    return res.status(429).json({ error: 'Too many action requests. Retry in a minute.' })
  }
  if (!sameOriginRequest(req)) {
    return res.status(403).json({ error: 'Cross-origin action request is blocked.' })
  }
  if (String(req.headers[REQUIRED_ACTION_HEADER] || '') !== REQUIRED_ACTION_VALUE) {
    return res.status(403).json({ error: `Missing required action header "${REQUIRED_ACTION_HEADER}".` })
  }
  return next()
}

function scanArtifacts(rootDir, options = {}) {
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 200
  const results = []

  function walk(dir) {
    if (results.length >= maxEntries) return
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (results.length >= maxEntries) return
      if (entry.name.startsWith('.')) continue
      if (hasSensitiveArtifactName(entry.name)) continue

      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (ARTIFACT_IGNORE_DIRS.has(entry.name)) continue
        walk(fullPath)
        continue
      }

      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!ARTIFACT_EXTENSIONS.has(ext)) continue

      try {
        const stats = fs.statSync(fullPath)
        results.push({
          name: entry.name,
          path: path.relative(rootDir, fullPath),
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          extension: ext.slice(1),
        })
      } catch {
        // ignore unreadable files
      }
    }
  }

  walk(rootDir)
  return results.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
}

function listDockerContainers() {
  const containers = []
  let error = ''

  try {
    const output = execFileSync('docker', ['ps', '--format', '{{json .}}'], { encoding: 'utf8' })
    const lines = output.trim().split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        containers.push(JSON.parse(line))
      } catch {
        // ignore malformed lines
      }
    }
  } catch (err) {
    error = err?.message || 'Failed to query docker containers.'
  }

  return { containers, error }
}

function directorySizeSafe(rootDir, maxEntries = 2000) {
  let total = 0
  let visited = 0
  const stack = [rootDir]
  while (stack.length && visited < maxEntries) {
    const dir = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (visited >= maxEntries) break
      if (entry.name.startsWith('.')) continue
      visited += 1
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!ARTIFACT_IGNORE_DIRS.has(entry.name)) stack.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      try {
        total += fs.statSync(fullPath).size
      } catch {
        // ignore unreadable files
      }
    }
  }
  return {
    bytes: total,
    partial: visited >= maxEntries,
  }
}

function listWorkspaceDirectories() {
  const directories = []
  let error = ''

  if (!fs.existsSync(OPENCLAW_WORKSPACE)) {
    return { directories, error: `Workspace not found at ${OPENCLAW_WORKSPACE}` }
  }

  try {
    const entries = fs.readdirSync(OPENCLAW_WORKSPACE, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = path.join(OPENCLAW_WORKSPACE, entry.name)
      try {
        const stats = fs.statSync(fullPath)
        const sizeInfo = directorySizeSafe(fullPath)
        directories.push({
          name: entry.name,
          path: path.relative(OPENCLAW_WORKSPACE, fullPath),
          fullPath,
          size: sizeInfo.bytes,
          sizePartial: sizeInfo.partial,
          modifiedAt: stats.mtime.toISOString(),
        })
      } catch {
        // ignore unreadable directory
      }
    }
  } catch (err) {
    error = err?.message || 'Failed to read workspace directories.'
  }

  return { directories, error }
}

function localDateTimeParts(isoLike) {
  const value = new Date(isoLike || Date.now())
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value)
  return { date, time }
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function createDoneTaskSummary(task, sessions = []) {
  const primaryAgent = AGENT_DEFINITIONS.find((agent) => agent.id === task.agent)
  const relatedSessions = sessions.filter((session) => {
    if (task.sessionKey) return session.sessionKey === task.sessionKey
    return session.agent === task.agent
  })

  const participants = new Set(['Zeta'])
  if (primaryAgent?.name) participants.add(primaryAgent.name)
  for (const contributor of task.contributors || []) participants.add(contributor)
  for (const session of relatedSessions) {
    const agentDef = AGENT_DEFINITIONS.find((agent) => agent.id === session.agent)
    participants.add(agentDef?.name || session.agent || 'unknown')
  }

  const models = new Set()
  for (const modelHint of task.modelHints || []) models.add(modelHint)
  for (const session of relatedSessions) {
    if (session.model) models.add(session.model)
  }
  if (!models.size && primaryAgent?.model) models.add(primaryAgent.model)

  const brief = task.description?.trim() || `Task "${task.title}" ditandai selesai oleh ${primaryAgent?.name || task.agent || 'agent'}.`
  const output = relatedSessions.length
    ? `Session terkait: ${relatedSessions.map((session) => session.sessionKey).join(', ')}.`
    : `Tidak ada session key langsung, output diambil dari progres task (${task.progress || 100}%).`
  const conclusion = `Task selesai dengan status done. Fokus eksekusi oleh ${Array.from(participants).join(', ')}.`
  const improvementSuggestions = [
    'Tetapkan acceptance criteria lebih spesifik sebelum eksekusi.',
    'Simpan artifact output dalam format terstruktur per task.',
    task.approvalRequired ? 'Kurangi bottleneck approval dengan pre-approval rule untuk task sejenis.' : 'Pertahankan alur approval ringan untuk task berisiko rendah.',
  ].join(' ')
  const pros = [
    'Tracking status dan progres task jelas.',
    'Ringkasan model dan agent terlibat terdokumentasi.',
    'Output task dapat ditelusuri ulang dari report SQL.',
  ]
  const cons = [
    'Sebagian output masih bergantung deskripsi manual task.',
    'Belum semua task punya artifact terlampir otomatis.',
  ]

  return {
    participants: Array.from(participants),
    models: Array.from(models),
    workDone: brief,
    output,
    conclusion,
    improvementSuggestions,
    pros,
    cons,
    source: 'zeta-auto',
  }
}

function syncZetaMemoryFromReports() {
  const rows = listReports(500)
  const lines = [
    '# Zeta Memory Recap',
    '',
    'Auto-generated recap for all completed tasks.',
    '',
    `Last sync: ${new Date().toISOString()}`,
    '',
  ]

  for (const row of rows) {
    lines.push(`## ${row.completedDate} ${row.completedTime} - ${row.title}`)
    lines.push(`- Task ID: ${row.taskId}`)
    lines.push(`- Agent terlibat: ${row.participants.join(', ') || '-'}`)
    lines.push(`- Model digunakan: ${row.models.join(', ') || '-'}`)
    lines.push(`- Apa yang dikerjakan: ${row.workDone}`)
    lines.push(`- Output: ${row.output}`)
    lines.push(`- Kesimpulan: ${row.conclusion}`)
    lines.push(`- Saran perbaikan: ${row.improvementSuggestions}`)
    lines.push(`- Pro: ${row.pros.join(' | ') || '-'}`)
    lines.push(`- Kontra: ${row.cons.join(' | ') || '-'}`)
    lines.push('')
  }

  fs.writeFileSync(MEMORY_FILE, `${lines.join('\n').trim()}\n`, 'utf8')
}

function upsertDoneTaskReport(task, sessions = []) {
  if (!reportDb || task.status !== 'done') return null

  const nowIso = new Date().toISOString()
  const completedAt = task.updatedAt || task.createdAt || nowIso
  const { date, time } = localDateTimeParts(completedAt)
  const summary = createDoneTaskSummary(task, sessions)

  const existing = reportDb.prepare('SELECT id FROM task_reports WHERE task_id = ?').get(task.id)
  if (existing?.id) {
    reportDb
      .prepare(
        `
        UPDATE task_reports SET
          completed_at = ?,
          completed_date = ?,
          completed_time = ?,
          title = ?,
          participants_json = ?,
          models_json = ?,
          work_done = ?,
          output = ?,
          conclusion = ?,
          improvement_suggestions = ?,
          pros_json = ?,
          cons_json = ?,
          source = ?,
          updated_at = ?
        WHERE task_id = ?
      `,
      )
      .run(
        completedAt,
        date,
        time,
        task.title,
        JSON.stringify(summary.participants),
        JSON.stringify(summary.models),
        summary.workDone,
        summary.output,
        summary.conclusion,
        summary.improvementSuggestions,
        JSON.stringify(summary.pros),
        JSON.stringify(summary.cons),
        summary.source,
        nowIso,
        task.id,
      )
  } else {
    reportDb
      .prepare(
        `
        INSERT INTO task_reports (
          task_id, completed_at, completed_date, completed_time, title,
          participants_json, models_json, work_done, output, conclusion,
          improvement_suggestions, pros_json, cons_json, source, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        task.id,
        completedAt,
        date,
        time,
        task.title,
        JSON.stringify(summary.participants),
        JSON.stringify(summary.models),
        summary.workDone,
        summary.output,
        summary.conclusion,
        summary.improvementSuggestions,
        JSON.stringify(summary.pros),
        JSON.stringify(summary.cons),
        summary.source,
        nowIso,
        nowIso,
      )
  }

  syncZetaMemoryFromReports()
  return getReportByTaskId(task.id)
}

function mapReportRow(row) {
  if (!row) return null
  return {
    id: row.id,
    taskId: row.task_id,
    completedAt: row.completed_at,
    completedDate: row.completed_date,
    completedTime: row.completed_time,
    title: row.title,
    participants: safeJsonParse(row.participants_json, []),
    models: safeJsonParse(row.models_json, []),
    workDone: row.work_done,
    output: row.output,
    conclusion: row.conclusion,
    improvementSuggestions: row.improvement_suggestions,
    pros: safeJsonParse(row.pros_json, []),
    cons: safeJsonParse(row.cons_json, []),
    source: row.source,
    updatedAt: row.updated_at,
  }
}

function listReports(limit = 100) {
  if (!reportDb) return []
  const rows = reportDb
    .prepare('SELECT * FROM task_reports ORDER BY completed_at DESC LIMIT ?')
    .all(Number(limit) || 100)
  return rows.map(mapReportRow)
}

function getReportByTaskId(taskId) {
  if (!reportDb) return null
  const row = reportDb.prepare('SELECT * FROM task_reports WHERE task_id = ?').get(taskId)
  return mapReportRow(row)
}

function backfillDoneTaskReports() {
  const gateway = readGatewayStatus()
  const sessions = normalizeSessions(gateway.data)
  const tasks = readJsonSafe(TASKS_FILE, [])
  const doneTasks = tasks.filter((task) => task.status === 'done')
  for (const task of doneTasks) {
    upsertDoneTaskReport(task, sessions)
  }
}

function listStatusCandidates(workspaceDir) {
  const candidates = []
  const direct = path.join(workspaceDir, 'gateway-status.json')
  if (fs.existsSync(direct)) candidates.push(direct)

  if (!fs.existsSync(workspaceDir)) return candidates

  let entries = []
  try {
    entries = fs.readdirSync(workspaceDir, { withFileTypes: true })
  } catch {
    return candidates
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(workspaceDir, entry.name)
    const maybe = path.join(dir, 'data', 'gateway-status.json')
    if (entry.name.includes('command-center') && fs.existsSync(maybe)) candidates.push(maybe)
  }

  return candidates
}

function discoverGatewayStatusPath() {
  const now = Date.now()
  if (now - statusCache.checkedAt < 10000) return statusCache

  const candidates = []
  if (OPENCLAW_STATUS_PATH) candidates.push(OPENCLAW_STATUS_PATH)
  candidates.push(...listStatusCandidates(OPENCLAW_WORKSPACE))

  let best = null
  let bestMtime = 0

  for (const file of candidates) {
    try {
      const stat = fs.statSync(file)
      if (stat.mtimeMs > bestMtime) {
        best = file
        bestMtime = stat.mtimeMs
      }
    } catch {
      // ignore inaccessible files
    }
  }

  statusCache = {
    checkedAt: now,
    path: best,
    mtimeMs: bestMtime,
  }

  return statusCache
}

function readGatewayStatusFromCli() {
  if (openClawCliAvailable === false) return null
  const now = Date.now()
  if (now - cliStatusCache.checkedAt < 10000) return cliStatusCache.data
  const cliEnv = {
    ...process.env,
    OPENCLAW_STATE_DIR,
    OPENCLAW_CONFIG_PATH,
  }

  try {
    if (openClawCliAvailable === null) {
      execFileSync(OPENCLAW_CLI_PATH, ['--version'], { stdio: 'ignore', timeout: 2000, env: cliEnv })
      openClawCliAvailable = true
    }
    const output = execFileSync(OPENCLAW_CLI_PATH, ['status', '--json', '--no-color', '--log-level', 'silent'], {
      encoding: 'utf8',
      timeout: 10000,
      env: cliEnv,
    })
    const parsed = parseJsonFromText(output)
    if (!parsed) throw new Error('Failed to parse JSON from openclaw status.')
    cliStatusCache = {
      checkedAt: now,
      data: {
        path: `${OPENCLAW_CLI_PATH} status --json`,
        data: parsed,
        source: 'cli',
      },
    }
  } catch {
    cliStatusCache = {
      checkedAt: now,
      data: null,
    }
    openClawCliAvailable = false
  }

  return cliStatusCache.data
}

function readGatewayStatusFromSessionFiles() {
  const recent = AGENT_DEFINITIONS.flatMap((agentDef) => {
    const sessionFile = path.join(OPENCLAW_ROOT, 'agents', agentDef.id, 'sessions', 'sessions.json')
    const sessions = readJsonSafe(sessionFile, null)
    if (!sessions || typeof sessions !== 'object') return []

    return Object.entries(sessions).map(([key, session]) => ({
      agentId: agentDef.id,
      key,
      sessionId: session?.sessionId || key,
      displayName: key,
      updatedAt: Number(session?.updatedAt || 0),
      model: session?.modelOverride || session?.model || agentDef.model,
      provider: session?.providerOverride || null,
      inputTokens: Number(session?.inputTokens || 0),
      outputTokens: Number(session?.outputTokens || 0),
      totalTokens: Number(session?.totalTokens || 0),
      rateLimited: Boolean(session?.rateLimited),
      retryAfter: Number(session?.retryAfter || 0),
    }))
  })
    .filter((session) => session.updatedAt > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 40)

  if (!recent.length) return null

  return {
    path: 'agents/*/sessions/sessions.json',
    data: {
      sessions: { recent },
      channelSummary: [],
      gateway: { version: null, uptimeMs: 0 },
    },
    source: 'session-files',
  }
}

function readGatewayStatus() {
  const discovered = discoverGatewayStatusPath()
  const gatewayPath = discovered.path
  const gatewayFileData = gatewayPath ? readJsonSafe(gatewayPath, null) : null
  const isFreshFile = gatewayFileData && discovered.mtimeMs > 0 && Date.now() - discovered.mtimeMs <= STATUS_FILE_STALE_MS

  if (isFreshFile) {
    return {
      path: gatewayPath,
      data: gatewayFileData,
      source: 'file',
    }
  }

  const cliStatus = readGatewayStatusFromCli()
  if (cliStatus) {
    return {
      ...cliStatus,
      stalePath: gatewayPath,
    }
  }

  const sessionFileStatus = readGatewayStatusFromSessionFiles()
  if (sessionFileStatus) {
    return {
      ...sessionFileStatus,
      stalePath: gatewayPath,
    }
  }

  if (!gatewayPath) return { path: null, data: null, source: 'none' }
  return {
    path: gatewayPath,
    data: gatewayFileData,
    source: 'stale-file',
  }
}

function normalizeSessions(status) {
  const recent = status?.sessions?.recent || []
  return recent
    .map((session) => ({
      id: session.sessionId || session.key,
      sessionKey: session.key,
      title: session.displayName || session.key,
      agent: session.agentId || 'main',
      model: session.model || 'unknown',
      provider: session.provider || null,
      updatedAt: session.updatedAt || Date.now(),
      status: session.rateLimited ? 'rate_limited' : 'active',
      retryAfter: session.retryAfter || 0,
      tokenUsage: {
        input: session.inputTokens || 0,
        output: session.outputTokens || 0,
        total: session.totalTokens || 0,
      },
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function summarizeAgents(sessions) {
  return AGENT_DEFINITIONS.map((agentDef) => {
    const match = sessions.find((session) => session.agent === agentDef.id)
    return {
      ...agentDef,
      status: match ? (match.status === 'rate_limited' ? 'busy' : 'active') : 'idle',
      currentTask: match?.title || 'No active session',
      model: match?.model || agentDef.model,
      updatedAt: match?.updatedAt || null,
      sessionKey: match?.sessionKey || null,
    }
  })
}

function withTaskWorkspace(tasks, defaultWorkspace) {
  let changed = false
  const normalized = tasks.map((task) => {
    const next = { ...task }
    if (!next.workspace) {
      next.workspace = defaultWorkspace
      changed = true
    }
    if (!Object.hasOwn(next, 'lastRunAt')) {
      next.lastRunAt = null
      changed = true
    }
    if (!Object.hasOwn(next, 'lastRunStatus')) {
      next.lastRunStatus = null
      changed = true
    }
    if (!Object.hasOwn(next, 'lastRunError')) {
      next.lastRunError = null
      changed = true
    }
    return next
  })
  if (changed) writeJson(TASKS_FILE, normalized)
  return normalized
}

function bootstrapTasks(sessions, defaultWorkspace) {
  const tasks = readJsonSafe(TASKS_FILE, [])
  if (tasks.length > 0) return withTaskWorkspace(tasks, defaultWorkspace)

  const seeded = sessions.slice(0, 6).map((session, index) => ({
    id: String(Date.now() + index),
    title: session.title,
    description: `Linked to ${session.sessionKey}`,
    workspace: defaultWorkspace,
    agent: session.agent,
    priority: index === 0 ? 'high' : 'normal',
    status: index === 0 ? 'in-progress' : index === 1 ? 'assigned' : 'inbox',
    progress: index === 0 ? 72 : index === 1 ? 38 : 12,
    approvalRequired: session.status === 'rate_limited',
    sessionKey: session.sessionKey,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))

  writeJson(TASKS_FILE, seeded)
  return seeded
}

function taskStats(tasks) {
  const done = tasks.filter((task) => task.status === 'done').length
  const blocked = tasks.filter((task) => task.status === 'blocked').length
  const approvals = tasks.filter((task) => task.approvalRequired).length

  return {
    commandsToday: tasks.length,
    autoResolved: done,
    approvalsPending: approvals,
    avgResponse: '1.8s',
    blockedTasks: blocked,
    artifactsCreated: done,
    generatedAt: Date.now(),
  }
}

function createActivity(tasks, sessions) {
  const fromSessions = sessions.slice(0, 10).map((session) => ({
    id: `session-${session.id}`,
    time: session.updatedAt,
    type: session.status === 'rate_limited' ? 'warning' : 'info',
    detail: `${session.agent} session active: ${session.title}`,
  }))

  const fromTasks = tasks.slice(0, 10).map((task) => ({
    id: `task-${task.id}`,
    time: new Date(task.updatedAt || task.createdAt).getTime(),
    type: task.status,
    detail: task.title,
  }))

  return [...fromTasks, ...fromSessions].sort((a, b) => b.time - a.time)
}

function getSystemStats() {
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const cpus = os.cpus()

  let disk = { total: 0, used: 0, free: 0, percent: 0 }
  try {
    const stat = fs.statfsSync('/')
    const totalDisk = stat.bsize * stat.blocks
    const freeDisk = stat.bsize * stat.bavail
    const usedDisk = totalDisk - freeDisk
    disk = {
      total: Math.round(totalDisk / 1024 / 1024 / 1024),
      used: Math.round(usedDisk / 1024 / 1024 / 1024),
      free: Math.round(freeDisk / 1024 / 1024 / 1024),
      percent: Math.round((usedDisk / totalDisk) * 100),
    }
  } catch {
    // ignore disk metrics when unavailable
  }

  return {
    memory: {
      total: Math.round(totalMem / 1024 / 1024),
      used: Math.round(usedMem / 1024 / 1024),
      free: Math.round(freeMem / 1024 / 1024),
      percent: Math.round((usedMem / totalMem) * 100),
    },
    cpu: {
      cores: cpus.length,
      usage: Math.max(0, Math.round((os.loadavg()[0] * 100) / Math.max(cpus.length, 1))),
      model: cpus[0]?.model || 'unknown',
    },
    disk,
    uptime: process.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
  }
}

function getLatestLogLines(limit = 120) {
  try {
    if (!fs.existsSync(OPENCLAW_LOG_DIR)) return []
    const logFiles = fs
      .readdirSync(OPENCLAW_LOG_DIR)
      .filter((name) => name.endsWith('.log'))
      .map((name) => ({
        name,
        path: path.join(OPENCLAW_LOG_DIR, name),
        mtime: fs.statSync(path.join(OPENCLAW_LOG_DIR, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)

    if (!logFiles.length) return []
    const raw = fs.readFileSync(logFiles[0].path, 'utf8')
    return raw.split('\n').filter(Boolean).slice(-limit)
  } catch {
    return []
  }
}

function buildOverview() {
  const gateway = readGatewayStatus()
  const sessions = normalizeSessions(gateway.data)
  const settings = readJsonSafe(SETTINGS_FILE, DEFAULT_SETTINGS)
  const tasks = bootstrapTasks(sessions, settings.defaultWorkspace || 'Ops-Alpha v2')
  const agents = summarizeAgents(sessions)
  const activity = createActivity(tasks, sessions)
  const reports = listReports(120)
  const commandHistory = readCommandHistory().slice(0, 20)

  return {
    appName: process.env.VITE_APP_NAME || 'OpenClaw Command Center',
    workspace: settings.defaultWorkspace || 'OpenClaw Ops',
    sessions,
    agents,
    tasks,
    approvals: tasks.filter((task) => task.approvalRequired || task.status === 'waiting-review'),
    activity,
    productivity: taskStats(tasks),
    system: getSystemStats(),
    logs: getLatestLogLines(),
    reports,
    commandHistory,
    reportSummary: {
      doneTasks: reports.length,
      lastReportAt: reports[0]?.completedAt || null,
    },
    gateway: {
      connected: Boolean(gateway.data),
      statusPath: gateway.path,
      source: gateway.source || 'file',
      version: gateway.data?.gateway?.version || null,
      uptimeMs: gateway.data?.gateway?.uptimeMs || 0,
      channelSummary: gateway.data?.channelSummary || [],
    },
    generatedAt: Date.now(),
  }
}

function isCommandSafe(command) {
  const trimmed = String(command || '').trim()
  if (!trimmed || trimmed.length > 200) return false
  if (/[;&|`$><]/.test(trimmed)) return false
  const [prefix] = trimmed.split(/\s+/)
  return ALLOWED_COMMANDS.has(prefix)
}

function sanitizeTaskPatch(payload = {}) {
  const patch = {}
  if (typeof payload.title === 'string') patch.title = payload.title.slice(0, 160)
  if (typeof payload.description === 'string') patch.description = payload.description.slice(0, 400)
  if (typeof payload.workspace === 'string') patch.workspace = payload.workspace.slice(0, 120)
  if (typeof payload.agent === 'string') patch.agent = payload.agent.slice(0, 40)
  if (typeof payload.priority === 'string' && TASK_PRIORITIES.has(payload.priority)) patch.priority = payload.priority
  if (typeof payload.status === 'string' && TASK_STATUSES.has(payload.status)) patch.status = payload.status
  if (typeof payload.progress === 'number') patch.progress = Math.max(0, Math.min(100, Math.round(payload.progress)))
  if (typeof payload.approvalRequired === 'boolean') patch.approvalRequired = payload.approvalRequired
  if (typeof payload.sessionKey === 'string') patch.sessionKey = payload.sessionKey.slice(0, 240)
  if (payload.sessionKey === null) patch.sessionKey = null
  if (Array.isArray(payload.contributors)) patch.contributors = payload.contributors.map((value) => String(value).slice(0, 60)).slice(0, 10)
  if (Array.isArray(payload.modelHints)) patch.modelHints = payload.modelHints.map((value) => String(value).slice(0, 80)).slice(0, 10)
  if (typeof payload.lastRunAt === 'string') patch.lastRunAt = payload.lastRunAt
  if (typeof payload.lastRunStatus === 'string') patch.lastRunStatus = payload.lastRunStatus.slice(0, 40)
  if (typeof payload.lastRunError === 'string') patch.lastRunError = payload.lastRunError.slice(0, 500)
  return patch
}

function publishOverview() {
  if (!streamClients.size) return
  const payload = JSON.stringify(buildOverview())
  for (const response of streamClients) {
    response.write(`event: overview\n`)
    response.write(`data: ${payload}\n\n`)
  }
}

function readTasks() {
  return readJsonSafe(TASKS_FILE, [])
}

function saveTasks(tasks) {
  writeJson(TASKS_FILE, tasks)
}

function updateTask(taskId, updater) {
  const tasks = readTasks()
  const index = tasks.findIndex((task) => task.id === taskId)
  if (index === -1) return null
  const current = tasks[index]
  const next = {
    ...current,
    ...updater(current),
    updatedAt: new Date().toISOString(),
  }
  tasks[index] = next
  saveTasks(tasks)
  return { previous: current, task: next }
}

function buildTaskPrompt(task) {
  const lines = [
    `Task Title: ${task.title}`,
    `Assigned Agent: ${task.agent}`,
    `Priority: ${task.priority}`,
    `Workspace: ${task.workspace || 'OpenClaw Ops'}`,
    '',
    'Task Description:',
    task.description || 'No description provided.',
  ]

  if (Array.isArray(task.contributors) && task.contributors.length) {
    lines.push('', `Known Contributors: ${task.contributors.join(', ')}`)
  }
  if (Array.isArray(task.modelHints) && task.modelHints.length) {
    lines.push(`Model Hints: ${task.modelHints.join(', ')}`)
  }

  lines.push(
    '',
    'Execution Request:',
    'Please execute this task in the specified workspace, report progress, and produce concrete results. Keep the final output concise and implementation-focused.',
  )

  return lines.join('\n')
}

function readAgentSessionsRaw(agentId) {
  const sessionFile = path.join(OPENCLAW_ROOT, 'agents', agentId, 'sessions', 'sessions.json')
  const sessions = readJsonSafe(sessionFile, {})
  return {
    file: sessionFile,
    sessions: sessions && typeof sessions === 'object' ? sessions : {},
  }
}

function latestSessionKeyFromSessions(sessions) {
  const keys = Object.keys(sessions || {})
  if (!keys.length) return null
  return keys.sort((a, b) => Number(sessions[b]?.updatedAt || 0) - Number(sessions[a]?.updatedAt || 0))[0]
}

function spawnOpenClawTask(task) {
  const runtimeAgent = AGENT_RUNTIME_MAP[task.agent] || 'main'
  const prompt = buildTaskPrompt(task)
  const beforeState = readAgentSessionsRaw(runtimeAgent)
  const beforeKeys = new Set(Object.keys(beforeState.sessions))
  const cliEnv = {
    ...process.env,
    OPENCLAW_STATE_DIR,
    OPENCLAW_CONFIG_PATH,
  }

  const output = execFileSync(
    OPENCLAW_CLI_PATH,
    ['agent', '--agent', runtimeAgent, `--message=${prompt}`, '--json', '--timeout', String(Math.max(30, TASK_RUN_TIMEOUT_SECONDS))],
    {
      encoding: 'utf8',
      timeout: Math.max(60000, TASK_RUN_TIMEOUT_SECONDS * 1000 + 10000),
      maxBuffer: 1024 * 1024 * 8,
      env: cliEnv,
    },
  )

  const parsed = parseJsonFromText(output)
  const explicitSessionId = parsed?.result?.meta?.agentMeta?.sessionId || null
  const afterState = readAgentSessionsRaw(runtimeAgent)
  const afterSessions = afterState.sessions
  const afterKeys = Object.keys(afterSessions)
  const freshKey = afterKeys.find((key) => !beforeKeys.has(key))
  const bySessionId = explicitSessionId
    ? afterKeys.find((key) => String(afterSessions[key]?.sessionId || '') === String(explicitSessionId))
    : null
  const latestKey = latestSessionKeyFromSessions(afterSessions)
  const sessionKey = freshKey || bySessionId || latestKey
  if (!sessionKey) {
    throw new Error('No session key detected after dispatch.')
  }

  return {
    sessionKey,
    session: afterSessions[sessionKey] || null,
    fallback: !freshKey,
    raw: parsed,
  }
}

setInterval(publishOverview, 10000).unref()

app.get('/api/health', (req, res) => {
  const discovered = discoverGatewayStatusPath()
  const gatewayPath = discovered.path
  const gatewayAgeMs = discovered.mtimeMs ? Date.now() - discovered.mtimeMs : null
  const gatewayReadable = gatewayPath ? fs.existsSync(gatewayPath) : false
  const logsReadable = fs.existsSync(OPENCLAW_LOG_DIR)
  const reportsDbReady = fs.existsSync(REPORTS_DB_FILE)
  const memoryReady = fs.existsSync(MEMORY_FILE)
  const cliPathReadable = fs.existsSync(OPENCLAW_CLI_PATH)

  res.json({
    status: 'ok',
    service: 'dash-api',
    time: new Date().toISOString(),
    checks: {
      gatewayPath,
      gatewayReadable,
      gatewayAgeMs,
      gatewayStale: gatewayAgeMs !== null ? gatewayAgeMs > STATUS_FILE_STALE_MS : null,
      logsReadable,
      reportsDbReady,
      memoryReady,
      cliPathReadable,
      cliPath: OPENCLAW_CLI_PATH,
      dataDir: DATA_DIR,
    },
  })
})

app.get('/api/overview', (req, res) => {
  res.json(buildOverview())
})

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  streamClients.add(res)
  res.write(`event: hello\ndata: ${JSON.stringify({ connected: true, ts: Date.now() })}\n\n`)
  res.write(`event: overview\ndata: ${JSON.stringify(buildOverview())}\n\n`)

  req.on('close', () => {
    streamClients.delete(res)
    res.end()
  })
})

app.get('/api/tasks', (req, res) => {
  res.json(readJsonSafe(TASKS_FILE, []))
})

app.get('/api/artifacts', (req, res) => {
  if (!fs.existsSync(OPENCLAW_WORKSPACE)) {
    return res.status(500).json({ error: 'Workspace not found', root: OPENCLAW_WORKSPACE })
  }

  const limit = Number(req.query.limit || 200)
  const safeLimit = Math.max(1, Math.min(1000, limit))
  const artifacts = scanArtifacts(OPENCLAW_WORKSPACE, { maxEntries: safeLimit })

  return res.json({
    root: OPENCLAW_WORKSPACE,
    count: artifacts.length,
    scannedAt: new Date().toISOString(),
    artifacts,
  })
})

app.get('/api/workspaces', (req, res) => {
  const dockerResult = listDockerContainers()
  const workspaceResult = listWorkspaceDirectories()

  res.json({
    root: OPENCLAW_WORKSPACE,
    scannedAt: new Date().toISOString(),
    containers: dockerResult.containers,
    containerError: dockerResult.error,
    directories: workspaceResult.directories,
    directoryError: workspaceResult.error,
  })
})

app.post('/api/tasks', (req, res) => {
  const body = req.body || {}
  const title = String(body.title || '').trim()
  if (!title) return res.status(400).json({ error: 'Task title is required.' })

  const task = {
    id: String(Date.now()),
    title: title.slice(0, 160),
    description: String(body.description || '').slice(0, 400),
    workspace: String(body.workspace || readJsonSafe(SETTINGS_FILE, DEFAULT_SETTINGS).defaultWorkspace || 'Ops-Alpha v2').slice(0, 120),
    agent: String(body.agent || 'main').slice(0, 40),
    priority: TASK_PRIORITIES.has(body.priority) ? body.priority : 'normal',
    status: TASK_STATUSES.has(body.status) ? body.status : 'inbox',
    progress: Math.max(0, Math.min(100, Number(body.progress || 0))),
    approvalRequired: Boolean(body.approvalRequired),
    sessionKey: body.sessionKey ? String(body.sessionKey).slice(0, 240) : null,
    contributors: Array.isArray(body.contributors) ? body.contributors.map((value) => String(value).slice(0, 60)).slice(0, 10) : [],
    modelHints: Array.isArray(body.modelHints) ? body.modelHints.map((value) => String(value).slice(0, 80)).slice(0, 10) : [],
    lastRunAt: null,
    lastRunStatus: null,
    lastRunError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const tasks = readJsonSafe(TASKS_FILE, [])
  tasks.unshift(task)
  writeJson(TASKS_FILE, tasks)
  if (task.status === 'done') {
    const sessions = normalizeSessions(readGatewayStatus().data)
    upsertDoneTaskReport(task, sessions)
  }
  publishOverview()
  res.status(201).json(task)
})

app.post('/api/tasks/generate', (req, res) => {
  const body = req.body || {}
  const settings = readJsonSafe(SETTINGS_FILE, DEFAULT_SETTINGS)
  const workspace = String(body.workspace || settings.defaultWorkspace || 'Ops-Alpha v2').slice(0, 120)
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  const generated = [
    {
      id: `${now}-1`,
      title: 'Generate implementation checklist',
      description: 'Zeta merangkum langkah eksekusi berdasarkan kondisi task terbaru.',
      workspace,
      agent: 'main',
      priority: 'normal',
      status: 'inbox',
      progress: 0,
      approvalRequired: false,
      sessionKey: null,
      contributors: ['Zeta'],
      modelHints: ['gpt5.4-inv'],
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: `${now}-2`,
      title: 'Code patch drafting',
      description: 'Cyrus menyiapkan patch awal untuk task prioritas aktif.',
      workspace,
      agent: 'coding',
      priority: 'high',
      status: 'todo',
      progress: 0,
      approvalRequired: false,
      sessionKey: null,
      contributors: ['Cyrus'],
      modelHints: ['gpt5.4-inv'],
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: `${now}-3`,
      title: 'Risk and dependency review',
      description: 'Rheon melakukan validasi risiko, dependency, dan acceptance criteria.',
      workspace,
      agent: 'reasoning',
      priority: 'normal',
      status: 'in-progress',
      progress: 40,
      approvalRequired: false,
      sessionKey: null,
      contributors: ['Rheon'],
      modelHints: ['gpt5.4-inv'],
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: `${now}-4`,
      title: 'Visual QA and approval packet',
      description: 'Vista menyiapkan bukti visual + ringkasan untuk proses approval.',
      workspace,
      agent: 'vision',
      priority: 'normal',
      status: 'waiting-review',
      progress: 85,
      approvalRequired: true,
      sessionKey: null,
      contributors: ['Vista'],
      modelHints: ['gpt5.4-inv'],
      lastRunAt: null,
      lastRunStatus: null,
      lastRunError: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ]

  const tasks = readJsonSafe(TASKS_FILE, [])
  tasks.unshift(...generated)
  writeJson(TASKS_FILE, tasks)
  publishOverview()

  res.status(201).json({
    createdAt: nowIso,
    workspace,
    items: generated,
  })
})

app.post('/api/tasks/:id/run', (req, res) => {
  const lookup = updateTask(req.params.id, (task) => ({
    agent: AGENT_RUNTIME_MAP[task.agent] ? task.agent : 'main',
    status: 'assigned',
    progress: Math.max(5, Number(task.progress || 0)),
    lastRunAt: new Date().toISOString(),
    lastRunStatus: 'queued',
    lastRunError: null,
  }))

  if (!lookup) return res.status(404).json({ error: 'Task not found.' })

  try {
    const dispatch = spawnOpenClawTask(lookup.task)
    const next = updateTask(req.params.id, (task) => ({
      status: 'in-progress',
      progress: Math.max(15, Number(task.progress || 0)),
      sessionKey: dispatch.sessionKey,
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'running',
      lastRunError: null,
    }))
    appendCommandHistory({
      id: `task-run-${Date.now()}`,
      type: 'task-run',
      command: `openclaw agent --agent ${lookup.task.agent}`,
      source: 'task-runner',
      taskId: lookup.task.id,
      taskTitle: lookup.task.title,
      state: 'running',
      sessionKey: dispatch.sessionKey,
      ranAt: new Date().toISOString(),
    })

    publishOverview()
    return res.json({
      ok: true,
      task: next?.task || lookup.task,
      dispatch: {
        sessionKey: dispatch.sessionKey,
        fallback: Boolean(dispatch.fallback),
      },
    })
  } catch (error) {
    const detail =
      error?.code === 'ENOENT'
        ? `OpenClaw CLI not found at "${OPENCLAW_CLI_PATH}". Mount host CLI into container or set OPENCLAW_CLI_PATH.`
        : error?.message || 'Dispatch failed.'
    const failed = updateTask(req.params.id, (task) => ({
      status: task.sessionKey ? task.status : 'blocked',
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'failed',
      lastRunError: detail,
    }))
    appendCommandHistory({
      id: `task-run-${Date.now()}`,
      type: 'task-run',
      command: `openclaw agent --agent ${lookup.task.agent}`,
      source: 'task-runner',
      taskId: lookup.task.id,
      taskTitle: lookup.task.title,
      state: 'failed',
      error: detail,
      ranAt: new Date().toISOString(),
    })

    publishOverview()
    return res.status(500).json({
      error: 'Failed to dispatch real task to OpenClaw.',
      detail,
      task: failed?.task || lookup.task,
    })
  }
})

app.post('/api/tasks/:id/approve', (req, res) => {
  const lookup = updateTask(req.params.id, (task) => {
    const canApprove = task.approvalRequired || task.status === 'waiting-review' || task.status === 'in-progress'
    if (!canApprove) {
      return {
        lastRunAt: new Date().toISOString(),
        lastRunStatus: task.lastRunStatus || 'noop',
        lastRunError: 'Approve rejected: task is not in approval flow.',
      }
    }
    return {
      status: 'done',
      progress: 100,
      approvalRequired: false,
      lastRunAt: new Date().toISOString(),
      lastRunStatus: 'approved',
      lastRunError: null,
    }
  })
  if (!lookup) return res.status(404).json({ error: 'Task not found.' })
  if (lookup.task.status === 'done') {
    const sessions = normalizeSessions(readGatewayStatus().data)
    upsertDoneTaskReport(lookup.task, sessions)
  }
  publishOverview()
  return res.json({ ok: true, task: lookup.task })
})

app.post('/api/tasks/:id/reject', (req, res) => {
  const lookup = updateTask(req.params.id, () => ({
    status: 'blocked',
    approvalRequired: false,
    lastRunAt: new Date().toISOString(),
    lastRunStatus: 'rejected',
    lastRunError: null,
  }))
  if (!lookup) return res.status(404).json({ error: 'Task not found.' })
  publishOverview()
  return res.json({ ok: true, task: lookup.task })
})

app.patch('/api/tasks/:id', (req, res) => {
  const tasks = readJsonSafe(TASKS_FILE, [])
  const index = tasks.findIndex((task) => task.id === req.params.id)
  if (index === -1) return res.status(404).json({ error: 'Task not found.' })

  const previous = tasks[index]
  const patch = sanitizeTaskPatch(req.body)
  tasks[index] = {
    ...tasks[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  writeJson(TASKS_FILE, tasks)
  if (tasks[index].status === 'done' && previous.status !== 'done') {
    const sessions = normalizeSessions(readGatewayStatus().data)
    upsertDoneTaskReport(tasks[index], sessions)
  }
  if (tasks[index].status === 'done' && previous.status === 'done') {
    const sessions = normalizeSessions(readGatewayStatus().data)
    upsertDoneTaskReport(tasks[index], sessions)
  }
  publishOverview()
  res.json(tasks[index])
})

app.get('/api/settings', (req, res) => {
  res.json(readJsonSafe(SETTINGS_FILE, DEFAULT_SETTINGS))
})

app.patch('/api/settings', (req, res) => {
  const current = readJsonSafe(SETTINGS_FILE, DEFAULT_SETTINGS)
  const merged = { ...current }
  for (const [key, value] of Object.entries(req.body || {})) {
    if (typeof value === 'string') {
      merged[key] = value.slice(0, 180)
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      merged[key] = value
      continue
    }
    merged[key] = JSON.stringify(value).slice(0, 180)
  }
  writeJson(SETTINGS_FILE, merged)
  publishOverview()
  res.json(merged)
})

app.get('/api/reports', (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 120)))
  res.json({
    items: listReports(limit),
    timezone: REPORT_TIMEZONE,
    memoryPath: MEMORY_FILE,
  })
})

app.get('/api/reports/:taskId', (req, res) => {
  const report = getReportByTaskId(req.params.taskId)
  if (!report) return res.status(404).json({ error: 'Report not found for this task.' })
  res.json(report)
})

app.post('/api/command', (req, res) => {
  const command = String(req.body?.command || '').trim()
  if (!isCommandSafe(command)) {
    return res.status(400).json({
      error: 'Command rejected by safety policy.',
      hint: 'Allowed commands: openclaw, docker, git, node, npm, pwd, ls, cat, echo',
    })
  }

  exec(command, { timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    const payload = {
      command,
      stdout: stdout || '',
      stderr: stderr || '',
      error: error ? error.message : '',
      code: error?.code ?? 0,
      ranAt: new Date().toISOString(),
    }
    appendCommandHistory({
      id: `cmd-${Date.now()}`,
      type: 'command',
      command,
      state: payload.code === 0 ? 'success' : 'failed',
      code: payload.code,
      ranAt: payload.ranAt,
      stderr: payload.stderr.slice(0, 300),
    })
    publishOverview()
    res.json(payload)
  })
})

app.use(express.static(DIST_DIR, { index: false }))
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'))
})

app.listen(PORT, HOST, () => {
  console.log(`dash api listening on http://${HOST}:${PORT}`)
})

/* global process */
import cors from 'cors'
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
const REPORTS_DB_FILE = path.join(DATA_DIR, 'reports.sqlite')
const MEMORY_FILE = path.join(DATA_DIR, 'memory.md')
const OPENCLAW_ROOT = process.env.OPENCLAW_ROOT || '/root/.openclaw'
const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(OPENCLAW_ROOT, 'workspace')
const OPENCLAW_STATUS_PATH = process.env.OPENCLAW_STATUS_PATH || ''
const OPENCLAW_LOG_DIR = process.env.OPENCLAW_LOG_DIR || '/tmp/openclaw'
const STATUS_FILE_STALE_MS = Number(process.env.OPENCLAW_STATUS_STALE_MS || 60000)
const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || 'Asia/Jakarta'

const TASK_STATUSES = new Set(['inbox', 'assigned', 'todo', 'in-progress', 'waiting-review', 'blocked', 'done'])
const TASK_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const ALLOWED_COMMANDS = new Set(['openclaw', 'docker', 'git', 'node', 'npm', 'pwd', 'ls', 'cat', 'echo'])

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

app.use(cors())
app.use(express.json({ limit: '2mb' }))

ensureDataStore()

function ensureDataStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(TASKS_FILE)) fs.writeFileSync(TASKS_FILE, '[]\n')
  if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`)
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

  try {
    if (openClawCliAvailable === null) {
      execFileSync('openclaw', ['--version'], { stdio: 'ignore', timeout: 2000 })
      openClawCliAvailable = true
    }
    const output = execFileSync('openclaw', ['status', '--json', '--no-color', '--log-level', 'silent'], {
      encoding: 'utf8',
      timeout: 10000,
    })
    const parsed = JSON.parse(output)
    cliStatusCache = {
      checkedAt: now,
      data: {
        path: 'openclaw status --json',
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

  const sessionFileStatus = readGatewayStatusFromSessionFiles()
  if (sessionFileStatus) {
    return {
      ...sessionFileStatus,
      stalePath: gatewayPath,
    }
  }

  const cliStatus = readGatewayStatusFromCli()
  if (cliStatus) {
    return {
      ...cliStatus,
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
    if (task.workspace) return task
    changed = true
    return {
      ...task,
      workspace: defaultWorkspace,
    }
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
  if (Array.isArray(payload.contributors)) patch.contributors = payload.contributors.map((value) => String(value).slice(0, 60)).slice(0, 10)
  if (Array.isArray(payload.modelHints)) patch.modelHints = payload.modelHints.map((value) => String(value).slice(0, 80)).slice(0, 10)
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

setInterval(publishOverview, 10000).unref()

app.get('/api/health', (req, res) => {
  const discovered = discoverGatewayStatusPath()
  const gatewayPath = discovered.path
  const gatewayAgeMs = discovered.mtimeMs ? Date.now() - discovered.mtimeMs : null
  const gatewayReadable = gatewayPath ? fs.existsSync(gatewayPath) : false
  const logsReadable = fs.existsSync(OPENCLAW_LOG_DIR)
  const reportsDbReady = fs.existsSync(REPORTS_DB_FILE)
  const memoryReady = fs.existsSync(MEMORY_FILE)

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
    merged[key] = String(value).slice(0, 180)
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
    res.json({
      command,
      stdout: stdout || '',
      stderr: stderr || '',
      error: error ? error.message : '',
      code: error?.code ?? 0,
      ranAt: new Date().toISOString(),
    })
  })
})

app.use(express.static(DIST_DIR, { index: false }))
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'))
})

app.listen(PORT, HOST, () => {
  console.log(`dash api listening on http://${HOST}:${PORT}`)
})


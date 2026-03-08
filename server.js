/* global process */
import cors from 'cors'
import express from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { exec } from 'child_process'
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
const OPENCLAW_ROOT = process.env.OPENCLAW_ROOT || '/root/.openclaw'
const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(OPENCLAW_ROOT, 'workspace')
const OPENCLAW_STATUS_PATH = process.env.OPENCLAW_STATUS_PATH || ''
const OPENCLAW_LOG_DIR = process.env.OPENCLAW_LOG_DIR || '/tmp/openclaw'

const TASK_STATUSES = new Set(['inbox', 'assigned', 'in-progress', 'blocked', 'done'])
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
}

app.use(cors())
app.use(express.json({ limit: '2mb' }))

ensureDataStore()

function ensureDataStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(TASKS_FILE)) fs.writeFileSync(TASKS_FILE, '[]\n')
  if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`)
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
  if (now - statusCache.checkedAt < 10000) return statusCache.path

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
  }

  return best
}

function readGatewayStatus() {
  const gatewayPath = discoverGatewayStatusPath()
  if (!gatewayPath) return { path: null, data: null }
  return {
    path: gatewayPath,
    data: readJsonSafe(gatewayPath, null),
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

function bootstrapTasks(sessions) {
  const tasks = readJsonSafe(TASKS_FILE, [])
  if (tasks.length > 0) return tasks

  const seeded = sessions.slice(0, 6).map((session, index) => ({
    id: String(Date.now() + index),
    title: session.title,
    description: `Linked to ${session.sessionKey}`,
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
  const tasks = bootstrapTasks(sessions)
  const settings = readJsonSafe(SETTINGS_FILE, DEFAULT_SETTINGS)
  const agents = summarizeAgents(sessions)
  const activity = createActivity(tasks, sessions)

  return {
    appName: process.env.VITE_APP_NAME || 'OpenClaw Command Center',
    workspace: settings.defaultWorkspace || 'OpenClaw Ops',
    sessions,
    agents,
    tasks,
    approvals: tasks.filter((task) => task.approvalRequired),
    activity,
    productivity: taskStats(tasks),
    system: getSystemStats(),
    logs: getLatestLogLines(),
    gateway: {
      connected: Boolean(gateway.data),
      statusPath: gateway.path,
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
  if (typeof payload.agent === 'string') patch.agent = payload.agent.slice(0, 40)
  if (typeof payload.priority === 'string' && TASK_PRIORITIES.has(payload.priority)) patch.priority = payload.priority
  if (typeof payload.status === 'string' && TASK_STATUSES.has(payload.status)) patch.status = payload.status
  if (typeof payload.progress === 'number') patch.progress = Math.max(0, Math.min(100, Math.round(payload.progress)))
  if (typeof payload.approvalRequired === 'boolean') patch.approvalRequired = payload.approvalRequired
  if (typeof payload.sessionKey === 'string') patch.sessionKey = payload.sessionKey.slice(0, 240)
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
  const gatewayPath = discoverGatewayStatusPath()
  const gatewayReadable = gatewayPath ? fs.existsSync(gatewayPath) : false
  const logsReadable = fs.existsSync(OPENCLAW_LOG_DIR)

  res.json({
    status: 'ok',
    service: 'dash-api',
    time: new Date().toISOString(),
    checks: {
      gatewayPath,
      gatewayReadable,
      logsReadable,
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
    agent: String(body.agent || 'main').slice(0, 40),
    priority: TASK_PRIORITIES.has(body.priority) ? body.priority : 'normal',
    status: TASK_STATUSES.has(body.status) ? body.status : 'inbox',
    progress: Math.max(0, Math.min(100, Number(body.progress || 0))),
    approvalRequired: Boolean(body.approvalRequired),
    sessionKey: body.sessionKey ? String(body.sessionKey).slice(0, 240) : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const tasks = readJsonSafe(TASKS_FILE, [])
  tasks.unshift(task)
  writeJson(TASKS_FILE, tasks)
  publishOverview()
  res.status(201).json(task)
})

app.patch('/api/tasks/:id', (req, res) => {
  const tasks = readJsonSafe(TASKS_FILE, [])
  const index = tasks.findIndex((task) => task.id === req.params.id)
  if (index === -1) return res.status(404).json({ error: 'Task not found.' })

  const patch = sanitizeTaskPatch(req.body)
  tasks[index] = {
    ...tasks[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  writeJson(TASKS_FILE, tasks)
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


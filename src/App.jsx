import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import './App.css'

const sideNav = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/command-center', label: 'Command Center' },
  { to: '/kanban', label: 'Kanban' },
  { to: '/artifacts', label: 'Artifacts' },
  { to: '/workspaces', label: 'Workspaces' },
  { to: '/activity-logs', label: 'Activity Logs' },
  { to: '/settings', label: 'Settings' },
]

const KANBAN_COLUMNS = ['inbox', 'assigned', 'in-progress', 'blocked', 'done']

const toneMap = {
  main: 'zeta',
  zeta: 'zeta',
  coding: 'coding',
  cyrus: 'coding',
  reasoning: 'reasoning',
  rheon: 'reasoning',
  vision: 'vision',
  vista: 'vision',
  warning: 'warning',
  success: 'success',
  error: 'error',
  info: 'zeta',
  active: 'success',
  idle: 'warning',
  busy: 'coding',
  done: 'success',
  'in-progress': 'coding',
  assigned: 'vision',
  inbox: 'zeta',
  blocked: 'error',
  rate_limited: 'warning',
}

function toneFor(value) {
  return toneMap[String(value || '').toLowerCase()] || 'zeta'
}

function prettyLabel(value) {
  return String(value || '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatSince(value) {
  if (!value) return 'just now'
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function StatusChip({ text, tone }) {
  return (
    <span className={`status-chip ${toneFor(tone || text)}`}>
      <span className="chip-dot" />
      {text}
    </span>
  )
}

function Card({ title, action, children }) {
  return (
    <section className="panel-card">
      <header className="card-head">
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  )
}

function MetricCard({ label, value, subtext }) {
  return (
    <div className="kpi">
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{subtext}</span>
    </div>
  )
}

function FeedRow({ item, actionLabel = 'Open', onAction }) {
  return (
    <article className="feed-row">
      <div>
        <h4>{item.title || item.detail}</h4>
        <p>{item.subtitle || item.meta}</p>
      </div>
      <div className="feed-actions">
        {item.state && <StatusChip text={item.state} tone={item.state} />}
        {onAction && (
          <button className="btn-ghost" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </article>
  )
}

function AgentRow({ agent }) {
  return (
    <article className="agent-row">
      <div>
        <strong>{agent.name}</strong>
        <p>{agent.currentTask}</p>
      </div>
      <div className="agent-meta">
        <StatusChip text={agent.status} tone={agent.status} />
        <small>{agent.model}</small>
        <small>{agent.updatedAt ? formatSince(agent.updatedAt) : 'No active session'}</small>
      </div>
    </article>
  )
}

function TaskCard({ task, onOpenTask }) {
  return (
    <article className="task-card">
      <div className="row-between">
        <h4>{task.title}</h4>
        <StatusChip text={prettyLabel(task.status)} tone={task.status} />
      </div>
      <div className="chip-wrap">
        <StatusChip text={task.agent} tone={task.agent} />
        <StatusChip text={task.priority} tone={task.priority === 'high' ? 'warning' : task.priority} />
        {task.approvalRequired && <StatusChip text="Approval Needed" tone="warning" />}
      </div>
      <p className="muted">{task.description || 'No description yet.'}</p>
      <div className="progress-track" aria-label="Task progress">
        <div className="progress-fill" style={{ width: `${task.progress || 0}%` }} />
      </div>
      <div className="row-between">
        <small>Updated {formatSince(task.updatedAt || task.createdAt)}</small>
        <small>{task.sessionKey || 'manual task'}</small>
      </div>
      <div className="mini-actions">
        <button className="btn-ghost" onClick={() => onOpenTask(task)}>
          Open
        </button>
      </div>
    </article>
  )
}

function DashboardScreen({ overview, onOpenTask, command, setCommand, onRunCommand, commandOutput }) {
  const activeTasks = overview.tasks.filter((task) => task.status !== 'done').slice(0, 4)
  const recentSessions = overview.sessions.slice(0, 6).map((session) => ({
    title: session.title,
    subtitle: `${prettyLabel(session.agent)} - ${session.model} - ${formatSince(session.updatedAt)}`,
    state: session.status,
  }))

  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Quick Command" action={<small>Safe command runner</small>}>
          <div className="command-box">
            <textarea value={command} onChange={(event) => setCommand(event.target.value)} aria-label="Quick command input" />
            <div className="row-between">
              <div className="row-inline">
                <button className="btn-ghost" disabled>
                  Attach
                </button>
                <small>Allowed: openclaw, docker, git, node, npm, pwd, ls, cat, echo</small>
              </div>
              <button className="btn-primary" onClick={onRunCommand}>
                Run Command
              </button>
            </div>
            <pre className="code-box">{commandOutput || 'No command executed yet.'}</pre>
          </div>
        </Card>

        <Card
          title="Active Tasks Summary"
          action={
            <button className="btn-ghost" onClick={() => activeTasks[0] && onOpenTask(activeTasks[0])}>
              Open Command Center
            </button>
          }
        >
          <div className="cards-2">
            {activeTasks.length ? activeTasks.map((task) => <TaskCard key={task.id} task={task} onOpenTask={onOpenTask} />) : <p>No active tasks.</p>}
          </div>
        </Card>

        <Card title="Recent Session Feed">
          <div className="feed-list">
            {recentSessions.length ? recentSessions.map((item) => <FeedRow key={item.title + item.subtitle} item={item} />) : <p>No recent sessions.</p>}
          </div>
        </Card>

        <div className="cards-2">
          <Card title="Productivity Snapshot">
            <div className="kpi-grid">
              <MetricCard label="Commands Today" value={overview.productivity.commandsToday || 0} subtext="tracked tasks" />
              <MetricCard label="Auto-Resolved" value={overview.productivity.autoResolved || 0} subtext="done status" />
              <MetricCard label="Approvals Pending" value={overview.productivity.approvalsPending || 0} subtext="need attention" />
              <MetricCard label="Avg Response" value={overview.productivity.avgResponse || '-'} subtext="rolling estimate" />
              <MetricCard label="Blocked Tasks" value={overview.productivity.blockedTasks || 0} subtext="from task list" />
              <MetricCard label="Artifacts Created" value={overview.productivity.artifactsCreated || 0} subtext="derived" />
            </div>
          </Card>

          <Card title="Timeline / Attention Queue">
            <div className="timeline">
              {overview.activity.slice(0, 6).map((item) => (
                <div className="timeline-row" key={item.id}>
                  <small>{new Date(item.time).toLocaleTimeString()}</small>
                  <div>
                    <StatusChip text={item.type} tone={item.type} />
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <aside className="right-stack">
        <Card title="Agent Status">
          <div className="stack-gap">{overview.agents.map((agent) => <AgentRow key={agent.id} agent={agent} />)}</div>
        </Card>

        <Card title="Approvals Queue">
          <div className="stack-gap">
            {overview.approvals.length ? (
              overview.approvals.map((task) => (
                <article className="approval-item" key={task.id}>
                  <div>
                    <h5>{task.title}</h5>
                    <p>{task.description || 'Needs approval before proceeding.'}</p>
                  </div>
                  <div className="mini-actions">
                    <button className="btn-success" onClick={() => onOpenTask(task)}>
                      Review
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p>No approvals pending.</p>
            )}
          </div>
        </Card>

        <Card title="Notifications">
          <ul className="list-plain">
            <li>Gateway {overview.gateway.connected ? 'connected' : 'disconnected'}</li>
            <li>{overview.sessions.length} recent sessions available</li>
            <li>{overview.logs.length} log lines loaded</li>
          </ul>
        </Card>
      </aside>
    </div>
  )
}

function CommandCenterScreen({ selectedTask, overview, onTaskPatch }) {
  if (!selectedTask) {
    return (
      <div className="content-grid">
        <div className="main-stack">
          <Card title="Task Context">
            <p>Select a task from Dashboard or Kanban.</p>
          </Card>
        </div>
      </div>
    )
  }

  const relatedSession = overview.sessions.find((session) => session.sessionKey === selectedTask.sessionKey)

  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Task Context">
          <div className="text-block">
            <h2>{selectedTask.title}</h2>
            <p>{selectedTask.description || 'No description provided.'}</p>
            <div className="chip-wrap">
              <StatusChip text={selectedTask.agent} tone={selectedTask.agent} />
              <StatusChip text={selectedTask.priority} tone={selectedTask.priority} />
              <StatusChip text={selectedTask.status} tone={selectedTask.status} />
            </div>
          </div>
        </Card>

        <Card title="Linked Session">
          <pre className="code-box">{relatedSession ? JSON.stringify(relatedSession, null, 2) : 'No linked session'}</pre>
        </Card>

        <Card title="Execution Controls">
          <div className="mini-actions wrap-actions">
            <button className="btn-success" onClick={() => onTaskPatch(selectedTask.id, { status: 'done', progress: 100 })}>
              Mark Done
            </button>
            <button
              className="btn-ghost"
              onClick={() => onTaskPatch(selectedTask.id, { status: 'in-progress', progress: Math.min(100, Number(selectedTask.progress || 0) + 10) })}
            >
              Advance Progress
            </button>
            <button className="btn-danger" onClick={() => onTaskPatch(selectedTask.id, { status: 'blocked' })}>
              Block
            </button>
          </div>
        </Card>
      </div>

      <aside className="right-stack">
        <Card title="Approvals">
          <p>{selectedTask.approvalRequired ? 'Approval is required.' : 'No approval needed.'}</p>
        </Card>
        <Card title="Files">
          <ul className="list-plain">
            <li>{selectedTask.sessionKey || 'No linked artifact'}</li>
          </ul>
        </Card>
      </aside>
    </div>
  )
}

function KanbanScreen({ tasks, onOpenTask, onTaskPatch, onCreateTask }) {
  const columns = KANBAN_COLUMNS
  const [search, setSearch] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter((task) => [task.title, task.description, task.agent, task.status].join(' ').toLowerCase().includes(q))
  }, [tasks, search])

  const grouped = Object.fromEntries(columns.map((key) => [key, filtered.filter((task) => task.status === key)]))

  return (
    <div className="kanban-page">
      <header className="kanban-head">
        <div>
          <h2>Kanban Board</h2>
          <p>Live task board from backend API</p>
        </div>
        <div className="mini-actions wrap-actions">
          <input className="search-input compact-input" placeholder="Filter tasks..." value={search} onChange={(event) => setSearch(event.target.value)} />
          <input className="search-input compact-input" placeholder="New task title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
          <input className="search-input compact-input" placeholder="Description" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} />
          <button
            className="btn-primary"
            onClick={() => {
              onCreateTask(newTitle, newDescription)
              setNewTitle('')
              setNewDescription('')
            }}
          >
            + New Task
          </button>
        </div>
      </header>

      <div className="kanban-board">
        {columns.map((column) => (
          <section key={column} className="kanban-column">
            <header className="row-between">
              <h4>{prettyLabel(column)}</h4>
              <small>{grouped[column].length}</small>
            </header>

            <div className="stack-gap">
              {grouped[column].map((task) => (
                <article key={task.id} className="kanban-card">
                  <h5>{task.title}</h5>
                  <p>{task.description || 'No description'}</p>
                  <div className="chip-wrap">
                    <StatusChip text={task.agent} tone={task.agent} />
                    <StatusChip text={task.priority} tone={task.priority} />
                  </div>
                  <div className="mini-actions wrap-actions">
                    <button className="btn-ghost" onClick={() => onOpenTask(task)}>
                      Open
                    </button>
                    {column !== 'done' && (
                      <button className="btn-success" onClick={() => onTaskPatch(task.id, { status: 'done', progress: 100 })}>
                        Done
                      </button>
                    )}
                    {column === 'inbox' && (
                      <button className="btn-ghost" onClick={() => onTaskPatch(task.id, { status: 'assigned', progress: 20 })}>
                        Assign
                      </button>
                    )}
                    {column === 'assigned' && (
                      <button className="btn-ghost" onClick={() => onTaskPatch(task.id, { status: 'in-progress', progress: 55 })}>
                        Start
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function ArtifactsScreen({ overview }) {
  const artifacts = [
    ...overview.logs.slice(0, 5).map((line, index) => ({
      name: `log-${index + 1}.txt`,
      meta: 'OpenClaw runtime log',
      preview: line.slice(0, 96),
    })),
    ...overview.sessions.slice(0, 4).map((session) => ({
      name: `${session.agent}-${session.id}.json`,
      meta: session.model,
      preview: session.sessionKey,
    })),
  ]

  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Artifacts Library">
          <div className="feed-list">
            {artifacts.map((artifact) => (
              <FeedRow
                key={artifact.name}
                item={{
                  title: artifact.name,
                  subtitle: `${artifact.meta} - ${artifact.preview}`,
                  state: 'info',
                }}
              />
            ))}
          </div>
        </Card>
      </div>

      <aside className="right-stack">
        <Card title="Preview">
          <div className="preview-box">
            <p>Artifacts are inferred from sessions and logs.</p>
          </div>
        </Card>
      </aside>
    </div>
  )
}

function WorkspacesScreen({ overview }) {
  const workspaces = [
    { name: overview.workspace, members: `${overview.agents.length} agents`, state: 'Active' },
    { name: 'Finance Dashboard', members: '2 services', state: 'Active' },
    { name: 'Memory', members: 'workspace files', state: 'Ready' },
  ]

  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Workspaces">
          <div className="feed-list">
            {workspaces.map((workspace) => (
              <FeedRow
                key={workspace.name}
                item={{
                  title: workspace.name,
                  subtitle: workspace.members,
                  state: workspace.state,
                }}
              />
            ))}
          </div>
        </Card>
      </div>

      <aside className="right-stack">
        <Card title="Gateway Summary">
          <ul className="list-plain">
            <li>Connected: {overview.gateway.connected ? 'Yes' : 'No'}</li>
            <li>Status file: {overview.gateway.statusPath || 'not found'}</li>
            <li>Channels: {overview.gateway.channelSummary.length}</li>
          </ul>
        </Card>
      </aside>
    </div>
  )
}

function ActivityLogsScreen({ overview }) {
  const [filter, setFilter] = useState('all')
  const rows = useMemo(() => {
    if (filter === 'all') return overview.activity
    return overview.activity.filter((item) => item.type === filter)
  }, [overview.activity, filter])

  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card
          title="Activity Logs"
          action={
            <select className="select-input" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="info">Info</option>
              <option value="inbox">Inbox</option>
              <option value="assigned">Assigned</option>
              <option value="in-progress">In Progress</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </select>
          }
        >
          <div className="timeline">
            {rows.map((item) => (
              <div className="timeline-row" key={item.id}>
                <small>{new Date(item.time).toLocaleTimeString()}</small>
                <div>
                  <StatusChip text={item.type} tone={item.type} />
                  <p>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <aside className="right-stack">
        <Card title="Recent Runtime Logs">
          <pre className="code-box">{overview.logs.slice(-15).join('\n') || 'No logs found'}</pre>
        </Card>
      </aside>
    </div>
  )
}

function SettingsScreen({ settings, onSave }) {
  const [draft, setDraft] = useState(settings)
  const [savedAt, setSavedAt] = useState('')

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  const fields = [
    ['organizationName', 'Organization Name'],
    ['defaultWorkspace', 'Default Workspace'],
    ['region', 'Region'],
    ['timeFormat', 'Time Format'],
    ['criticalAlerts', 'Critical alerts'],
    ['approvalReminders', 'Approval reminders'],
    ['digestSummary', 'Digest summary'],
    ['incidentChannel', 'Incident channel'],
    ['primaryModel', 'Primary model'],
    ['fallbackModel', 'Fallback model'],
    ['maxAutoRuns', 'Max auto-runs'],
    ['budgetGuardrail', 'Budget guardrail'],
  ]

  async function handleSave() {
    await onSave(draft)
    setSavedAt(new Date().toLocaleTimeString())
  }

  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Settings" action={savedAt ? <small>Saved at {savedAt}</small> : null}>
          <div className="settings-grid">
            {fields.map(([key, label]) => (
              <label key={key}>
                {label}
                <input value={draft[key] || ''} onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} />
              </label>
            ))}
          </div>
          <div className="mini-actions top-gap">
            <button className="btn-primary" onClick={handleSave}>
              Save Settings
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}

function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()

  const [overview, setOverview] = useState({
    appName: 'OpenClaw Command Center',
    workspace: 'OpenClaw Ops',
    sessions: [],
    agents: [],
    tasks: [],
    approvals: [],
    activity: [],
    productivity: {},
    system: { memory: {}, disk: {}, uptime: 0 },
    logs: [],
    gateway: { connected: false, statusPath: null, channelSummary: [] },
    generatedAt: Date.now(),
  })

  const [settings, setSettings] = useState({})
  const [selectedTask, setSelectedTask] = useState(null)
  const [command, setCommand] = useState('openclaw status')
  const [commandOutput, setCommandOutput] = useState('No command executed yet.')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [streamConnected, setStreamConnected] = useState(false)

  const loadOverview = useCallback(async () => {
    try {
      const [overviewData, settingsData] = await Promise.all([
        fetch('/api/overview').then((response) => response.json()),
        fetch('/api/settings').then((response) => response.json()),
      ])
      setOverview(overviewData)
      setSettings(settingsData)
      if (selectedTask) {
        const refreshed = overviewData.tasks.find((task) => task.id === selectedTask.id)
        if (refreshed) setSelectedTask(refreshed)
      }
      setError('')
    } catch (loadError) {
      setError(loadError.message || 'Failed to load overview')
    } finally {
      setLoading(false)
    }
  }, [selectedTask])

  useEffect(() => {
    loadOverview()
    const fallback = setInterval(loadOverview, 30000)

    const stream = new EventSource('/api/stream')
    stream.addEventListener('hello', () => setStreamConnected(true))
    stream.addEventListener('overview', (event) => {
      setStreamConnected(true)
      try {
        const incoming = JSON.parse(event.data)
        setOverview(incoming)
      } catch {
        // ignore malformed stream events
      }
    })
    stream.onerror = () => setStreamConnected(false)

    return () => {
      clearInterval(fallback)
      stream.close()
    }
  }, [loadOverview])

  async function patchTask(taskId, patch) {
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    await loadOverview()
  }

  async function createTask(title, description) {
    if (!title.trim()) return
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, agent: 'main', priority: 'normal' }),
    })
    await loadOverview()
  }

  async function saveSettings(nextSettings) {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextSettings),
    })
    const data = await response.json()
    setSettings(data)
  }

  async function runCommand() {
    const response = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    })
    const data = await response.json()
    setCommandOutput([`$ ${data.command || command}`, data.stdout || '', data.stderr || '', data.error || ''].filter(Boolean).join('\n'))
  }

  function openTask(task) {
    setSelectedTask(task)
    navigate('/command-center')
  }

  const navWithBadges = sideNav.map((item) => {
    if (item.label === 'Command Center') return { ...item, badge: selectedTask ? '1' : '' }
    if (item.label === 'Kanban') return { ...item, badge: String(overview.tasks.length || '') }
    if (item.label === 'Activity Logs') return { ...item, badge: String(overview.activity.length || '') }
    return { ...item, badge: '' }
  })

  return (
    <div className="app-root">
      <div className="app-shell">
        <header className="top-nav">
          <div className="top-left">
            <strong>{overview.appName}</strong>
            <button className="btn-ghost">Workspace: {overview.workspace}</button>
            <StatusChip text={streamConnected ? 'Live Sync' : 'Polling Mode'} tone={streamConnected ? 'success' : 'warning'} />
            <StatusChip text={overview.gateway.connected ? 'Gateway Connected' : 'Gateway Offline'} tone={overview.gateway.connected ? 'success' : 'error'} />
          </div>

          <div className="top-actions">
            <input className="search-input" value={location.pathname} readOnly />
            <button className="btn-primary" onClick={loadOverview}>
              Refresh
            </button>
          </div>
        </header>

        <div className="app-body">
          <aside className="side-nav">
            {navWithBadges.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
                <span>{item.label}</span>
                {item.badge && <small className="nav-badge">{item.badge}</small>}
              </NavLink>
            ))}
          </aside>

          <main className="page-main">
            {loading ? (
              <p>Loading dashboard...</p>
            ) : error ? (
              <p>{error}</p>
            ) : (
              <Routes>
                <Route
                  path="/dashboard"
                  element={
                    <DashboardScreen
                      overview={overview}
                      onOpenTask={openTask}
                      command={command}
                      setCommand={setCommand}
                      onRunCommand={runCommand}
                      commandOutput={commandOutput}
                    />
                  }
                />
                <Route
                  path="/command-center"
                  element={<CommandCenterScreen selectedTask={selectedTask} overview={overview} onTaskPatch={patchTask} />}
                />
                <Route path="/kanban" element={<KanbanScreen tasks={overview.tasks} onOpenTask={openTask} onTaskPatch={patchTask} onCreateTask={createTask} />} />
                <Route path="/artifacts" element={<ArtifactsScreen overview={overview} />} />
                <Route path="/workspaces" element={<WorkspacesScreen overview={overview} />} />
                <Route path="/activity-logs" element={<ActivityLogsScreen overview={overview} />} />
                <Route path="/settings" element={<SettingsScreen settings={settings} onSave={saveSettings} />} />
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return <AppShell />
}




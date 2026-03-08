import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import './App.css'

const sideNav = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/coordination', label: 'Coordination' },
  { to: '/command-center', label: 'Command Center' },
  { to: '/kanban', label: 'Kanban' },
  { to: '/artifacts', label: 'Artifacts' },
  { to: '/workspaces', label: 'Workspaces' },
  { to: '/reports', label: 'Reports' },
  { to: '/activity-logs', label: 'Activity Logs' },
  { to: '/settings', label: 'Settings' },
]

const KANBAN_COLUMNS = ['inbox', 'todo', 'in-progress', 'waiting-review', 'blocked', 'done']
const WORKSPACE_PRESETS = ['Ops-Alpha v2', 'Ops-Beta v1', 'Finance Dashboard']
const COMMAND_MODES = ['auto', 'coding', 'reasoning', 'vision']
const POPUP_TABS = ['node', 'edge', 'handoff', 'approval', 'retry']

const FLOW_NODES = [
  { id: 'user', label: 'User', x: 50, y: 12, tone: 'zeta', static: true },
  { id: 'main', label: 'Zeta', x: 50, y: 40, tone: 'zeta' },
  { id: 'coding', label: 'Cyrus', x: 24, y: 74, tone: 'coding' },
  { id: 'reasoning', label: 'Rheon', x: 50, y: 74, tone: 'reasoning' },
  { id: 'vision', label: 'Vista', x: 76, y: 74, tone: 'vision' },
]

const FLOW_EDGES = [
  { id: 'dispatch-main', from: 'user', to: 'main', label: 'dispatch', tone: 'zeta' },
  { id: 'main-coding', from: 'main', to: 'coding', label: 'route', tone: 'coding' },
  { id: 'main-reasoning', from: 'main', to: 'reasoning', label: 'analyze', tone: 'reasoning' },
  { id: 'main-vision', from: 'main', to: 'vision', label: 'inspect', tone: 'vision' },
  { id: 'coding-main', from: 'coding', to: 'main', label: 'feedback', tone: 'coding', curved: true },
  { id: 'reasoning-main', from: 'reasoning', to: 'main', label: 'decision', tone: 'reasoning', curved: true },
  { id: 'vision-main', from: 'vision', to: 'main', label: 'result', tone: 'vision', curved: true },
  { id: 'coding-reasoning', from: 'coding', to: 'reasoning', label: 'handoff', tone: 'reasoning', curved: true, low: true },
  { id: 'reasoning-vision', from: 'reasoning', to: 'vision', label: 'context', tone: 'vision', curved: true, low: true },
  { id: 'vision-coding', from: 'vision', to: 'coding', label: 'retry', tone: 'error', curved: true, low: true },
]

const EDGE_DETAILS = {
  'main-coding': {
    reason: 'dispatch patch implementation',
    payload: { from: 'Zeta', to: 'Cyrus', type: 'task.route', intent: 'implement', priority: 'high' },
  },
  'main-reasoning': {
    reason: 'request architecture analysis',
    payload: { from: 'Zeta', to: 'Rheon', type: 'task.route', intent: 'analyze', priority: 'normal' },
  },
  'main-vision': {
    reason: 'request UI visual verification',
    payload: { from: 'Zeta', to: 'Vista', type: 'task.route', intent: 'inspect', priority: 'normal' },
  },
  'coding-reasoning': {
    reason: 'handoff for blast-radius validation',
    payload: { from: 'Cyrus', to: 'Rheon', type: 'handoff', check: 'blast_radius', retries: 0 },
  },
  'reasoning-vision': {
    reason: 'share context for UX consistency',
    payload: { from: 'Rheon', to: 'Vista', type: 'context_sync', section: 'flow_overview' },
  },
  'vision-coding': {
    reason: 'retry loop due to parse mismatch',
    payload: { from: 'Vista', to: 'Cyrus', type: 'retry', error: 'parse_mismatch', retries: 2 },
  },
}

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
  todo: 'vision',
  'waiting-review': 'warning',
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
  const ts = new Date(value).getTime()
  if (!Number.isFinite(ts)) return '-'
  const diff = Math.max(0, Date.now() - ts)
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function formatJakartaDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '-'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function formatLocalDateTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`
}

function nextInList(list, currentValue) {
  const index = list.indexOf(currentValue)
  if (index < 0) return list[0]
  return list[(index + 1) % list.length]
}

function kanbanColumnLabel(status) {
  if (status === 'todo') return 'To Do'
  if (status === 'waiting-review') return 'Waiting / Review'
  return prettyLabel(status)
}

function flowPoint(nodeId) {
  const node = FLOW_NODES.find((entry) => entry.id === nodeId)
  return node ? { x: node.x, y: node.y } : { x: 50, y: 50 }
}

function flowPath(edge) {
  const start = flowPoint(edge.from)
  const end = flowPoint(edge.to)
  if (!edge.curved) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
  }
  const arc = edge.low ? 18 : -18
  const cx = (start.x + end.x) / 2
  const cy = (start.y + end.y) / 2 + arc
  return `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`
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
      <div className="agent-head">
        <strong>{agent.name}</strong>
        <StatusChip text={agent.status} tone={agent.status} />
      </div>
      <p className="agent-task">{agent.currentTask}</p>
      <div className="agent-meta">
        <small>{agent.model}</small>
        <small>{agent.updatedAt ? `${formatSince(agent.updatedAt)} | ${formatJakartaDateTime(agent.updatedAt)} WIB` : 'No active session'}</small>
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

function CoordinationFlow({ overview, selectedNodeId, onSelectNode }) {
  const agentMap = Object.fromEntries(overview.agents.map((agent) => [agent.id, agent]))

  return (
    <div className="coordination-flow">
      <svg className="flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Coordination flow map">
        <defs>
          <marker id="flow-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill="#8ec5ff" />
          </marker>
        </defs>
        {FLOW_EDGES.map((edge) => (
          <path key={edge.id} d={flowPath(edge)} className={`flow-edge ${toneFor(edge.tone)} ${edge.curved ? 'curved' : ''}`} markerEnd="url(#flow-arrow)" />
        ))}
      </svg>

      {FLOW_NODES.map((node) => {
        const liveAgent = agentMap[node.id]
        const status = liveAgent?.status || (node.static ? 'active' : 'idle')
        const isBusy = status === 'active' || status === 'busy'
        return (
          <button
            key={node.id}
            className={`flow-node ${toneFor(node.tone)} ${selectedNodeId === node.id ? 'selected' : ''} ${isBusy ? 'live' : ''}`}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
            onClick={() => onSelectNode(node.id)}
          >
            <span>{liveAgent?.name || node.label}</span>
            <small>{prettyLabel(status)}</small>
          </button>
        )
      })}
    </div>
  )
}

function CoordinationScreen({
  overview,
  onOpenTask,
  command,
  setCommand,
  onRunCommand,
  commandOutput,
  selectedFlowNode,
  setSelectedFlowNode,
  onResolveLock,
  onRunOc219,
  onJumpToLive,
  onApproveTask,
  onRejectTask,
  onViewEdgePayload,
  onReplayEdge,
  onOpenTraceback,
  onRetryLoop,
}) {
  const blockedOrApproval = overview.tasks.filter((task) => task.status === 'blocked' || task.approvalRequired).slice(0, 4)
  const selectedAgent = overview.agents.find((agent) => agent.id === selectedFlowNode)
  const selectedAgentTasks = selectedAgent ? overview.tasks.filter((task) => task.agent === selectedAgent.id).slice(0, 3) : []
  const selectedAgentSession = selectedAgent ? overview.sessions.find((session) => session.agent === selectedAgent.id) : null
  const [popupTab, setPopupTab] = useState('node')
  const [selectedEdgeId, setSelectedEdgeId] = useState('coding-reasoning')
  const selectableEdges = FLOW_EDGES.filter((edge) => edge.id !== 'dispatch-main')
  const selectedEdge = selectableEdges.find((edge) => edge.id === selectedEdgeId) || selectableEdges[0]
  const selectedEdgeInfo = EDGE_DETAILS[selectedEdge?.id] || { reason: 'No payload details.', payload: {} }

  return (
    <div className="content-grid coordination-grid">
      <div className="main-stack">
        <Card
          title="Coordination"
          action={
            <div className="mini-actions">
              <button className="btn-ghost" onClick={onRunOc219}>
                RUN OC-219
              </button>
              <button className="btn-success" onClick={onJumpToLive}>
                LIVE STREAM
              </button>
            </div>
          }
        >
          <div className="row-between">
            <p>Unified map + flow + popup lab</p>
            <div className="chip-wrap">
              <StatusChip text="AI" tone="zeta" />
              <StatusChip text="Only Active" tone="coding" />
              <StatusChip text="Only Retry" tone="error" />
              <StatusChip text="Only Agent-to-Agent" tone="reasoning" />
            </div>
          </div>
        </Card>

        <Card title="Unified Coordination Flow" action={<button className="btn-danger" onClick={onResolveLock}>Resolve lock</button>}>
          <div className="conflict-banner">Conflict detected: Cyrus and Vista are editing retry.patch concurrently.</div>
          <CoordinationFlow overview={overview} selectedNodeId={selectedFlowNode} onSelectNode={setSelectedFlowNode} />
        </Card>

        <Card title="Mission HUD">
          <div className="row-between">
            <input className="search-input" value={command} onChange={(event) => setCommand(event.target.value)} />
            <button className="btn-primary" onClick={onRunCommand}>Run</button>
          </div>
          <pre className="code-box">{commandOutput || 'No command executed yet.'}</pre>
          <div className="cards-2">
            <Card title="Selected Node">
              <p>{selectedAgent?.name || 'User'} | {selectedAgent?.status || 'active'}</p>
              <small>{selectedAgent?.currentTask || 'Incoming dispatch'}</small>
            </Card>
            <Card title="Attention Queue">
              <div className="stack-gap">
                {blockedOrApproval.length ? blockedOrApproval.map((task) => (
                  <button key={task.id} className="btn-ghost full-width" onClick={() => onOpenTask(task)}>
                    {task.title}
                  </button>
                )) : <small>No pending attention.</small>}
              </div>
            </Card>
          </div>
        </Card>
      </div>

      <aside className="right-stack">
        <Card title="Popup Lab" action={<small>Node / Edge / Handoff / Approval / Retry</small>}>
          <div className="mini-actions wrap-actions">
            {POPUP_TABS.map((tab) => (
              <button
                key={tab}
                className={popupTab === tab ? 'btn-primary' : 'btn-ghost'}
                onClick={() => {
                  setPopupTab(tab)
                  if (tab === 'handoff') setSelectedEdgeId('coding-reasoning')
                  if (tab === 'retry') setSelectedEdgeId('vision-coding')
                }}
              >
                {prettyLabel(tab)}
              </button>
            ))}
          </div>
        </Card>

        {popupTab === 'node' && (
          <Card title="Node Popup" action={<small>{selectedAgent?.name || 'User'}</small>}>
            {selectedFlowNode === 'user' ? (
              <div className="stack-gap">
                <StatusChip text="User Entry" tone="zeta" />
                <p>Incoming request is routed to Zeta for triage and decomposition.</p>
                <small>Current workspace: {overview.workspace}</small>
              </div>
            ) : selectedAgent ? (
              <div className="stack-gap">
                <div className="row-between">
                  <h4>{selectedAgent.name}</h4>
                  <StatusChip text={selectedAgent.status} tone={selectedAgent.status} />
                </div>
                <p>{selectedAgent.currentTask}</p>
                <small>Model: {selectedAgent.model}</small>
                <small>Last update: {selectedAgent.updatedAt ? formatSince(selectedAgent.updatedAt) : 'No active session'}</small>
                <div className="chip-wrap">
                  <StatusChip text={`Tasks ${selectedAgentTasks.length}`} tone={selectedAgent.id} />
                  {selectedAgentSession && <StatusChip text="Session Linked" tone="success" />}
                </div>
                <div className="stack-gap">
                  {selectedAgentTasks.length ? (
                    selectedAgentTasks.map((task) => (
                      <button key={task.id} className="btn-ghost full-width" onClick={() => onOpenTask(task)}>
                        Open: {task.title}
                      </button>
                    ))
                  ) : (
                    <small>No task currently assigned.</small>
                  )}
                </div>
              </div>
            ) : (
              <p>Select a node to inspect details.</p>
            )}
          </Card>
        )}

        {(popupTab === 'edge' || popupTab === 'handoff') && (
          <Card title={popupTab === 'handoff' ? 'Handoff Popup' : 'Edge Popup'} action={<small>{selectedEdge.from} to {selectedEdge.to}</small>}>
            <div className="mini-actions wrap-actions">
              {selectableEdges.map((edge) => (
                <button key={edge.id} className={selectedEdge.id === edge.id ? 'btn-primary' : 'btn-ghost'} onClick={() => setSelectedEdgeId(edge.id)}>
                  {edge.label}
                </button>
              ))}
            </div>
            <p>{selectedEdgeInfo.reason}</p>
            <pre className="code-box">{JSON.stringify(selectedEdgeInfo.payload, null, 2)}</pre>
            <div className="mini-actions">
              <button className="btn-ghost" onClick={() => onViewEdgePayload(selectedEdge, selectedEdgeInfo)}>
                View payload
              </button>
              <button className="btn-ghost" onClick={() => onReplayEdge(selectedEdge, selectedEdgeInfo)}>
                Replay edge
              </button>
            </div>
          </Card>
        )}

        {popupTab === 'approval' && (
          <Card title="Approval Popup" action={<small>{overview.approvals.length} pending</small>}>
            <div className="stack-gap">
              {overview.approvals.length ? (
                overview.approvals.map((task) => (
                  <article className="approval-item" key={task.id}>
                    <h5>{task.title}</h5>
                    <div className="mini-actions">
                      <button className="btn-success" onClick={() => onApproveTask(task)}>
                        Approve
                      </button>
                      <button className="btn-danger" onClick={() => onRejectTask(task)}>
                        Reject
                      </button>
                      <button className="btn-ghost" onClick={() => onOpenTask(task)}>
                        Open
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p>No approvals pending.</p>
              )}
            </div>
          </Card>
        )}

        {popupTab === 'retry' && (
          <Card title="Retry / Error Popup" action={<small>R-14</small>}>
            <p>Retry loop is active for blocked task and handoff mismatch detection.</p>
            <div className="mini-actions">
              <button className="btn-danger" onClick={onOpenTraceback}>
                Open traceback
              </button>
              <button className="btn-danger" onClick={onRetryLoop}>
                Retry now
              </button>
            </div>
          </Card>
        )}
      </aside>
    </div>
  )
}

function DashboardScreen({
  overview,
  onOpenTask,
  command,
  setCommand,
  onRunCommand,
  commandOutput,
  commandMode,
  onCycleCommandMode,
  onAttachCommand,
  onApproveTask,
  onRejectTask,
  onRerunTask,
  onNewCommand,
  onOpenArtifacts,
  onOpenKanban,
  onJumpToLive,
}) {
  const activeTasks = overview.tasks.filter((task) => task.status !== 'done').slice(0, 3)
  const recentCommands = overview.commandHistory || []

  return (
    <div className="content-grid dashboard-grid">
      <div className="main-stack">
        <Card title="Dashboard Control Layer" action={<StatusChip text={`${activeTasks.length} items need attention`} tone="warning" />}>
          <p>Monitor orchestration, launch commands, resolve approvals.</p>
        </Card>

        <Card title="Quick Command Input" action={<small>AUTO /vision</small>}>
          <div className="command-box">
            <textarea value={command} onChange={(event) => setCommand(event.target.value)} aria-label="Quick command input" />
            <div className="row-between">
              <div className="mini-actions wrap-actions">
                <button className="btn-ghost" onClick={onAttachCommand}>Attach</button>
                <button className="btn-ghost" onClick={onCycleCommandMode}>Mode: {prettyLabel(commandMode)}</button>
                <small>/coding /reasoning /kanban /summarize</small>
              </div>
              <button className="btn-primary" onClick={onRunCommand}>
                Run
              </button>
            </div>
            <pre className="code-box">{commandOutput || 'No command executed yet.'}</pre>
          </div>
        </Card>

        <div className="cards-2">
          <Card title="Active Tasks" action={<small>{activeTasks.length} running</small>}>
            <div className="stack-gap">
              {activeTasks.length ? activeTasks.map((task) => <TaskCard key={task.id} task={task} onOpenTask={onOpenTask} />) : <p>No active tasks.</p>}
            </div>
          </Card>

          <Card title="Recent Commands" action={<small>6h window</small>}>
            <div className="stack-gap">
              {recentCommands.length ? recentCommands.slice(0, 6).map((entry) => (
                <article key={entry.id} className="task-card">
                  <div className="row-between">
                    <h4>{entry.command}</h4>
                    <StatusChip text={prettyLabel(entry.state || entry.type || 'info')} tone={entry.state || entry.type || 'info'} />
                  </div>
                  <p>{entry.taskTitle || entry.source || 'Runtime command execution'}</p>
                  <small>{entry.code !== undefined ? `code ${entry.code}` : '-'} | {formatSince(entry.ranAt)}</small>
                </article>
              )) : <p>No command history yet.</p>}
            </div>
          </Card>
        </div>

        <div className="cards-2">
          <Card title="Productivity Snapshot" action={<small>Today</small>}>
            <div className="kpi-grid">
              <MetricCard label="Tasks Completed" value={overview.productivity.autoResolved || 0} subtext="done" />
              <MetricCard label="Active Workspaces" value="5" subtext="workspace graph" />
              <MetricCard label="Approvals Pending" value={overview.productivity.approvalsPending || 0} subtext="queue" />
              <MetricCard label="Avg Completion" value={overview.productivity.avgResponse || '-'} subtext="rolling" />
              <MetricCard label="Success Ratio" value="92%" subtext="pipeline quality" />
              <MetricCard label="Agent Utilization" value="74%" subtext="capacity" />
            </div>
          </Card>

          <Card title="Timeline / Attention Queue" action={<small>Live events</small>}>
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
        <Card title="Agent Status" action={<small>avg response</small>}>
          <div className="stack-gap">{overview.agents.map((agent) => <AgentRow key={agent.id} agent={agent} />)}</div>
        </Card>
        <Card title="Approvals" action={<small>{overview.approvals.length} pending</small>}>
          <div className="stack-gap">
            {overview.approvals.length ? (
              overview.approvals.map((task) => (
                <article className="approval-item" key={task.id}>
                  <p>{task.title}</p>
                  <div className="mini-actions wrap-actions">
                    <button className="btn-success" onClick={() => onApproveTask(task)}>Approve</button>
                    <button className="btn-danger" onClick={() => onRejectTask(task)}>Reject</button>
                    <button className="btn-ghost" onClick={() => onRerunTask(task)}>Edit & rerun</button>
                  </div>
                </article>
              ))
            ) : (
              <p>No approvals pending.</p>
            )}
          </div>
        </Card>
        <Card title="Notifications" action={<small>{overview.activity.length} unread</small>}>
          <div className="stack-gap">
            <p>{overview.logs[0] || 'No alert.'}</p>
            <button className="btn-ghost" onClick={onJumpToLive}>Open Activity Logs</button>
          </div>
        </Card>
        <Card title="Shortcuts">
          <div className="shortcut-grid">
            <button className="btn-ghost" onClick={onNewCommand}>New Command</button>
            <button className="btn-ghost" onClick={onOpenArtifacts}>Artifacts</button>
            <button className="btn-ghost" onClick={onOpenKanban}>Open Kanban</button>
          </div>
        </Card>
      </aside>
    </div>
  )
}

function CommandCenterScreen({ selectedTask, overview, onTaskPatch, onOpenTask, onRunTask, actionState }) {
  const fallbackTask = selectedTask || overview.tasks[0] || null

  if (!fallbackTask) {
    return (
      <div className="content-grid">
        <div className="main-stack">
          <Card title="Task Context">
            <p>No task available yet. Create one from Kanban or Quick Command flow.</p>
          </Card>
        </div>
      </div>
    )
  }

  const relatedSession = overview.sessions.find((session) => session.sessionKey === fallbackTask.sessionKey)

  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Task Context">
          <div className="text-block">
            <h2>{fallbackTask.title}</h2>
            <p>{fallbackTask.description || 'No description provided.'}</p>
            <div className="chip-wrap">
              <StatusChip text={fallbackTask.agent} tone={fallbackTask.agent} />
              <StatusChip text={fallbackTask.priority} tone={fallbackTask.priority} />
              <StatusChip text={fallbackTask.status} tone={fallbackTask.status} />
            </div>
          </div>
        </Card>

        <Card title="Linked Session">
          <pre className="code-box">{relatedSession ? JSON.stringify(relatedSession, null, 2) : 'No linked session'}</pre>
          <div className="top-gap">
            <small>
              Last run: {fallbackTask.lastRunStatus || 'never'}
              {fallbackTask.lastRunAt ? ` · ${formatSince(fallbackTask.lastRunAt)}` : ''}
            </small>
            {fallbackTask.lastRunError && <pre className="code-box">{fallbackTask.lastRunError}</pre>}
          </div>
        </Card>

        <Card title="Execution Controls">
          <div className="mini-actions wrap-actions">
            <button className="btn-primary" onClick={() => onRunTask(fallbackTask)} disabled={actionState.runningTaskId === fallbackTask.id}>
              {actionState.runningTaskId === fallbackTask.id ? 'Running...' : 'Run Task'}
            </button>
            <button className="btn-success" onClick={() => onTaskPatch(fallbackTask.id, { status: 'done', progress: 100 })}>
              Mark Done
            </button>
            <button
              className="btn-ghost"
              onClick={() => onTaskPatch(fallbackTask.id, { status: 'in-progress', progress: Math.min(100, Number(fallbackTask.progress || 0) + 10) })}
            >
              Advance Progress
            </button>
            <button className="btn-danger" onClick={() => onTaskPatch(fallbackTask.id, { status: 'blocked' })}>
              Block
            </button>
          </div>
        </Card>

        <Card title="Task Queue">
          <div className="feed-list">
            {overview.tasks.slice(0, 8).map((task) => (
              <FeedRow
                key={task.id}
                item={{
                  title: task.title,
                  subtitle: `${prettyLabel(task.agent)} · ${prettyLabel(task.priority)}`,
                  state: task.status,
                }}
                onAction={() => onOpenTask(task)}
              />
            ))}
          </div>
        </Card>
      </div>

      <aside className="right-stack">
        <Card title="Approvals">
          <p>{fallbackTask.approvalRequired ? 'Approval is required.' : 'No approval needed.'}</p>
        </Card>
        <Card title="Files">
          <ul className="list-plain">
            <li>{fallbackTask.sessionKey || 'No linked artifact'}</li>
          </ul>
        </Card>
      </aside>
    </div>
  )
}

function KanbanScreen({ tasks, onOpenTask, onTaskPatch, onCreateTask, onGenerateTasks, onRunTask, actionState }) {
  const columns = KANBAN_COLUMNS
  const workspaceOptions = ['all', ...WORKSPACE_PRESETS]
  const [search, setSearch] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [workspaceFilter, setWorkspaceFilter] = useState('all')
  const [activeOnly, setActiveOnly] = useState(false)
  const [generating, setGenerating] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((task) => {
      const taskWorkspace = task.workspace || WORKSPACE_PRESETS[0]
      if (workspaceFilter !== 'all' && taskWorkspace !== workspaceFilter) return false
      if (activeOnly && task.status === 'done') return false
      if (!q) return true
      return [task.title, task.description, task.agent, task.status, taskWorkspace].join(' ').toLowerCase().includes(q)
    })
  }, [tasks, search, workspaceFilter, activeOnly])

  const grouped = Object.fromEntries(
    columns.map((key) => [
      key,
      filtered.filter((task) => {
        if (key === 'todo') return task.status === 'todo' || task.status === 'assigned'
        return task.status === key
      }),
    ]),
  )

  function quickMove(taskId, column) {
    const patch = { status: column }
    if (column === 'done') {
      patch.progress = 100
      patch.approvalRequired = false
    }
    if (column === 'waiting-review') {
      patch.approvalRequired = true
    }
    onTaskPatch(taskId, patch)
  }

  async function handleGenerate() {
    setGenerating(true)
    try {
      await onGenerateTasks(workspaceFilter === 'all' ? WORKSPACE_PRESETS[0] : workspaceFilter)
    } catch {
      // command output panel shows the error details
    } finally {
      setGenerating(false)
    }
  }

  function addCardToColumn(column) {
    const workspace = workspaceFilter === 'all' ? WORKSPACE_PRESETS[0] : workspaceFilter
    const status = column === 'todo' ? 'todo' : column
    const options = {
      status,
      workspace,
      approvalRequired: column === 'waiting-review',
      progress: column === 'done' ? 100 : 0,
    }
    onCreateTask(`New ${kanbanColumnLabel(column)} Task`, 'Created from Kanban quick add.', options)
  }

  return (
    <div className="kanban-page">
      <header className="kanban-head">
        <div>
          <h2>Kanban Work Layer</h2>
          <p>Turn AI outputs into prioritized operational execution</p>
        </div>
        <div className="mini-actions wrap-actions">
          <button className="btn-ghost" onClick={() => setWorkspaceFilter(nextInList(workspaceOptions, workspaceFilter))}>
            Workspace: {workspaceFilter === 'all' ? 'All' : workspaceFilter}
          </button>
          <input className="search-input compact-input" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
          <button className={activeOnly ? 'btn-primary' : 'btn-ghost'} onClick={() => setActiveOnly((current) => !current)}>
            Filter: {activeOnly ? 'Active' : 'All'}
          </button>
          <button className="btn-success" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating...' : 'AI Generate'}
          </button>
          <input className="search-input compact-input" placeholder="New task title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
          <input className="search-input compact-input" placeholder="Description" value={newDescription} onChange={(event) => setNewDescription(event.target.value)} />
          <button
            className="btn-primary"
            onClick={() => {
              onCreateTask(newTitle, newDescription, { workspace: workspaceFilter === 'all' ? WORKSPACE_PRESETS[0] : workspaceFilter })
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
          <section key={column} className={`kanban-column kanban-${column}`}>
            <header className="row-between">
              <h4>{kanbanColumnLabel(column)}</h4>
              <small>{grouped[column].length}</small>
            </header>

            <div className="stack-gap">
              {grouped[column].map((task) => (
                <article key={task.id} className="kanban-card">
                  <h5>{task.title}</h5>
                  <p>{task.description || 'No description'}</p>
                  <small>{task.workspace || WORKSPACE_PRESETS[0]}</small>
                  <div className="chip-wrap">
                    <StatusChip text={task.agent} tone={task.agent} />
                    <StatusChip text={task.priority} tone={task.priority} />
                  </div>
                  <div className="mini-actions wrap-actions">
                    <button className="btn-ghost" onClick={() => onOpenTask(task)}>
                      Open
                    </button>
                    {task.status !== 'done' && (
                      <button className="btn-primary" onClick={() => onRunTask(task)} disabled={actionState.runningTaskId === task.id}>
                        {actionState.runningTaskId === task.id ? 'Running...' : 'Run Task'}
                      </button>
                    )}
                    {column !== 'done' && <button className="btn-success" onClick={() => quickMove(task.id, 'done')}>Done</button>}
                    {column === 'inbox' && <button className="btn-ghost" onClick={() => quickMove(task.id, 'todo')}>To Do</button>}
                    {column === 'todo' && <button className="btn-ghost" onClick={() => quickMove(task.id, 'in-progress')}>Start</button>}
                    {column === 'in-progress' && <button className="btn-ghost" onClick={() => quickMove(task.id, 'waiting-review')}>Review</button>}
                    {column === 'waiting-review' && <button className="btn-ghost" onClick={() => quickMove(task.id, 'done')}>Approve</button>}
                  </div>
                </article>
              ))}
              <button
                className="btn-ghost full-width"
                onClick={() => addCardToColumn(column)}
              >
                + Add card
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

function ArtifactsScreen() {
  const [artifacts, setArtifacts] = useState([])
  const [meta, setMeta] = useState({ root: '', scannedAt: null, count: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadArtifacts = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/artifacts')
      if (!response.ok) throw new Error('Failed to load artifacts')
      const data = await response.json()
      const list = Array.isArray(data) ? data : data.artifacts || []
      setArtifacts(list)
      setMeta({
        root: data.root || '',
        scannedAt: data.scannedAt || null,
        count: typeof data.count === 'number' ? data.count : list.length,
      })
      setError('')
    } catch (loadError) {
      setError(loadError.message || 'Failed to load artifacts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadArtifacts()
    const interval = setInterval(loadArtifacts, 30000)
    return () => clearInterval(interval)
  }, [loadArtifacts])

  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card
          title="Artifacts Library"
          action={
            <button className="btn-ghost" onClick={loadArtifacts}>
              Refresh
            </button>
          }
        >
          <div className="feed-list">
            {loading && <p className="muted">Loading artifacts...</p>}
            {error && <p className="muted">{error}</p>}
            {!loading && !error && artifacts.length === 0 && (
              <p className="muted">No artifacts found.</p>
            )}
            {artifacts.map((artifact) => (
              <FeedRow
                key={`${artifact.path || artifact.name}`}
                item={{
                  title: artifact.path || artifact.name,
                  subtitle: [
                    artifact.extension ? artifact.extension.toUpperCase() : 'FILE',
                    formatBytes(artifact.size),
                    artifact.modifiedAt ? `updated ${formatSince(artifact.modifiedAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
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
            <p>{meta.root ? `Workspace: ${meta.root}` : 'Workspace scan ready.'}</p>
            <p>{meta.count ? `${meta.count} artifacts available.` : 'No artifacts cached.'}</p>
            {meta.scannedAt && <p>Last scan {formatSince(meta.scannedAt)}.</p>}
          </div>
        </Card>
      </aside>
    </div>
  )
}

function WorkspacesScreen({ overview }) {
  const [workspaces, setWorkspaces] = useState({
    root: '',
    scannedAt: '',
    containers: [],
    directories: [],
    containerError: '',
    directoryError: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadWorkspaces = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/workspaces')
      if (!response.ok) throw new Error('Failed to load workspaces data.')
      const payload = await response.json()
      setWorkspaces(payload)
    } catch (err) {
      setError(err.message || 'Unable to load workspaces data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadWorkspaces()
  }, [loadWorkspaces])

  const directoryRows = workspaces.directories || []
  const containerRows = workspaces.containers || []

  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card
          title="Workspace Directories"
          action={
            <button className="btn-ghost" onClick={loadWorkspaces}>
              Refresh
            </button>
          }
        >
          <div className="feed-list">
            {loading && <p className="muted">Loading workspace directories...</p>}
            {error && <p className="muted">{error}</p>}
            {!loading && !error && !directoryRows.length && (
              <p className="muted">No directories found.</p>
            )}
            {workspaces.directoryError && <p className="muted">{workspaces.directoryError}</p>}
            {directoryRows.map((entry) => (
              <FeedRow
                key={entry.name}
                item={{
                  title: entry.name,
                  subtitle: [
                    entry.path ? `path: ${entry.path}` : null,
                    entry.modifiedAt ? `updated ${formatSince(entry.modifiedAt)}` : null,
                    Number.isFinite(entry.size) ? formatBytes(entry.size) : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  state: 'Ready',
                }}
              />
            ))}
          </div>
        </Card>

        <Card title="Docker Containers">
          <div className="feed-list">
            {loading && <p className="muted">Loading container list...</p>}
            {!loading && !containerRows.length && (
              <p className="muted">No running containers found.</p>
            )}
            {workspaces.containerError && <p className="muted">{workspaces.containerError}</p>}
            {containerRows.map((container) => {
              const statusText = container.Status || ''
              const isUp = /up/i.test(statusText)
              return (
                <FeedRow
                  key={container.ID || container.Names}
                  item={{
                    title: container.Names || container.ID || 'container',
                    subtitle: [
                      container.Image,
                      statusText,
                      container.RunningFor,
                      container.Ports ? `ports: ${container.Ports}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    state: isUp ? 'Active' : 'Idle',
                  }}
                />
              )
            })}
          </div>
        </Card>
      </div>

      <aside className="right-stack">
        <Card title="Workspace Summary">
          <ul className="list-plain">
            <li>Root: {workspaces.root || 'unknown'}</li>
            <li>Directories: {directoryRows.length}</li>
            <li>Containers: {containerRows.length}</li>
            <li>Last scan: {workspaces.scannedAt ? formatSince(workspaces.scannedAt) : 'n/a'}</li>
          </ul>
        </Card>

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

function ReportsScreen({ overview }) {
  const doneReports = overview.reports || []

  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Reports / Zeta Recap" action={<small>{doneReports.length} done summaries</small>}>
          <div className="stack-gap">
            {doneReports.length ? (
              doneReports.map((report) => (
                <article className="report-card" key={report.taskId}>
                  <div className="row-between">
                    <h4>{report.title}</h4>
                    <StatusChip text="done" tone="success" />
                  </div>
                  <small>
                    {report.completedDate} {report.completedTime} ({report.completedAt ? formatLocalDateTime(report.completedAt) : '-'})
                  </small>
                  <p><strong>Task:</strong> {report.taskId}</p>
                  <p><strong>Terlibat:</strong> {(report.participants || []).join(', ') || '-'}</p>
                  <p><strong>Model:</strong> {(report.models || []).join(', ') || '-'}</p>
                  <p><strong>Apa dikerjakan:</strong> {report.workDone}</p>
                  <p><strong>Output:</strong> {report.output}</p>
                  <p><strong>Kesimpulan:</strong> {report.conclusion}</p>
                  <p><strong>Saran perbaikan:</strong> {report.improvementSuggestions}</p>
                  <p><strong>Pro:</strong> {(report.pros || []).join(' | ') || '-'}</p>
                  <p><strong>Kontra:</strong> {(report.cons || []).join(' | ') || '-'}</p>
                </article>
              ))
            ) : (
              <p>Belum ada task done yang masuk report.</p>
            )}
          </div>
        </Card>
      </div>

      <aside className="right-stack">
        <Card title="Report Rules">
          <ul className="list-plain">
            <li>Status done otomatis membuat recap Zeta.</li>
            <li>Report tersimpan di SQL (`reports.sqlite`).</li>
            <li>`memory.md` selalu sinkron dengan semua done task.</li>
          </ul>
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
    { key: 'organizationName', label: 'Organization Name', type: 'text' },
    { key: 'defaultWorkspace', label: 'Default Workspace', type: 'text' },
    { key: 'region', label: 'Region', type: 'text' },
    { key: 'timeFormat', label: 'Time Format', type: 'text' },
    { key: 'criticalAlerts', label: 'Critical alerts', type: 'text' },
    { key: 'approvalReminders', label: 'Approval reminders', type: 'text' },
    { key: 'digestSummary', label: 'Digest summary', type: 'text' },
    { key: 'incidentChannel', label: 'Incident channel', type: 'text' },
    { key: 'primaryModel', label: 'Primary model', type: 'text' },
    { key: 'fallbackModel', label: 'Fallback model', type: 'text' },
    { key: 'maxAutoRuns', label: 'Max auto-runs', type: 'number' },
    { key: 'budgetGuardrail', label: 'Budget guardrail', type: 'text' },
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
            {fields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  type={field.type}
                  value={draft[field.key] ?? ''}
                  onChange={(event) => {
                    const nextValue = field.type === 'number' ? Number(event.target.value || 0) : event.target.value
                    setDraft((current) => ({ ...current, [field.key]: nextValue }))
                  }}
                />
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

  const [overview, setOverview] = useState({
    appName: 'OpenClaw Command Center',
    workspace: 'OpenClaw Ops',
    sessions: [],
    agents: [],
    tasks: [],
    approvals: [],
    activity: [],
    commandHistory: [],
    reports: [],
    reportSummary: { doneTasks: 0, lastReportAt: null },
    productivity: {},
    system: { memory: {}, disk: {}, uptime: 0 },
    logs: [],
    gateway: { connected: false, statusPath: null, channelSummary: [] },
    generatedAt: Date.now(),
  })

  const [settings, setSettings] = useState({})
  const [selectedTask, setSelectedTask] = useState(null)
  const [selectedFlowNode, setSelectedFlowNode] = useState('main')
  const [command, setCommand] = useState('openclaw status')
  const [commandMode, setCommandMode] = useState('auto')
  const [topSearch, setTopSearch] = useState('')
  const [commandOutput, setCommandOutput] = useState('No command executed yet.')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [streamConnected, setStreamConnected] = useState(false)
  const [actionState, setActionState] = useState({ runningTaskId: null })
  const actionBearerToken = import.meta.env.VITE_ACTION_TOKEN

  const apiRequest = useCallback(async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase()
    const headers = {
      ...(options.headers || {}),
    }
    if (method !== 'GET' && method !== 'HEAD') {
      headers['X-OpenClaw-Action'] = '1'
      if (!headers['Content-Type'] && options.body) {
        headers['Content-Type'] = 'application/json'
      }
    }
    if (actionBearerToken) {
      headers.Authorization = `Bearer ${actionBearerToken}`
    }
    return fetch(url, { ...options, method, headers })
  }, [actionBearerToken])

  const apiJson = useCallback(
    async (url, options = {}) => {
      const response = await apiRequest(url, options)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.detail || payload.error || `Request failed (${response.status})`)
      }
      return payload
    },
    [apiRequest],
  )

  const loadOverview = useCallback(async () => {
    try {
      const [overviewData, settingsData] = await Promise.all([
        apiJson('/api/overview'),
        apiJson('/api/settings'),
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
  }, [apiJson, selectedTask])

  useEffect(() => {
    loadOverview()
    let fallback = null
    function ensureFallback() {
      if (!fallback) {
        fallback = setInterval(loadOverview, 30000)
      }
    }
    function clearFallback() {
      if (fallback) {
        clearInterval(fallback)
        fallback = null
      }
    }

    const stream = new EventSource('/api/stream')
    stream.addEventListener('hello', () => {
      setStreamConnected(true)
      clearFallback()
    })
    stream.addEventListener('overview', (event) => {
      setStreamConnected(true)
      clearFallback()
      try {
        const incoming = JSON.parse(event.data)
        setOverview(incoming)
      } catch {
        // ignore malformed stream events
      }
    })
    stream.onerror = () => {
      setStreamConnected(false)
      ensureFallback()
    }

    return () => {
      clearFallback()
      stream.close()
    }
  }, [loadOverview])

  async function patchTask(taskId, patch) {
    await apiJson(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    await loadOverview()
  }

  async function createTask(title, description, options = {}) {
    if (!title.trim()) return
    await apiJson('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description,
        agent: options.agent || 'main',
        priority: options.priority || 'normal',
        status: options.status || 'inbox',
        approvalRequired: Boolean(options.approvalRequired),
        workspace: options.workspace || overview.workspace || WORKSPACE_PRESETS[0],
        progress: typeof options.progress === 'number' ? options.progress : 0,
      }),
    })
    await loadOverview()
  }

  async function saveSettings(nextSettings) {
    const data = await apiJson('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(nextSettings),
    })
    setSettings(data)
  }

  async function runTask(task, action = 'run') {
    setActionState({ runningTaskId: task.id })
    try {
      const endpoint = action === 'run' ? 'run' : action
      const data = await apiJson(`/api/tasks/${task.id}/${endpoint}`, {
        method: 'POST',
      })
      await loadOverview()
      if (data.task) setSelectedTask(data.task)
      setCommandOutput(`${prettyLabel(action)} success: ${task.title}\nSession: ${data.dispatch?.sessionKey || data.task?.sessionKey || '-'}`)
    } catch (error) {
      await loadOverview()
      setCommandOutput(`${prettyLabel(action)} failed: ${task.title}\n${error.message || 'Unknown error.'}`)
    } finally {
      setActionState({ runningTaskId: null })
    }
  }

  async function runCommand(commandOverride) {
    const baseCommand = String(commandOverride || command).trim()
    if (!baseCommand) return

    try {
      let effectiveCommand = baseCommand
      if (commandMode !== 'auto' && effectiveCommand.startsWith('openclaw ') && !effectiveCommand.includes('--agent')) {
        effectiveCommand = `${effectiveCommand} --agent ${commandMode}`
      }

      if (commandOverride) setCommand(baseCommand)
      const data = await apiJson('/api/command', {
        method: 'POST',
        body: JSON.stringify({ command: effectiveCommand }),
      })
      setCommandOutput([`$ ${data.command || effectiveCommand}`, data.stdout || '', data.stderr || '', data.error || ''].filter(Boolean).join('\n'))
    } catch (runError) {
      setCommandOutput(`Command failed: ${runError.message || 'Unknown error.'}`)
    }
  }

  function openTask(task) {
    setSelectedTask(task)
    navigate('/command-center')
  }

  async function cycleWorkspacePreset() {
    const currentWorkspace = settings.defaultWorkspace || overview.workspace || WORKSPACE_PRESETS[0]
    const nextWorkspace = nextInList(WORKSPACE_PRESETS, currentWorkspace)
    await saveSettings({ defaultWorkspace: nextWorkspace })
    await loadOverview()
  }

  function cycleCommandMode() {
    setCommandMode((current) => nextInList(COMMAND_MODES, current))
  }

  function attachCommand() {
    setCommand((current) => (current.includes('--attach ') ? current : `${current} --attach ./artifacts/context.md`))
  }

  function prepareNewCommand() {
    setCommand('openclaw status --json')
    navigate('/dashboard')
  }

  function jumpToLive() {
    navigate('/activity-logs')
  }

  function openArtifacts() {
    navigate('/artifacts')
  }

  function openKanban() {
    navigate('/kanban')
  }

  async function approveTask(task) {
    try {
      await apiJson(`/api/tasks/${task.id}/approve`, { method: 'POST' })
      await loadOverview()
      setCommandOutput(`Approved: ${task.title}`)
    } catch (approveError) {
      setCommandOutput(`Approve failed: ${approveError.message || 'Unknown error.'}`)
    }
  }

  async function rejectTask(task) {
    try {
      await apiJson(`/api/tasks/${task.id}/reject`, { method: 'POST' })
      await loadOverview()
      setCommandOutput(`Rejected: ${task.title} moved to blocked`)
    } catch (rejectError) {
      setCommandOutput(`Reject failed: ${rejectError.message || 'Unknown error.'}`)
    }
  }

  async function rerunTask(task) {
    await runTask(task, 'retry')
    setSelectedTask(task)
    navigate('/command-center')
  }

  async function resolveCoordinationLock() {
    const lockedTask = overview.tasks.find((task) => task.status === 'blocked' || task.status === 'waiting-review')
    if (!lockedTask) {
      setCommandOutput('No lock detected. Nothing to resolve.')
      return
    }
    await runTask(lockedTask, 'retry')
    setCommandOutput(`Resolved lock and re-dispatched: ${lockedTask.title}`)
  }

  function viewEdgePayload(edge, edgeInfo) {
    setCommandOutput(
      [`Edge: ${edge.id}`, `From: ${edge.from}`, `To: ${edge.to}`, `Reason: ${edgeInfo.reason}`, JSON.stringify(edgeInfo.payload, null, 2)].join('\n'),
    )
  }

  async function replayEdge(edge) {
    const routedTask = overview.tasks.find((task) => task.agent === edge.to && task.status !== 'done') || overview.tasks.find((task) => task.status !== 'done')
    if (!routedTask) {
      setCommandOutput(`Replay skipped: no active task for edge ${edge.id}`)
      return
    }
    await runTask(routedTask, 'replay')
    setCommandOutput(`Replay edge ${edge.id} -> task ${routedTask.title}`)
  }

  async function retryLoop() {
    const blockedTask = overview.tasks.find((task) => task.status === 'blocked')
    if (!blockedTask) {
      setCommandOutput('No blocked task found for retry.')
      return
    }
    await runTask(blockedTask, 'retry')
    setCommandOutput(`Retry dispatched: ${blockedTask.title}`)
  }

  function openTraceback() {
    navigate('/activity-logs')
  }

  async function runOc219() {
    await runCommand('openclaw status --json')
  }

  async function generateTasks(workspaceName) {
    try {
      const data = await apiJson('/api/tasks/generate', {
        method: 'POST',
        body: JSON.stringify({ workspace: workspaceName }),
      })
      await loadOverview()
      const createdCount = Array.isArray(data.items) ? data.items.length : 0
      if (!createdCount) throw new Error('Backend returned 0 generated tasks.')
      setCommandOutput(`AI Generate created ${createdCount} tasks for workspace ${workspaceName}.`)
    } catch (generateError) {
      setCommandOutput(`AI Generate failed: ${generateError.message || 'Unknown error.'}`)
      throw generateError
    }
  }

  function handleTopSearchKeyDown(event) {
    if (event.key !== 'Enter') return
    const query = topSearch.trim().toLowerCase()
    if (!query) return
    const match = overview.tasks.find((task) => [task.title, task.description, task.agent, task.status].join(' ').toLowerCase().includes(query))
    if (match) {
      openTask(match)
      return
    }
    navigate('/dashboard')
    setCommandOutput(`No task matched "${topSearch}".`)
  }

  const navWithBadges = sideNav.map((item) => {
    if (item.label === 'Coordination') return { ...item, badge: String(overview.approvals.length || '') }
    if (item.label === 'Command Center') return { ...item, badge: selectedTask ? '1' : '' }
    if (item.label === 'Kanban') return { ...item, badge: String(overview.tasks.length || '') }
    if (item.label === 'Reports') return { ...item, badge: String(overview.reportSummary?.doneTasks || overview.reports.length || '') }
    if (item.label === 'Activity Logs') return { ...item, badge: String(overview.activity.length || '') }
    return { ...item, badge: '' }
  })

  return (
    <div className="app-root">
      <div className="app-shell">
        <header className="top-nav">
          <div className="top-left">
            <div className="brand-box">
              <div className="brand-icon" />
              <div>
                <strong>{overview.appName}</strong>
                <small>WORKSPACE // {overview.workspace}</small>
              </div>
            </div>
            <button className="btn-ghost" onClick={cycleWorkspacePreset}>
              {settings.defaultWorkspace || overview.workspace}
            </button>
          </div>

          <div className="top-actions">
            <input
              className="search-input"
              value={topSearch}
              placeholder="Search tasks, artifacts, commands"
              onChange={(event) => setTopSearch(event.target.value)}
              onKeyDown={handleTopSearchKeyDown}
            />
            <button className="btn-primary" onClick={prepareNewCommand}>+ New Command</button>
            <button className="btn-ghost" onClick={() => navigate('/dashboard')}>
              {overview.approvals.length}
            </button>
            <button className="btn-ghost" onClick={() => navigate('/kanban')}>
              {overview.tasks.length}
            </button>
            <button className="btn-ghost" onClick={loadOverview}>{streamConnected ? 'Live' : 'Sync'}</button>
            <button className="btn-ghost" onClick={() => navigate('/workspaces')}>
              {overview.gateway.connected ? 'Nadya' : 'Offline'}
            </button>
            <button className="btn-primary" onClick={loadOverview}>
              Refresh
            </button>
          </div>
        </header>

        <div className="app-body">
          <aside className="side-nav">
            <div className="workspace-box">
              <small>ACTIVE WORKSPACE</small>
              <p>{overview.workspace}</p>
            </div>
            {navWithBadges.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
                <span>{item.label}</span>
                {item.badge && <small className="nav-badge">{item.badge}</small>}
              </NavLink>
            ))}
            <div className="system-health">
              <small>SYSTEM HEALTH</small>
              <div className="row-between">
                <strong>Agent fabric</strong>
                <strong className="ok">{(100 - Number(overview.system?.cpu?.usage || 0) / 2).toFixed(1)}%</strong>
              </div>
              <div className="health-track">
                <div className="health-fill" style={{ width: `${Math.max(6, Math.min(100, 100 - Number(overview.system?.cpu?.usage || 0) / 2))}%` }} />
              </div>
            </div>
          </aside>

          <main className="page-main">
            {loading ? (
              <p>Loading dashboard...</p>
            ) : error ? (
              <p>{error}</p>
            ) : (
              <Routes>
                <Route
                  path="/coordination"
                  element={
                    <CoordinationScreen
                      overview={overview}
                      onOpenTask={openTask}
                      command={command}
                      setCommand={setCommand}
                      onRunCommand={runCommand}
                      commandOutput={commandOutput}
                      selectedFlowNode={selectedFlowNode}
                      setSelectedFlowNode={setSelectedFlowNode}
                      onResolveLock={resolveCoordinationLock}
                      onRunOc219={runOc219}
                      onJumpToLive={jumpToLive}
                      onApproveTask={approveTask}
                      onRejectTask={rejectTask}
                      onViewEdgePayload={viewEdgePayload}
                      onReplayEdge={replayEdge}
                      onOpenTraceback={openTraceback}
                      onRetryLoop={retryLoop}
                    />
                  }
                />
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
                      commandMode={commandMode}
                      onCycleCommandMode={cycleCommandMode}
                      onAttachCommand={attachCommand}
                      onApproveTask={approveTask}
                      onRejectTask={rejectTask}
                      onRerunTask={rerunTask}
                      onNewCommand={prepareNewCommand}
                      onOpenArtifacts={openArtifacts}
                      onOpenKanban={openKanban}
                      onJumpToLive={jumpToLive}
                    />
                  }
                />
                <Route
                  path="/command-center"
                  element={<CommandCenterScreen selectedTask={selectedTask} overview={overview} onTaskPatch={patchTask} onOpenTask={openTask} onRunTask={runTask} actionState={actionState} />}
                />
                <Route
                  path="/kanban"
                  element={
                    <KanbanScreen
                      tasks={overview.tasks}
                      onOpenTask={openTask}
                      onTaskPatch={patchTask}
                      onCreateTask={createTask}
                      onGenerateTasks={generateTasks}
                      onRunTask={runTask}
                      actionState={actionState}
                    />
                  }
                />
                <Route path="/artifacts" element={<ArtifactsScreen />} />
                <Route path="/workspaces" element={<WorkspacesScreen overview={overview} />} />
                <Route path="/reports" element={<ReportsScreen overview={overview} />} />
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

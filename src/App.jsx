import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'

const sideNav = [
  { to: '/dashboard', label: 'Dashboard', badge: '' },
  { to: '/command-center', label: 'Command Center', badge: '2' },
  { to: '/kanban', label: 'Kanban', badge: '5' },
  { to: '/artifacts', label: 'Artifacts', badge: '4' },
  { to: '/workspaces', label: 'Workspaces', badge: '' },
  { to: '/activity-logs', label: 'Activity Logs', badge: '19' },
  { to: '/settings', label: 'Settings', badge: '' },
]

const agentTone = {
  zeta: 'zeta',
  coding: 'coding',
  reasoning: 'reasoning',
  vision: 'vision',
  warning: 'warning',
  success: 'success',
  error: 'error',
}

function StatusChip({ text, tone = 'zeta' }) {
  return (
    <span className={`status-chip ${tone}`}>
      <span className="chip-dot" />
      {text}
    </span>
  )
}

function TaskCard({ title, agents, status, step, progress, start, approval }) {
  return (
    <article className="task-card">
      <div className="row-between">
        <h4>{title}</h4>
        <StatusChip text={status} tone={agentTone[status] ? status : 'zeta'} />
      </div>
      <div className="chip-wrap">
        {agents.map((agent) => (
          <StatusChip key={agent} text={agent} tone={agentTone[agent] ? agent : 'zeta'} />
        ))}
      </div>
      <p className="muted">Step: {step}</p>
      <div className="progress-track" aria-label="Task progress">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="row-between">
        <small>Started {start}</small>
        {approval && <StatusChip text="Approval Needed" tone="warning" />}
      </div>
      <div className="mini-actions">
        <button className="btn-ghost">View</button>
        <button className="btn-ghost">Pause</button>
        <button className="btn-ghost">Details</button>
      </div>
    </article>
  )
}

function AgentRow({ name, tone, state, currentTask, output, avg }) {
  return (
    <article className="agent-row">
      <div>
        <strong>{name}</strong>
        <p>{currentTask}</p>
      </div>
      <div className="agent-meta">
        <StatusChip text={state} tone={tone} />
        <small>{output}</small>
        <small>{avg}</small>
      </div>
    </article>
  )
}

function ApprovalItem({ kind, reason }) {
  return (
    <article className="approval-item">
      <div>
        <h5>{kind}</h5>
        <p>{reason}</p>
      </div>
      <div className="mini-actions">
        <button className="btn-success">Approve</button>
        <button className="btn-danger">Reject</button>
        <button className="btn-ghost">Edit + Rerun</button>
      </div>
    </article>
  )
}

function Card({ title, children, action }) {
  return (
    <section className="panel-card">
      <header className="card-head">
        <h3>{title}</h3>
        {action && <button className="btn-ghost">{action}</button>}
      </header>
      {children}
    </section>
  )
}

function DashboardScreen() {
  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Quick Command" action="Templates">
          <div className="command-box">
            <textarea
              defaultValue="Build me a growth summary from this week, include anomalies, blocked tasks, and action recommendations."
              aria-label="Quick command input"
            />
            <div className="row-between">
              <div className="row-inline">
                <button className="btn-ghost">Attach</button>
                <button className="btn-ghost">Mode: Deep Ops</button>
                <small>/summarize /rerun /handoff /commit</small>
              </div>
              <button className="btn-primary">Run Command</button>
            </div>
          </div>
        </Card>

        <Card title="Active Tasks Summary" action="Open Command Center">
          <div className="cards-2">
            <TaskCard
              title="Sync auth flow for launch candidate"
              agents={['zeta', 'coding']}
              status="success"
              step="Testing rollback scenario"
              progress={78}
              start="09:12"
              approval={false}
            />
            <TaskCard
              title="Weekly executive digest and outlier detection"
              agents={['reasoning', 'vision']}
              status="warning"
              step="Waiting for budget approval"
              progress={63}
              start="08:40"
              approval
            />
          </div>
        </Card>

        <Card title="Recent Commands Feed" action="View All">
          <div className="feed-list">
            {[
              {
                cmd: 'Compare conversion before and after funnel patch',
                who: 'zeta + reasoning',
                ws: 'growth-lab',
                when: '11m ago',
                state: 'success',
              },
              {
                cmd: 'Generate candidate landing hero variants',
                who: 'vision',
                ws: 'marketing-q2',
                when: '26m ago',
                state: 'warning',
              },
              {
                cmd: 'Refactor retries in billing webhooks',
                who: 'coding',
                ws: 'payments-core',
                when: '44m ago',
                state: 'error',
              },
            ].map((item) => (
              <article className="feed-row" key={item.cmd}>
                <div>
                  <h4>{item.cmd}</h4>
                  <p>
                    {item.who} • {item.ws} • {item.when}
                  </p>
                </div>
                <div className="feed-actions">
                  <StatusChip text={item.state} tone={item.state} />
                  <button className="btn-ghost">Open</button>
                  <button className="btn-ghost">Re-run</button>
                </div>
              </article>
            ))}
          </div>
        </Card>

        <div className="cards-2">
          <Card title="Productivity Snapshot">
            <div className="kpi-grid">
              {[
                ['Commands Today', '42', '+13%'],
                ['Auto-Resolved', '18', '+5'],
                ['Approvals Pending', '3', '-2'],
                ['Avg Response', '1.8s', '-0.2s'],
                ['Blocked Tasks', '2', '+1'],
                ['Artifacts Created', '27', '+7'],
              ].map(([k, v, delta]) => (
                <div className="kpi" key={k}>
                  <small>{k}</small>
                  <strong>{v}</strong>
                  <span>{delta}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Timeline / Attention Queue">
            <div className="timeline">
              {[
                ['09:32', 'Approval requested', 'Deploy staging migration'],
                ['09:17', 'Blocked', 'Missing env key on worker cluster'],
                ['08:58', 'Completed', 'Dashboard alert triage batch'],
                ['08:44', 'Route', 'Assign bug replay analysis to Vision'],
              ].map(([time, type, message]) => (
                <div className="timeline-row" key={time + message}>
                  <small>{time}</small>
                  <div>
                    <strong>{type}</strong>
                    <p>{message}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <aside className="right-stack">
        <Card title="Agent Status">
          <div className="stack-gap">
            <AgentRow
              name="Zeta"
              tone="zeta"
              state="Live"
              currentTask="Orchestrating dashboard priorities"
              output="Last output 2m ago"
              avg="Avg 1.6s"
            />
            <AgentRow
              name="Coding"
              tone="coding"
              state="Executing"
              currentTask="Refactor queue handlers"
              output="Last output 1m ago"
              avg="Avg 1.9s"
            />
            <AgentRow
              name="Reasoning"
              tone="reasoning"
              state="Reviewing"
              currentTask="Budget anomaly analysis"
              output="Last output 4m ago"
              avg="Avg 2.7s"
            />
            <AgentRow
              name="Vision"
              tone="vision"
              state="Ready"
              currentTask="Awaiting media prompt"
              output="Last output 7m ago"
              avg="Avg 1.4s"
            />
          </div>
        </Card>
        <Card title="Approvals Queue" action="Open">
          <div className="stack-gap">
            <ApprovalItem kind="Deploy Request" reason="Prod hotfix requires elevated access." />
            <ApprovalItem kind="Budget Exception" reason="Token usage burst exceeded workspace limit." />
          </div>
        </Card>
        <Card title="Notifications">
          <ul className="list-plain">
            <li>2 failed runs in `payments-core`</li>
            <li>New artifact pack in `marketing-q2`</li>
            <li>3 teammates joined `growth-lab`</li>
          </ul>
        </Card>
        <Card title="Shortcuts">
          <div className="shortcut-grid">
            <button className="btn-ghost">New Command</button>
            <button className="btn-ghost">Create Task</button>
            <button className="btn-ghost">Open Artifacts</button>
            <button className="btn-ghost">Route to Agent</button>
          </div>
        </Card>
      </aside>
    </div>
  )
}

function CommandCenterScreen() {
  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Task Context">
          <div className="text-block">
            <h2>Task #8842 • Optimize onboarding drop-off</h2>
            <p>User request: explain causes of drop in completion rate and propose actions with confidence score.</p>
            <div className="chip-wrap">
              <StatusChip text="Workspace: growth-lab" tone="zeta" />
              <StatusChip text="Priority: High" tone="warning" />
              <StatusChip text="ETA: 19m" tone="success" />
            </div>
          </div>
        </Card>
        <Card title="User Prompt">
          <pre className="code-box">
Analyze event stream from last 14 days, compare cohorts, isolate breakpoints, and produce rollout recommendations with risk notes.
          </pre>
        </Card>
        <Card title="Execution Stream">
          <div className="stack-gap">
            <article className="log-row">
              <StatusChip text="Zeta" tone="zeta" />
              <p>Plan generated with 5 investigative branches and fallback route.</p>
            </article>
            <article className="log-row">
              <StatusChip text="Coding" tone="coding" />
              <p>Pipeline replay done on staging data, latency profile normalized.</p>
            </article>
            <article className="log-row">
              <StatusChip text="Reasoning" tone="reasoning" />
              <p>Primary correlation discovered between delayed email verification and drop-off.</p>
            </article>
            <article className="log-row">
              <StatusChip text="Vision" tone="vision" />
              <p>Generated annotated flow map of abandonment points.</p>
            </article>
          </div>
        </Card>
        <Card title="Final Synthesis">
          <div className="text-block">
            <p>
              Completion drop is mainly tied to verification delay and mobile form friction. Expected uplift after fix:
              8-11% completion.
            </p>
            <div className="mini-actions">
              <button className="btn-primary">Apply Recommendations</button>
              <button className="btn-ghost">Export Artifact</button>
              <button className="btn-ghost">Rerun with Variant</button>
            </div>
          </div>
        </Card>
      </div>
      <aside className="right-stack">
        <Card title="Approvals">
          <ApprovalItem kind="Access Scope" reason="Need temporary write access to staging webhook." />
        </Card>
        <Card title="Files">
          <ul className="list-plain">
            <li>funnel_events.csv</li>
            <li>session_replay_notes.md</li>
            <li>launch_risk_matrix.pdf</li>
          </ul>
        </Card>
        <Card title="Related Tasks">
          <ul className="list-plain">
            <li>#8820 Investigate auth retries</li>
            <li>#8814 Refresh funnel copy</li>
            <li>#8799 Patch referral tracking</li>
          </ul>
        </Card>
      </aside>
    </div>
  )
}

function KanbanScreen() {
  const columns = [
    {
      title: 'Inbox',
      cards: ['Audit error telemetry', 'Document routing rules', 'Q2 partner request'],
    },
    {
      title: 'To Do',
      cards: ['Refactor alert fallback', 'SLA dashboard copy update'],
    },
    {
      title: 'In Progress',
      cards: ['Worker autoscale tuning', 'Mobile onboarding A/B'],
    },
    {
      title: 'Waiting / Review',
      cards: ['Legal review: notification policy', 'Approval: model budget increase'],
    },
    {
      title: 'Blocked',
      cards: ['Deploy queue migration (missing secret)'],
    },
    {
      title: 'Done',
      cards: ['Artifact tagging rollout', 'Workspace permissions cleanup'],
    },
  ]
  return (
    <div className="kanban-page">
      <header className="kanban-head">
        <div>
          <h2>Kanban Board</h2>
          <p>Workspace: OpenClaw Ops • Sprint 14</p>
        </div>
        <div className="mini-actions">
          <button className="btn-ghost">Filter</button>
          <button className="btn-ghost">Group by Agent</button>
          <button className="btn-primary">+ New Task</button>
        </div>
      </header>
      <div className="kanban-board">
        {columns.map((column) => (
          <section key={column.title} className="kanban-column">
            <header className="row-between">
              <h4>{column.title}</h4>
              <small>{column.cards.length}</small>
            </header>
            <div className="stack-gap">
              {column.cards.map((card) => (
                <article key={card} className="kanban-card">
                  <h5>{card}</h5>
                  <p>Owner: Zeta • Updated 9m ago</p>
                  <div className="chip-wrap">
                    <StatusChip text="priority-high" tone="warning" />
                    <StatusChip text="active" tone="zeta" />
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

function ArtifactsScreen() {
  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Artifacts Library" action="Upload">
          <div className="feed-list">
            {[
              'Launch summary v2.pdf',
              'Agent handoff checklist.md',
              'Onboarding heatmap.png',
              'Risk register.qmd',
              'Quarterly throughput.csv',
            ].map((name) => (
              <article key={name} className="feed-row">
                <div>
                  <h4>{name}</h4>
                  <p>Updated today • OpenClaw Ops</p>
                </div>
                <div className="mini-actions">
                  <button className="btn-ghost">Preview</button>
                  <button className="btn-ghost">Share</button>
                </div>
              </article>
            ))}
          </div>
        </Card>
      </div>
      <aside className="right-stack">
        <Card title="Preview">
          <div className="preview-box">
            <p>Artifact Canvas</p>
          </div>
        </Card>
        <Card title="Metadata">
          <ul className="list-plain">
            <li>Owner: Ops Team</li>
            <li>Visibility: Workspace</li>
            <li>Tags: launch, risk, summary</li>
          </ul>
        </Card>
      </aside>
    </div>
  )
}

function WorkspacesScreen() {
  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Workspaces" action="+ New Workspace">
          <div className="feed-list">
            {[
              ['OpenClaw Ops', '14 members', 'Active'],
              ['Payments Core', '9 members', 'Active'],
              ['Marketing Q2', '7 members', 'Idle'],
              ['Sandbox R&D', '4 members', 'Archived soon'],
            ].map(([name, members, state]) => (
              <article key={name} className="feed-row">
                <div>
                  <h4>{name}</h4>
                  <p>{members}</p>
                </div>
                <div className="mini-actions">
                  <StatusChip text={state} tone={state === 'Active' ? 'success' : 'warning'} />
                  <button className="btn-ghost">Open</button>
                  <button className="btn-ghost">Manage</button>
                </div>
              </article>
            ))}
          </div>
        </Card>
      </div>
      <aside className="right-stack">
        <Card title="Workspace Defaults">
          <ul className="list-plain">
            <li>Memory retention: 30 days</li>
            <li>Approvals: Required for deploy ops</li>
            <li>Preferred agent: Zeta</li>
          </ul>
        </Card>
        <Card title="Permissions">
          <ul className="list-plain">
            <li>Coding: write + execute</li>
            <li>Reasoning: analyze + synthesize</li>
            <li>Vision: media + annotation</li>
          </ul>
        </Card>
      </aside>
    </div>
  )
}

function ActivityLogsScreen() {
  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="Activity Logs" action="Export">
          <div className="timeline">
            {[
              ['10:11:04', 'info', 'Task #8842 command accepted by Zeta'],
              ['10:11:28', 'route', 'Task delegated to Coding and Reasoning'],
              ['10:12:09', 'approval_required', 'Deploy scope elevation requested'],
              ['10:13:41', 'blocked', 'Secret key missing on runner-03'],
              ['10:15:10', 'complete', 'Artifact generated and saved'],
            ].map(([time, state, detail]) => (
              <div className="timeline-row" key={time + detail}>
                <small>{time}</small>
                <div>
                  <StatusChip text={state} tone={state.includes('blocked') ? 'error' : 'zeta'} />
                  <p>{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <aside className="right-stack">
        <Card title="Event Inspector">
          <pre className="code-box">
event_id: ev_31fd9
source: runner-03
request: deploy_scope:elevated
status: blocked
reason: SECRET_MISSING
          </pre>
        </Card>
      </aside>
    </div>
  )
}

function SettingsScreen() {
  return (
    <div className="content-grid">
      <div className="main-stack">
        <Card title="General">
          <div className="settings-grid">
            <label>
              Organization Name
              <input defaultValue="OpenClaw Labs" />
            </label>
            <label>
              Default Workspace
              <input defaultValue="OpenClaw Ops" />
            </label>
            <label>
              Region
              <input defaultValue="Singapore" />
            </label>
            <label>
              Time Format
              <input defaultValue="24-hour" />
            </label>
          </div>
        </Card>
        <Card title="Notifications">
          <div className="settings-grid">
            <label>
              Critical alerts
              <input defaultValue="Email + In-app" />
            </label>
            <label>
              Approval reminders
              <input defaultValue="Every 10 minutes" />
            </label>
            <label>
              Digest summary
              <input defaultValue="Daily at 18:00" />
            </label>
            <label>
              Incident channel
              <input defaultValue="#ops-alerts" />
            </label>
          </div>
        </Card>
        <Card title="Model Preferences">
          <div className="settings-grid">
            <label>
              Primary model
              <input defaultValue="gpt5.4-inv" />
            </label>
            <label>
              Fallback model
              <input defaultValue="gpt5.3-fast" />
            </label>
            <label>
              Max auto-runs
              <input defaultValue="4" />
            </label>
            <label>
              Budget guardrail
              <input defaultValue="$120/day" />
            </label>
          </div>
        </Card>
      </div>
      <aside className="right-stack">
        <Card title="Quick Toggles">
          <div className="shortcut-grid">
            <button className="btn-ghost">Enable Auto-Route</button>
            <button className="btn-ghost">Force Approvals</button>
            <button className="btn-ghost">Lock Deployments</button>
            <button className="btn-primary">Save Settings</button>
          </div>
        </Card>
        <Card title="Danger Zone">
          <div className="stack-gap">
            <button className="btn-danger">Reset Workspace Memory</button>
            <button className="btn-danger">Archive Organization</button>
          </div>
        </Card>
      </aside>
    </div>
  )
}

function App() {
  const appName = import.meta.env.VITE_APP_NAME || 'OpenClaw Command Center'
  const sideLabel = sideNav.map((item) => item.label).join(', ')
  return (
    <div className="app-root">
      <div className="app-shell">
        <header className="top-nav">
          <div className="top-left">
            <strong>{appName}</strong>
            <button className="btn-ghost">Workspace: OpenClaw Ops</button>
          </div>
          <div className="top-actions">
            <input className="search-input" defaultValue="Search commands, tasks, artifacts..." />
            <button className="btn-primary">New Command</button>
            <button className="btn-ghost">Alerts 3</button>
            <button className="btn-ghost">Profile</button>
          </div>
        </header>

        <div className="app-body">
          <aside className="side-nav" aria-label={sideLabel}>
            {sideNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}
              >
                <span>{item.label}</span>
                {item.badge && <small className="nav-badge">{item.badge}</small>}
              </NavLink>
            ))}
          </aside>

          <main className="page-main">
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardScreen />} />
              <Route path="/command-center" element={<CommandCenterScreen />} />
              <Route path="/kanban" element={<KanbanScreen />} />
              <Route path="/artifacts" element={<ArtifactsScreen />} />
              <Route path="/workspaces" element={<WorkspacesScreen />} />
              <Route path="/activity-logs" element={<ActivityLogsScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  )
}

export default App


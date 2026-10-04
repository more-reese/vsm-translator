import type { Commit, ProjectSummary } from '../model/types';

export interface SidebarProps {
  projects: ProjectSummary[];
  activeProjectId: string | null;
  history: Commit[];
  historyIndex: number;
  onSelectProject(id: string): void;
  onNewProject(): void;
  onDeleteProject(id: string): void;
  onSelectCommit(index: number): void;
  onRestore(): void;
  onReturnToLatest(): void;
}

function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const DIRECTION_LABEL: Record<string, string> = {
  init: 'created',
  'text->diagram': 'text → diagram',
  'diagram->text': 'diagram → text',
  merge: 'merged both sides',
  restore: 'restored',
  structural: 'layout',
};

export function Sidebar({
  projects,
  activeProjectId,
  history,
  historyIndex,
  onSelectProject,
  onNewProject,
  onDeleteProject,
  onSelectCommit,
  onRestore,
  onReturnToLatest,
}: SidebarProps) {
  const atHead = historyIndex === history.length - 1;

  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <header className="sidebar-header">
          <h2>Projects</h2>
          <button type="button" className="icon-btn" title="New project (⌘N)" onClick={onNewProject}>
            ＋
          </button>
        </header>
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className={`project ${project.id === activeProjectId ? 'is-active' : ''}`}
                onClick={() => onSelectProject(project.id)}
              >
                <span className="project-name">{project.name}</span>
                <span className="project-meta">{when(project.updatedAt)}</span>
              </button>
              <button
                type="button"
                className="icon-btn subtle"
                title="Delete project"
                onClick={() => onDeleteProject(project.id)}
              >
                ×
              </button>
            </li>
          ))}
          {!projects.length && <li className="muted pad">No projects yet.</li>}
        </ul>
      </section>

      <section className="sidebar-section sidebar-history">
        <header className="sidebar-header">
          <h2>History</h2>
          {!atHead && (
            <button type="button" className="icon-btn" title="Return to latest" onClick={onReturnToLatest}>
              ⤓
            </button>
          )}
        </header>

        <ol className="commit-list">
          {[...history].reverse().map((commit, reversedIndex) => {
            const index = history.length - 1 - reversedIndex;
            const isSelected = index === historyIndex;
            const isFuture = index > historyIndex;
            return (
              <li key={commit.id}>
                <button
                  type="button"
                  className={`commit ${isSelected ? 'is-selected' : ''} ${
                    isFuture ? 'is-future' : ''
                  }`}
                  onClick={() => onSelectCommit(index)}
                >
                  <span className="commit-dot" aria-hidden="true" />
                  <span className="commit-body">
                    <span className="commit-summary">{commit.summary}</span>
                    <span className="commit-meta">
                      {when(commit.timestamp)} · {DIRECTION_LABEL[commit.direction] ?? commit.direction}
                    </span>
                  </span>
                </button>

                {isSelected && !!commit.changes.length && (
                  <ul className="commit-changes">
                    {commit.changes.slice(0, 8).map((change, i) => (
                      <li key={`${change.id}-${i}`} className={`change change-${change.kind}`}>
                        <span className="change-kind">{change.kind}</span>
                        <span>{change.label}</span>
                        {change.detail && <em>{change.detail}</em>}
                      </li>
                    ))}
                    {commit.changes.length > 8 && (
                      <li className="muted">+{commit.changes.length - 8} more</li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>

        {!atHead && (
          <div className="history-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={onRestore}>
              Restore this state
            </button>
            <button type="button" className="btn btn-small" onClick={onReturnToLatest}>
              Back to latest
            </button>
          </div>
        )}
      </section>
    </aside>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CSSProperties,
  type DragEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  fetchAgentsOverview,
  fetchScheduler,
  moveSchedulerJob,
  saveSchedulerJob,
} from '../api/client';
import type {
  AdminSchedulerJob,
  AgentCard,
  AgentSessionCard,
} from '../api/types';
import { useAuth } from '../auth';
import { PageHeader } from '../components/ui';
import { formatDateTime, formatRelativeTime } from '../lib/format';

type JobColumnId = 'backlog' | 'in_progress' | 'review' | 'done' | 'cancelled';

interface JobBoardItem {
  key: string;
  job: AdminSchedulerJob;
  session: AgentSessionCard | null;
  agentKey: string;
  agentLabel: string;
  column: JobColumnId;
  tone: 'default' | 'progress' | 'review' | 'success' | 'danger';
  stateLabel: string;
  summary: string;
  searchIndex: string;
}

interface JobHistoryEntry {
  key: string;
  title: string;
  detail: string;
  timestamp: string | null;
}

const JOB_COLUMNS: ReadonlyArray<{
  id: JobColumnId;
  title: string;
}> = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
  { id: 'cancelled', title: 'Cancelled' },
] as const;

function trimText(raw: string | null | undefined, maxLength: number): string {
  const normalized = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3).trimEnd()}...`
    : normalized;
}

function resolveSchedulerSessionId(job: AdminSchedulerJob): string | null {
  if (job.source === 'config') return `scheduler:${job.id}`;
  return job.sessionId || null;
}

function deriveColumn(
  job: AdminSchedulerJob,
  session: AgentSessionCard | null,
): JobColumnId {
  if (job.boardStatus) return job.boardStatus;
  if (session?.status === 'active') return 'in_progress';
  if (
    job.lastStatus === 'success' &&
    (job.schedule.kind === 'at' || !job.nextRunAt)
  ) {
    return 'done';
  }
  if (job.lastStatus === 'success') return 'review';
  return 'backlog';
}

function deriveTone(column: JobColumnId): JobBoardItem['tone'] {
  if (column === 'in_progress') return 'progress';
  if (column === 'review') return 'review';
  if (column === 'done') return 'success';
  if (column === 'cancelled') return 'danger';
  return 'default';
}

function deriveStateLabel(
  job: AdminSchedulerJob,
  session: AgentSessionCard | null,
  column: JobColumnId,
): string {
  if (isJobPaused(job)) return 'paused';
  if (job.boardStatus === 'in_progress' || column === 'in_progress') {
    return 'running';
  }
  if (
    job.boardStatus === 'review' ||
    job.boardStatus === 'done' ||
    column === 'review' ||
    column === 'done' ||
    job.lastStatus === 'success' ||
    session?.status === 'idle'
  ) {
    return 'ready';
  }
  return 'queued';
}

function isJobPaused(job: AdminSchedulerJob): boolean {
  return job.disabled || !job.enabled;
}

function hashString(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function getAgentPillStyle(agentKey: string): CSSProperties {
  if (!agentKey || agentKey === 'unassigned') {
    return {
      backgroundColor: '#eef2f7',
      color: '#64748b',
    };
  }

  const hue = hashString(agentKey) % 360;
  return {
    backgroundColor: `hsla(${hue}, 72%, 92%, 1)`,
    color: `hsl(${hue}, 64%, 36%)`,
  };
}

function JobCard(props: {
  item: JobBoardItem;
  selected: boolean;
  draggable: boolean;
  onSelect: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDragLeave: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
}) {
  const { item } = props;

  return (
    <div
      className={[
        'jobs-card-shell',
        props.selected ? 'active' : '',
        props.draggable ? 'draggable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        className="jobs-card-button"
        type="button"
        draggable={props.draggable}
        onClick={props.onSelect}
        onDragStart={props.onDragStart}
        onDragEnd={props.onDragEnd}
        onDragOver={props.onDragOver}
        onDragLeave={props.onDragLeave}
        onDrop={props.onDrop}
      >
        <article className={`jobs-card tone-${item.tone}`}>
          <div className="jobs-card-top">
            <strong>{trimText(item.job.name, 24)}</strong>
          </div>
          <p>{item.summary}</p>
          <small>{item.stateLabel}</small>
          <span
            className="jobs-card-pill"
            style={getAgentPillStyle(item.agentKey)}
          >
            {item.agentLabel}
          </span>
        </article>
      </button>
    </div>
  );
}

function replaceSchedulerJob(
  jobs: AdminSchedulerJob[] | undefined,
  nextJob: AdminSchedulerJob,
): AdminSchedulerJob[] {
  return (jobs || []).map((job) =>
    job.id === nextJob.id && job.source === 'config' ? nextJob : job,
  );
}

function buildJobHistory(item: JobBoardItem): JobHistoryEntry[] {
  const entries: JobHistoryEntry[] = [];
  const push = (
    title: string,
    detail: string,
    timestamp: string | null,
    suffix: string,
  ) => {
    entries.push({
      key: `${item.job.id}:${suffix}:${entries.length}`,
      title,
      detail,
      timestamp,
    });
  };

  if (item.job.createdAt) {
    push(
      'Created',
      'Job was created and added to the board.',
      item.job.createdAt,
      'created',
    );
  } else if (item.job.source === 'config') {
    push(
      'Registered',
      'Config-backed job is registered in the scheduler.',
      null,
      'registered',
    );
  }

  if (item.agentLabel !== 'Unassigned') {
    push(
      'Assigned',
      `Assigned to ${item.agentLabel}.`,
      item.session?.startedAt || item.job.createdAt || null,
      'assigned',
    );
  }

  if (item.session?.startedAt) {
    push(
      item.session.status === 'active' ? 'Started working' : 'Worked on job',
      `Session ${item.session.sessionId} opened for ${item.agentLabel}.`,
      item.session.startedAt,
      'started',
    );
  } else if (item.job.lastRun) {
    push(
      'Started working',
      'Latest run started from the scheduler.',
      item.job.lastRun,
      'started',
    );
  }

  if (item.job.lastStatus === 'success') {
    push(
      item.column === 'review' ? 'Ready for review' : 'Finished',
      item.column === 'review'
        ? 'Latest run completed successfully and is waiting for review.'
        : 'Latest run completed successfully.',
      item.job.lastRun,
      'finished',
    );
  } else if (item.job.lastStatus === 'error') {
    push(
      'Failed',
      item.job.disabled || !item.job.enabled
        ? 'Latest run failed and the job is currently paused.'
        : 'Latest run failed.',
      item.job.lastRun,
      'failed',
    );
  }

  if (!item.job.enabled || item.job.disabled) {
    push(
      'Paused',
      item.job.lastStatus === 'error'
        ? 'The job is paused after a failed run.'
        : 'The job is currently paused.',
      item.job.lastStatus === 'error' ? item.job.lastRun : null,
      'paused',
    );
  }

  if (!entries.length) {
    push('Registered', 'Job is available on the board.', null, 'fallback');
  }

  if (item.job.boardStatus) {
    push(
      'Status set',
      `Board status is ${item.job.boardStatus.replace('_', ' ')}.`,
      item.job.createdAt,
      'status',
    );
  }

  return entries.sort((left, right) => {
    if (left.timestamp && right.timestamp) {
      return (
        new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
      );
    }
    if (left.timestamp) return -1;
    if (right.timestamp) return 1;
    return 0;
  });
}

function collectJobOutputs(item: JobBoardItem): string[] {
  const values = [
    ...(item.session?.output || []),
    item.session?.lastAnswer || '',
  ];
  const seen = new Set<string>();
  const outputs: string[] = [];
  for (const rawValue of values) {
    const value = String(rawValue || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    outputs.push(value);
  }
  return outputs;
}

function outputKey(prefix: string, value: string): string {
  const normalized = value.trim().slice(0, 48).replace(/\s+/g, '-');
  return `${prefix}:${normalized}`;
}

function JobDetailCard(props: {
  item: JobBoardItem;
  history: JobHistoryEntry[];
  agents: AgentCard[];
  savePending: boolean;
  onUpdate: (nextJob: AdminSchedulerJob & { source: 'config' }) => void;
}) {
  const sessionId = resolveSchedulerSessionId(props.item.job);
  const editHref = `/admin/scheduler?jobId=${encodeURIComponent(props.item.job.id)}`;
  const outputs = useMemo(() => collectJobOutputs(props.item), [props.item]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<null | 'lane' | 'agent'>(
    null,
  );
  const isEditable = props.item.job.source === 'config';

  function saveConfigUpdate(
    patch: Partial<AdminSchedulerJob & { source: 'config' }>,
  ): void {
    const job = props.item.job;
    if (job.source !== 'config') return;
    props.onUpdate({
      ...job,
      source: 'config',
      ...patch,
    });
    setEditingField(null);
  }

  async function copyOutput(key: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((current) => (current === key ? null : current));
      }, 1600);
    } catch {
      setCopiedKey(null);
    }
  }

  return (
    <aside className="jobs-detail">
      <div className="jobs-detail-header">
        <div>
          <span className="eyebrow">Job</span>
          <h4>{props.item.job.name}</h4>
        </div>
        <a className="ghost-button" href={editHref}>
          Edit
        </a>
      </div>

      <div className="jobs-detail-stack">
        <div className="key-value-grid">
          <div>
            <span>Status</span>
            <strong>{props.item.stateLabel}</strong>
          </div>
          <div>
            <span>Lane</span>
            {isEditable && editingField === 'lane' ? (
              <select
                className="jobs-inline-select"
                value={props.item.job.boardStatus || props.item.column}
                onBlur={() => setEditingField(null)}
                onChange={(event) =>
                  saveConfigUpdate({
                    boardStatus: event.target.value as JobColumnId,
                  })
                }
              >
                {JOB_COLUMNS.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.title}
                  </option>
                ))}
              </select>
            ) : (
              <button
                className="jobs-inline-trigger"
                type="button"
                disabled={!isEditable || props.savePending}
                onClick={() => setEditingField('lane')}
              >
                {JOB_COLUMNS.find((column) => column.id === props.item.column)
                  ?.title || props.item.column}
              </button>
            )}
          </div>
          <div>
            <span>Agent</span>
            {isEditable && editingField === 'agent' ? (
              <select
                className="jobs-inline-select"
                value={props.item.job.agentId || ''}
                onBlur={() => setEditingField(null)}
                onChange={(event) =>
                  saveConfigUpdate({
                    agentId: event.target.value || null,
                  })
                }
              >
                <option value="">Unassigned</option>
                {props.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name?.trim()
                      ? `${agent.name} (${agent.id})`
                      : agent.id}
                  </option>
                ))}
              </select>
            ) : (
              <button
                className="jobs-inline-trigger"
                type="button"
                disabled={!isEditable || props.savePending}
                onClick={() => setEditingField('agent')}
              >
                {props.item.agentLabel}
              </button>
            )}
          </div>
          <div>
            <span>Type</span>
            <strong>
              {props.item.job.source === 'task' ? 'task' : 'config'}
            </strong>
          </div>
          <div>
            <span>Session</span>
            <strong>{sessionId || 'n/a'}</strong>
          </div>
          <div>
            <span>Channel</span>
            <strong>
              {props.item.job.channelId || props.item.job.delivery.to || 'n/a'}
            </strong>
          </div>
          {props.item.job.schedule.kind !== 'at' ? (
            <div>
              <span>Next run</span>
              <strong>{formatDateTime(props.item.job.nextRunAt)}</strong>
            </div>
          ) : null}
        </div>

        <div className="summary-block">
          <span>Description</span>
          <p>{props.item.job.description || props.item.summary}</p>
        </div>

        <div className="summary-block">
          <span>Message</span>
          <p>{props.item.job.action.message || 'No action message.'}</p>
        </div>

        <div className="summary-block">
          <div className="summary-block-header">
            <span>Outputs</span>
            {outputs.length ? (
              <button
                className="ghost-button"
                type="button"
                onClick={() => copyOutput('all', outputs.join('\n\n'))}
              >
                {copiedKey === 'all' ? 'Copied' : 'Copy all'}
              </button>
            ) : null}
          </div>
          {outputs.length ? (
            <div className="jobs-output-list">
              {outputs.map((output) => (
                <div
                  className="jobs-output-card"
                  key={outputKey(props.item.key, output)}
                >
                  <div className="jobs-output-actions">
                    <small>Output</small>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() =>
                        copyOutput(outputKey('copy', output), output)
                      }
                    >
                      {copiedKey === outputKey('copy', output)
                        ? 'Copied'
                        : 'Copy'}
                    </button>
                  </div>
                  <pre className="jobs-output-pre">{output}</pre>
                </div>
              ))}
            </div>
          ) : (
            <p>No outputs captured for this job yet.</p>
          )}
        </div>

        <div className="summary-block">
          <span>History</span>
          {props.history.length ? (
            <div className="jobs-history-list">
              {props.history.map((entry) => (
                <div className="jobs-history-row" key={entry.key}>
                  <strong>{entry.title}</strong>
                  <small>
                    {entry.timestamp
                      ? formatRelativeTime(entry.timestamp)
                      : 'Time not tracked'}
                  </small>
                  <p>{entry.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <p>No job history yet.</p>
          )}
        </div>
      </div>
    </aside>
  );
}

export function JobsPage() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dragOverItemKey, setDragOverItemKey] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<JobColumnId | null>(
    null,
  );
  const deferredSearch = useDeferredValue(search);

  const schedulerQuery = useQuery({
    queryKey: ['scheduler', auth.token],
    queryFn: () => fetchScheduler(auth.token),
    refetchInterval: 15_000,
  });

  const agentsQuery = useQuery({
    queryKey: ['agents-overview', auth.token],
    queryFn: () => fetchAgentsOverview(auth.token),
    refetchInterval: 15_000,
  });

  const saveJobMutation = useMutation({
    mutationFn: (job: AdminSchedulerJob & { source: 'config' }) =>
      saveSchedulerJob(auth.token, job),
    onMutate: async (job) => {
      await queryClient.cancelQueries({
        queryKey: ['scheduler', auth.token],
      });
      const previous = queryClient.getQueryData<{ jobs: AdminSchedulerJob[] }>([
        'scheduler',
        auth.token,
      ]);
      queryClient.setQueryData<{ jobs: AdminSchedulerJob[] }>(
        ['scheduler', auth.token],
        previous
          ? {
              ...previous,
              jobs: replaceSchedulerJob(previous.jobs, job),
            }
          : previous,
      );
      return { previous };
    },
    onError: (_error, _job, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['scheduler', auth.token], context.previous);
      }
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(['scheduler', auth.token], payload);
    },
  });

  const moveJobMutation = useMutation({
    mutationFn: (payload: {
      jobId: string;
      beforeJobId?: string | null;
      boardStatus: JobColumnId;
    }) =>
      moveSchedulerJob(auth.token, {
        jobId: payload.jobId,
        beforeJobId: payload.beforeJobId,
        boardStatus: payload.boardStatus,
      }),
    onSuccess: (payload) => {
      queryClient.setQueryData(['scheduler', auth.token], payload);
    },
  });

  const sessionsById = useMemo(() => {
    return new Map(
      (agentsQuery.data?.sessions || []).map((session) => [
        session.sessionId,
        session,
      ]),
    );
  }, [agentsQuery.data?.sessions]);

  const agentsById = useMemo(() => {
    return new Map(
      (agentsQuery.data?.agents || []).map((agent) => [agent.id, agent]),
    );
  }, [agentsQuery.data?.agents]);

  const allItems = useMemo(() => {
    return (schedulerQuery.data?.jobs || []).map((job): JobBoardItem => {
      const session =
        sessionsById.get(resolveSchedulerSessionId(job) || '') || null;
      const agentId = job.agentId || session?.agentId || 'unassigned';
      const agent = agentsById.get(agentId) || null;
      const agentLabel =
        agent?.name ||
        job.agentId ||
        session?.agentId ||
        (agentId === 'unassigned' ? 'Unassigned' : agentId);
      const column = deriveColumn(job, session);
      const summary =
        trimText(job.description, 28) ||
        trimText(job.action.message, 36) ||
        trimText(job.channelId, 24) ||
        'No summary';

      return {
        key: job.id,
        job,
        session,
        agentKey: agentId,
        agentLabel,
        column,
        tone: deriveTone(column),
        stateLabel: deriveStateLabel(job, session, column),
        summary,
        searchIndex: [
          job.id,
          job.name,
          summary,
          job.action.message,
          job.description || '',
          agentLabel,
          job.channelId || '',
          job.delivery.to,
        ]
          .join(' ')
          .toLowerCase(),
      };
    });
  }, [agentsById, schedulerQuery.data?.jobs, sessionsById]);

  const visibleItems = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    if (!needle) return allItems;
    return allItems.filter((item) => item.searchIndex.includes(needle));
  }, [allItems, deferredSearch]);

  const itemsByColumn = useMemo(() => {
    return JOB_COLUMNS.map((column) => ({
      ...column,
      items: visibleItems.filter((item) => item.column === column.id),
    }));
  }, [visibleItems]);

  const selectedItem =
    visibleItems.find((item) => item.key === selectedKey) || null;

  useEffect(() => {
    if (selectedKey === null) return;
    if (!selectedItem) setSelectedKey(null);
  }, [selectedItem, selectedKey]);

  const selectedHistory = useMemo(
    () => (selectedItem ? buildJobHistory(selectedItem) : []),
    [selectedItem],
  );

  const draggedItem = allItems.find((item) => item.key === draggedKey) || null;

  function handleDrop(
    column: JobColumnId,
    beforeJobId: string | null = null,
  ): void {
    if (!draggedItem || draggedItem.job.source !== 'config') return;
    if (beforeJobId === draggedItem.job.id) {
      setDraggedKey(null);
      setDragOverItemKey(null);
      setDragOverColumn(null);
      return;
    }
    moveJobMutation.mutate({
      jobId: draggedItem.job.id,
      beforeJobId,
      boardStatus: column,
    });
    setDraggedKey(null);
    setDragOverItemKey(null);
    setDragOverColumn(null);
  }

  if (schedulerQuery.isLoading && !schedulerQuery.data) {
    return <div className="empty-state">Loading jobs board...</div>;
  }

  if (schedulerQuery.isError && !schedulerQuery.data) {
    return (
      <div className="empty-state error">
        {(schedulerQuery.error as Error).message}
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        title={`Kanban Board (${visibleItems.length} task${visibleItems.length === 1 ? '' : 's'})`}
        actions={
          <div className="header-actions">
            <input
              className="compact-search jobs-header-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search jobs"
            />
            <a className="primary-button" href="/admin/scheduler">
              New Job
            </a>
          </div>
        }
      />

      {agentsQuery.isError ? (
        <p className="error-banner">{(agentsQuery.error as Error).message}</p>
      ) : null}
      {saveJobMutation.isError ? (
        <p className="error-banner">
          {(saveJobMutation.error as Error).message}
        </p>
      ) : null}
      {moveJobMutation.isError ? (
        <p className="error-banner">
          {(moveJobMutation.error as Error).message}
        </p>
      ) : null}

      <section
        className={
          selectedItem ? 'jobs-board-layout has-detail' : 'jobs-board-layout'
        }
      >
        <div className="jobs-columns">
          {itemsByColumn.map((column) => (
            <fieldset
              aria-label={`${column.title} jobs`}
              className={
                dragOverColumn === column.id
                  ? `jobs-column jobs-column-${column.id} drop-target`
                  : `jobs-column jobs-column-${column.id}`
              }
              key={column.id}
              onDragOver={(event) => {
                if (!draggedItem || draggedItem.job.source !== 'config') return;
                event.preventDefault();
                if (dragOverColumn !== column.id) {
                  setDragOverColumn(column.id);
                }
              }}
              onDragLeave={(event) => {
                if (
                  event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  return;
                }
                if (dragOverColumn === column.id) {
                  setDragOverColumn(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleDrop(column.id, null);
              }}
            >
              <div className="jobs-column-header">
                <strong>{column.title}</strong>
                <span>{column.items.length}</span>
              </div>

              <div className="jobs-column-body">
                {column.items.length ? (
                  column.items.map((item) => (
                    <div
                      key={item.key}
                      className={[
                        'jobs-card-frame',
                        dragOverItemKey === item.key ? 'drop-target' : '',
                        item.key === draggedKey ? 'dragging' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <JobCard
                        item={item}
                        selected={item.key === selectedItem?.key}
                        draggable={item.job.source === 'config'}
                        onSelect={() =>
                          setSelectedKey((current) =>
                            current === item.key ? null : item.key,
                          )
                        }
                        onDragStart={(event) => {
                          if (item.job.source !== 'config') return;
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', item.key);
                          setDraggedKey(item.key);
                        }}
                        onDragEnd={() => {
                          setDraggedKey(null);
                          setDragOverItemKey(null);
                          setDragOverColumn(null);
                        }}
                        onDragOver={(event) => {
                          if (
                            !draggedItem ||
                            draggedItem.job.source !== 'config'
                          )
                            return;
                          if (item.job.source !== 'config') return;
                          event.preventDefault();
                          event.stopPropagation();
                          if (dragOverItemKey !== item.key) {
                            setDragOverItemKey(item.key);
                          }
                          if (dragOverColumn !== column.id) {
                            setDragOverColumn(column.id);
                          }
                        }}
                        onDragLeave={(event) => {
                          const nextTarget = event.relatedTarget;
                          if (
                            nextTarget instanceof Node &&
                            event.currentTarget.contains(nextTarget)
                          ) {
                            return;
                          }
                          if (dragOverItemKey === item.key) {
                            setDragOverItemKey(null);
                          }
                        }}
                        onDrop={(event) => {
                          if (item.job.source !== 'config') return;
                          event.preventDefault();
                          event.stopPropagation();
                          handleDrop(column.id, item.job.id);
                        }}
                      />
                    </div>
                  ))
                ) : (
                  <div className="jobs-column-empty">No jobs</div>
                )}
              </div>
            </fieldset>
          ))}
        </div>

        {selectedItem ? (
          <JobDetailCard
            item={selectedItem}
            history={selectedHistory}
            agents={agentsQuery.data?.agents || []}
            savePending={saveJobMutation.isPending}
            onUpdate={(job) => saveJobMutation.mutate(job)}
          />
        ) : null}
      </section>
    </div>
  );
}

'use client';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useApi, formatDuration, formatTimestamp } from '../lib/hooks';

export default function PipelinesPanel() {
  const { data, loading, error, reload } = useApi(
    () => api.getPipelineRuns(30),
    [],
    15000
  );
  const services = useApi(() => api.getServices(), []);
  const dagsterUrl = services.data?.dagster_url || 'http://localhost:3000';

  // "Materialize all": one run of every asset, as the same button in Dagster.
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState(null); // {kind: 'ok' | 'error', text}
  const running = (data?.runs || []).some((r) => r.status === 'running' || r.status === 'queued');
  // Not while Dagster is still loading the project, or failed to: there is
  // nothing to materialize yet (StartupBanner says why).
  const [healthEvery, setHealthEvery] = useState(3000);
  const health = useApi(() => api.getHealth(), [], healthEvery);
  const dagster = health.data?.services?.dagster;
  useEffect(() => {
    if (dagster) setHealthEvery(dagster === 'starting' ? 3000 : 30000);
    if (dagster === 'ok') reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dagster]);
  const notReady =
    dagster === 'starting' ? 'Dagster is still loading the project; this is possible once it is ready' :
    dagster === 'failed' ? 'Dagster did not start, so there is nothing to run' :
    null;

  const runEverything = async () => {
    if (!window.confirm('Start a run of every asset? It loads every source again and rebuilds every table.')) {
      return;
    }
    setStarting(true);
    setNotice(null);
    try {
      const res = await api.materializeAll();
      setNotice({ kind: 'ok', text: res.message });
      reload();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h2 className="page-title">Pipeline runs</h2>
          <p className="page-lede">The last 30 runs in Dagster, refreshed every 15 seconds.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runEverything}
            disabled={starting || running || !!notReady}
            className="btn btn-primary disabled:opacity-50"
            title={notReady || (running ? 'A run is in progress' : 'Start a run of every asset, as Materialize all does in Dagster')}
          >
            {starting ? 'Starting...' : 'Materialize all'}
          </button>
          <a
            href={dagsterUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
          >
            Open Dagster ↗
          </a>
          <button
            onClick={reload}
            className="btn btn-ghost"
          >
            Refresh
          </button>
        </div>
      </div>

      {notice && (
        <div
          className={`card px-4 py-3 text-sm ${
            notice.kind === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="card overflow-hidden">
        {loading && !data ? (
          <LoadingState />
        ) : error && dagster === 'starting' ? (
          <div className="px-4 py-12 text-center text-sm text-ink-2">
            The runs appear here once Dagster has loaded the project.
          </div>
        ) : error ? (
          <ErrorState message={error} dagsterUrl={dagsterUrl} />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-surface-1">
                <th className="table-header">Status</th>
                <th className="table-header">Job</th>
                <th className="table-header">Run ID</th>
                <th className="table-header">Started</th>
                <th className="table-header text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {data?.runs?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-ink-3 text-sm">
                    No pipeline runs yet. Put your source files in place, then click <strong>Materialize all</strong> above, or{' '}
                    <a
                      href={dagsterUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-datavloot-600 hover:underline"
                    >
                      open Dagster
                    </a>
                    {' '}to choose what to run.
                  </td>
                </tr>
              )}
              {data?.runs?.map((run) => (
                <tr key={run.id} className="table-row">
                  <td className="table-cell">
                    <StatusBadge status={run.status} error={run.error} />
                  </td>
                  <td className="table-cell font-medium">{run.job}</td>
                  <td className="table-cell">
                    <a
                      href={`${dagsterUrl}/runs/${run.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-datavloot-600 hover:underline font-mono bg-surface-2 px-1.5 py-0.5 rounded"
                    >
                      {run.id.slice(0, 8)}
                    </a>
                  </td>
                  <td className="table-cell text-ink-2">{formatTimestamp(run.started_at)}</td>
                  <td className="table-cell text-right text-ink-2 font-mono text-xs">
                    {formatDuration(run.duration_seconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// A failed run's label carries the part of its error that says what went
// wrong (routes/pipelines.py error_summary), as a tooltip.
function StatusBadge({ status, error }) {
  return (
    <span
      className={`status-badge status-${status} ${error ? 'cursor-help' : ''}`}
      title={error || undefined}
    >
      {status}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="px-4 py-16 text-center">
      <div className="inline-block w-5 h-5 border-2 border-surface-3 border-t-datavloot-600 rounded-full animate-spin" />
      <p className="mt-3 text-sm text-ink-3">Loading pipeline runs...</p>
    </div>
  );
}

function ErrorState({ message, dagsterUrl }) {
  return (
    <div className="px-4 py-12 text-center">
      <div className="text-red-400 text-2xl mb-2">!</div>
      <p className="text-sm text-ink-2">{message}</p>
      <p className="text-xs text-ink-3 mt-1">
        Make sure Dagster is running:{' '}
        <code className="font-mono bg-surface-2 px-1 rounded">dagster dev</code>
        {' '}or{' '}
        <a href={dagsterUrl} target="_blank" rel="noopener noreferrer" className="text-datavloot-600 hover:underline">
          open Dagster
        </a>
      </p>
    </div>
  );
}

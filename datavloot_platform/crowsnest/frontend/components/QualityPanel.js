'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, formatTimestamp } from '../lib/hooks';

export default function QualityPanel() {
  const [view, setView] = useState('by-model');
  const [drillModel, setDrillModel] = useState(null);
  const [testFilter, setTestFilter] = useState(null);

  const handleTabChange = (tabId) => {
    setView(tabId);
    setDrillModel(null);
    if (tabId !== 'all-tests') setTestFilter(null);
  };

  const handleTestClick = (testName) => {
    setTestFilter(testName);
    setDrillModel(null);
    setView('all-tests');
  };

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="flex items-center gap-3">
          {drillModel && (
            <button
              onClick={() => setDrillModel(null)}
              className="btn btn-ghost -ml-3"
            >
              ← Tables
            </button>
          )}
          <h2 className="page-title">
            {drillModel ? <span className="font-mono">{drillModel}</span> : 'Data quality'}
          </h2>
        </div>
        {!drillModel && (
          <div className="flex bg-surface-2 rounded-md p-0.5 border border-surface-3">
            {[
              { id: 'by-model', label: 'By table' },
              { id: 'all-tests', label: 'All tests' },
              { id: 'anomalies', label: 'Anomalies' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`px-3 h-7 rounded text-xs font-semibold transition-all ${
                  view === tab.id
                    ? 'bg-white text-ink-0 shadow-sm'
                    : 'text-ink-2 hover:text-ink-0'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {drillModel ? (
        <ModelDrillView model={drillModel} onTestClick={handleTestClick} />
      ) : (
        <>
          {view === 'by-model' && <ByModelView onModelClick={setDrillModel} />}
          {view === 'all-tests' && <AllTestsView testFilter={testFilter} onClearFilter={() => setTestFilter(null)} />}
          {view === 'anomalies' && <AnomaliesView />}
        </>
      )}
    </div>
  );
}

function ByModelView({ onModelClick }) {
  const { data, loading, error } = useApi(() => api.getQualityByModel(), [], 30000);

  if (loading) return <Loading />;
  if (error) return <Error message={error} />;

  const models = data?.models || [];
  const backendError = data?.error;

  if (backendError && models.length === 0) return <Error message={backendError} />;

  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-surface-1">
            <th className="table-header">Table</th>
            <th className="table-header text-center">Pass</th>
            <th className="table-header text-center">Fail</th>
            <th className="table-header text-center">Warn</th>
            <th className="table-header">Health</th>
          </tr>
        </thead>
        <tbody>
          {models.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center text-ink-3 text-sm">
                No test results found in the last 7 days. Switch to &quot;All tests&quot; to check all results.
              </td>
            </tr>
          )}
          {models.map((m) => {
            const total = m.pass + m.fail + m.warn + m.error;
            const pct = total > 0 ? Math.round((m.pass / total) * 100) : null;
            return (
              <tr key={m.model} className="table-row">
                <td className="table-cell font-medium font-mono text-xs">
                  <button
                    className="text-datavloot-600 hover:text-datavloot-700 hover:underline text-left"
                    onClick={() => onModelClick(m.model)}
                  >
                    {m.model}
                  </button>
                </td>
                <td className="table-cell text-center">
                  {m.pass > 0 ? <span className="text-emerald-600 font-medium">{m.pass}</span> : <span className="text-ink-3">—</span>}
                </td>
                <td className="table-cell text-center">
                  {m.fail > 0 ? <span className="text-red-600 font-medium">{m.fail}</span> : <span className="text-ink-3">—</span>}
                </td>
                <td className="table-cell text-center">
                  {m.warn > 0 ? <span className="text-amber-600 font-medium">{m.warn}</span> : <span className="text-ink-3">—</span>}
                </td>
                <td className="table-cell">
                  {pct !== null && <HealthBar pct={pct} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ModelDrillView({ model, onTestClick }) {
  const { data, loading, error } = useApi(() => api.getQualityByTest(model), [model]);

  if (loading) return <Loading />;
  if (error) return <Error message={error} />;

  const tests = data?.tests || [];
  const backendError = data?.error;

  if (backendError && tests.length === 0) return <Error message={backendError} />;

  return (
    <div className="card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-surface-1">
            <th className="table-header">Test</th>
            <th className="table-header">Column</th>
            <th className="table-header text-center">Pass</th>
            <th className="table-header text-center">Fail</th>
            <th className="table-header text-center">Warn</th>
            <th className="table-header">Health</th>
            <th className="table-header">Last run</th>
          </tr>
        </thead>
        <tbody>
          {tests.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-12 text-center text-ink-3 text-sm">
                No test results found for this table.
              </td>
            </tr>
          )}
          {tests.map((t) => {
            const total = (t.pass || 0) + (t.fail || 0) + (t.warn || 0) + (t.error || 0);
            const pct = total > 0 ? Math.round(((t.pass || 0) / total) * 100) : null;
            return (
              <tr key={t.test_name} className="table-row">
                <td className="table-cell font-mono text-xs font-medium">
                  <button
                    className="text-datavloot-600 hover:text-datavloot-700 hover:underline text-left"
                    onClick={() => onTestClick(t.test_name)}
                  >
                    {t.test_name}
                  </button>
                </td>
                <td className="table-cell text-xs text-ink-2">{t.column_name || '—'}</td>
                <td className="table-cell text-center">
                  {(t.pass || 0) > 0 ? <span className="text-emerald-600 font-medium">{t.pass}</span> : <span className="text-ink-3">—</span>}
                </td>
                <td className="table-cell text-center">
                  {(t.fail || 0) > 0 ? <span className="text-red-600 font-medium">{t.fail}</span> : <span className="text-ink-3">—</span>}
                </td>
                <td className="table-cell text-center">
                  {(t.warn || 0) > 0 ? <span className="text-amber-600 font-medium">{t.warn}</span> : <span className="text-ink-3">—</span>}
                </td>
                <td className="table-cell">
                  {pct !== null && <HealthBar pct={pct} />}
                </td>
                <td className="table-cell text-xs text-ink-3">{formatTimestamp(t.last_run)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AllTestsView({ testFilter, onClearFilter }) {
  const { data, loading, error } = useApi(() => api.getTestResults(500), [], 30000);

  if (loading) return <Loading />;
  if (error) return <Error message={error} />;

  const allTests = data?.test_results || [];
  const backendError = data?.error;

  const tests = testFilter
    ? allTests.filter((t) => t.test_name === testFilter)
    : allTests;

  if (backendError && allTests.length === 0) return <Error message={backendError} />;

  return (
    <div className="space-y-2">
      {testFilter && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3">Filtered to:</span>
          <span className="text-xs bg-datavloot-50 text-datavloot-700 border border-datavloot-200 px-2 py-0.5 rounded-full font-mono">
            {testFilter}
          </span>
          <button onClick={onClearFilter} className="text-xs text-ink-3 hover:text-ink-1 transition-colors">
            ✕ Clear
          </button>
        </div>
      )}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-1">
              <th className="table-header">Status</th>
              <th className="table-header">Test</th>
              <th className="table-header">Table</th>
              <th className="table-header">Column</th>
              <th className="table-header">Time</th>
            </tr>
          </thead>
          <tbody>
            {tests.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-ink-3 text-sm">
                  No test results found{testFilter ? ` for &quot;${testFilter}&quot;` : ''}.
                </td>
              </tr>
            )}
            {tests.map((t, i) => (
              <tr key={`${t.test_unique_id}-${i}`} className="table-row">
                <td className="table-cell">
                  <span className={`status-badge status-${t.status?.toLowerCase()}`}>{t.status}</span>
                </td>
                <td className="table-cell text-xs font-mono">{t.test_name}</td>
                <td className="table-cell text-xs font-mono">{t.table_name}</td>
                <td className="table-cell text-xs text-ink-2">{t.column_name || '—'}</td>
                <td className="table-cell text-xs text-ink-3">{formatTimestamp(t.test_timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnomaliesView() {
  const { data, loading, error } = useApi(() => api.getAnomalies(), [], 30000);

  if (loading) return <Loading />;
  if (error) return <Error message={error} />;

  const anomalies = data?.anomalies || [];

  return (
    <div className="card overflow-hidden">
      {anomalies.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <div className="text-emerald-400 text-2xl mb-2">&#10003;</div>
          <p className="text-sm text-ink-2">No anomalies detected</p>
          <p className="text-xs text-ink-3 mt-1">Elementary anomaly detection tests are all passing.</p>
        </div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="bg-surface-1">
              <th className="table-header">Status</th>
              <th className="table-header">Test</th>
              <th className="table-header">Table</th>
              <th className="table-header">Column</th>
              <th className="table-header">Detected</th>
            </tr>
          </thead>
          <tbody>
            {anomalies.map((a, i) => (
              <tr key={`${a.test_unique_id}-${i}`} className="table-row">
                <td className="table-cell">
                  <span className={`status-badge status-${a.status?.toLowerCase()}`}>{a.status}</span>
                </td>
                <td className="table-cell text-xs font-mono">{a.test_name}</td>
                <td className="table-cell text-xs font-mono">{a.table_name}</td>
                <td className="table-cell text-xs text-ink-2">{a.column_name || '—'}</td>
                <td className="table-cell text-xs text-ink-3">{formatTimestamp(a.test_timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function HealthBar({ pct }) {
  const color = pct >= 95 ? 'bg-emerald-400' : pct >= 80 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden max-w-[80px]">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-ink-3 font-mono w-8 text-right">{pct}%</span>
    </div>
  );
}

function Loading() {
  return (
    <div className="card px-4 py-16 text-center">
      <div className="inline-block w-5 h-5 border-2 border-surface-3 border-t-datavloot-600 rounded-full animate-spin" />
      <p className="mt-3 text-sm text-ink-3">Loading quality data...</p>
    </div>
  );
}

function Error({ message }) {
  return (
    <div className="card px-4 py-12 text-center">
      <p className="text-sm text-ink-2">{message}</p>
    </div>
  );
}

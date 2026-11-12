'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, formatTimestamp } from '../lib/hooks';

// How dbt made the table, said in a word next to its name; a model needs none.
const KIND_LABEL = { seed: 'seed', source: 'source' };

export default function CatalogPanel() {
  const [search, setSearch] = useState('');
  const [selectedModel, setSelectedModel] = useState(null);
  const [showMetadata, setShowMetadata] = useState(false);

  const { data, loading, error } = useApi(
    () => api.getCatalogModels(search || undefined),
    [search],
  );

  const all = data?.models || [];
  const business = all.filter((m) => !m.metadata);
  const metadata = all.filter((m) => m.metadata);
  // While searching, show what matches, in either group.
  const metadataOpen = showMetadata || (search && metadata.length > 0);

  const select = (m) => setSelectedModel(m);
  const isSelected = (m) => selectedModel?.name === m.name && selectedModel?.schema === m.schema;

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div>
          <h2 className="page-title">Data catalog</h2>
          <p className="page-lede">Every table in the lakehouse, with its columns, tests and a sample of its rows.</p>
        </div>
      </div>

      <div className="relative">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          type="text"
          placeholder="Search tables..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setSelectedModel(null); }}
          className="w-full pl-10 pr-4 h-10 bg-white border border-surface-3 rounded-md text-sm placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-highlight/30 focus:border-highlight transition-all"
        />
      </div>

      <div className="flex gap-4">
        <div className="w-72 shrink-0">
          <div className="card overflow-hidden">
            {loading ? (
              <div className="px-4 py-12 text-center">
                <div className="inline-block w-5 h-5 border-2 border-surface-3 border-t-datavloot-600 rounded-full animate-spin" />
              </div>
            ) : error ? (
              <div className="px-4 py-8 text-center text-sm text-ink-2">{error}</div>
            ) : (
              <div className="max-h-[600px] overflow-y-auto">
                {all.length === 0 && (
                  <div className="px-4 py-12 text-center text-sm text-ink-3">
                    {search ? `No tables matching "${search}"` : 'No tables found in the catalog'}
                  </div>
                )}
                <TableGroups tables={business} onSelect={select} isSelected={isSelected} />

                {metadata.length > 0 && (
                  <div>
                    <button
                      onClick={() => setShowMetadata(!metadataOpen)}
                      aria-expanded={!!metadataOpen}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-left border-b border-surface-2 bg-surface-1 hover:bg-surface-2 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                        className={`text-ink-3 transition-transform ${metadataOpen ? 'rotate-90' : ''}`}>
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                      <span className="text-xs font-semibold text-ink-2">Metadata</span>
                      <span className="text-xs text-ink-3">{metadata.length} tables</span>
                    </button>
                    {metadataOpen && (
                      <>
                        <p className="px-4 py-2 text-xs text-ink-3 border-b border-surface-2">
                          Tables of dbt packages such as Elementary: run results, test results and the like.
                        </p>
                        <TableGroups tables={metadata} onSelect={select} isSelected={isSelected} />
                      </>
                    )}
                  </div>
                )}
                {data?.source === 'information_schema' && (
                  <div className="px-4 py-2 bg-amber-50 text-xs text-amber-700">
                    Showing tables from information_schema — Elementary catalog not available
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          {selectedModel ? (
            <ModelDetail model={selectedModel} />
          ) : (
            <div className="card px-4 py-16 text-center">
              <p className="text-sm text-ink-3">Select a table to see details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TableGroups({ tables, onSelect, isSelected }) {
  const bySchema = {};
  tables.forEach((m) => {
    const s = m.schema || 'main';
    if (!bySchema[s]) bySchema[s] = [];
    bySchema[s].push(m);
  });
  return Object.entries(bySchema).map(([schema, list]) => (
    <div key={schema}>
      <div className="px-4 py-1.5 text-[10px] font-semibold text-ink-3 uppercase tracking-wider bg-surface-1 border-b border-surface-2 sticky top-0">
        {schema}
      </div>
      {list.map((m) => (
        <button
          key={m.unique_id || m.name}
          onClick={() => onSelect(m)}
          className={`w-full flex items-center gap-2 text-left px-4 py-2.5 border-b border-surface-2 hover:bg-surface-1 transition-colors ${
            isSelected(m) ? 'bg-datavloot-50' : ''
          }`}
        >
          <span className="flex-1 truncate text-sm font-medium font-mono text-ink-0">{m.name}</span>
          {KIND_LABEL[m.kind] && (
            <span className="text-[10px] font-medium text-ink-3 ring-1 ring-inset ring-surface-3 rounded px-1.5 py-px">
              {KIND_LABEL[m.kind]}
            </span>
          )}
        </button>
      ))}
    </div>
  ));
}

function ModelDetail({ model: selected }) {
  const [sampleData, setSampleData] = useState(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [sampleError, setSampleError] = useState(null);

  const { data, loading, error } = useApi(
    () => api.getModelDetail(selected.name),
    [selected.name],
  );

  const loadSample = async () => {
    setSampleLoading(true);
    setSampleError(null);
    setSampleData(null);
    try {
      const sql = `SELECT * FROM ${selected.schema}.${selected.name} LIMIT 20`;
      const res = await api.executeQuery(sql, 20);
      setSampleData(res);
    } catch (err) {
      setSampleError(err.message);
    } finally {
      setSampleLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card px-4 py-12 text-center">
        <div className="inline-block w-5 h-5 border-2 border-surface-3 border-t-datavloot-600 rounded-full animate-spin" />
      </div>
    );
  }

  // When Elementary is unavailable the detail endpoint 404s; fall back to the selected table
  const model = data?.model || selected;
  const columns = data?.columns || [];
  const tests = data?.recent_tests || [];

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold font-mono text-ink-0">{model.name}</h3>
            {model.description && <p className="text-sm text-ink-2 mt-1">{model.description}</p>}
          </div>
          <button
            onClick={loadSample}
            disabled={sampleLoading}
            className="btn btn-primary shrink-0"
          >
            {sampleLoading ? 'Loading…' : 'Sample data'}
          </button>
        </div>
        <div className="flex gap-4 mt-3 flex-wrap">
          {(model.kind || selected.kind) && <Detail label="Kind" value={model.kind || selected.kind} />}
          {model.schema && <Detail label="Schema" value={model.schema} />}
          {model.database && <Detail label="Database" value={model.database} />}
          {model.last_run && <Detail label="Last run" value={formatTimestamp(model.last_run)} />}
        </div>
      </div>

      {sampleError && (
        <div className="card border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{sampleError}</p>
        </div>
      )}

      {sampleData && (
        <div className="card overflow-hidden">
          <div className="panel-header">
            <span className="panel-title">Sample data <span className="font-normal text-ink-3">({sampleData.row_count} rows)</span></span>
          </div>
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-1">
                  {sampleData.columns.map((col) => (
                    <th key={col} className="table-header whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sampleData.rows.map((row, ri) => (
                  <tr key={ri} className="table-row">
                    {row.map((val, ci) => (
                      <td key={ci} className="table-cell text-xs font-mono whitespace-nowrap">
                        {val === null ? <span className="text-ink-3 italic">null</span> : String(val)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {columns.length > 0 && (
        <div className="card overflow-hidden">
          <div className="panel-header">
            <span className="panel-title">Columns ({columns.length})</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-surface-1">
                <th className="table-header">Name</th>
                <th className="table-header">Type</th>
                <th className="table-header">Description</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col) => (
                <tr key={col.column_name} className="table-row">
                  <td className="table-cell font-mono text-xs font-medium">{col.column_name}</td>
                  <td className="table-cell">
                    <span className="text-xs text-ink-3 bg-surface-2 px-1.5 py-0.5 rounded font-mono">{col.data_type || '—'}</span>
                  </td>
                  <td className="table-cell text-xs text-ink-2">{col.description || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tests.length > 0 && (
        <div className="card overflow-hidden">
          <div className="panel-header">
            <span className="panel-title">Tests ({tests.length})</span>
          </div>
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
              {tests.map((t) => {
                const total = (t.pass || 0) + (t.fail || 0) + (t.warn || 0) + (t.error || 0);
                const pct = total > 0 ? Math.round(((t.pass || 0) / total) * 100) : null;
                const color = pct === null ? '' : pct >= 95 ? 'bg-emerald-400' : pct >= 80 ? 'bg-amber-400' : 'bg-red-400';
                return (
                  <tr key={t.test_name} className="table-row">
                    <td className="table-cell font-mono text-xs font-medium">{t.test_name}</td>
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
                      {pct !== null && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden max-w-[60px]">
                            <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-ink-3 font-mono w-8 text-right">{pct}%</span>
                        </div>
                      )}
                    </td>
                    <td className="table-cell text-xs text-ink-3">{formatTimestamp(t.last_run)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <span className="text-[10px] text-ink-3 uppercase tracking-wider">{label}</span>
      <p className="text-xs text-ink-1 font-mono mt-0.5">{value}</p>
    </div>
  );
}

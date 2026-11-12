'use client';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { indexSchema, sqlCompletions } from '../lib/sqlCompletion';

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const DEFAULT_SQL = `-- Write your SQL here
-- Pick a table on the left, or query the lakehouse directly
SELECT 1 as hello;`;

export default function QueryPanel() {
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const tables = useApi(() => api.getTables(), []);
  const mode = useApi(() => api.getQueryMode(), []);
  const canWrite = !!mode.data?.write;

  // Ref so the Monaco keybinding always sees the latest sql value
  const sqlRef = useRef(sql);
  sqlRef.current = sql;
  const reloadTables = useRef(tables.reload);
  reloadTables.current = tables.reload;

  // Autocomplete reads the schema through a ref: the provider is registered
  // once, on mount, and has to see the schema as reloaded after a write.
  const schema = useApi(() => api.getSchema(), []);
  const schemaIndex = useMemo(() => indexSchema(schema.data), [schema.data]);
  const schemaIndexRef = useRef(schemaIndex);
  schemaIndexRef.current = schemaIndex;
  const reloadSchema = useRef(schema.reload);
  reloadSchema.current = schema.reload;

  // Monaco keeps completion providers per language for the whole page, so the
  // one registered on mount is removed on unmount, or each visit adds another.
  const completionProvider = useRef(null);
  useEffect(() => () => completionProvider.current?.dispose(), []);

  // `fromEditor` is the text in Monaco right now. The keybinding passes it:
  // sqlRef only catches up on the next render, so Ctrl+Enter straight after
  // typing ran the statement as it was a few keystrokes earlier -- with write
  // access, a DELETE with half its WHERE.
  const executeQuery = useCallback(async (fromEditor) => {
    const currentSql = typeof fromEditor === 'string' ? fromEditor : sqlRef.current;
    if (!currentSql.trim()) return;
    setLoading(true);
    setError(null);
    try {
      let res = await api.executeQuery(currentSql);
      // A DROP, TRUNCATE, or DELETE/UPDATE without WHERE: the server ran nothing
      // and asks first.
      if (res.confirmation_required) {
        if (!window.confirm(`${res.confirmation_required}\n\nRun it?`)) {
          // Clear the last result, so an earlier "Done" cannot read as this one.
          setResult(null);
          return;
        }
        res = await api.executeQuery(currentSql, 1000, true);
      }
      setResult(res);
      if (res.write) {
        // A CREATE, DROP or ALTER changes what there is to show and suggest.
        reloadTables.current();
        reloadSchema.current();
      }
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleEditorMount = (editor, monaco) => {
    editor.addAction({
      id: 'execute-query',
      label: 'Execute Query',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: (ed) => executeQuery(ed.getValue()),
    });

    completionProvider.current?.dispose();
    completionProvider.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) =>
        sqlCompletions(monaco, schemaIndexRef.current, model, position),
    });
  };

  // The business tables in view; DuckLake's, Elementary's and dlt's folded away.
  const allTables = tables.data?.tables || [];
  const businessTables = allTables.filter((t) => !t.metadata);
  const metadataTables = allTables.filter((t) => t.metadata);
  const pickTable = (t) => setSql(`SELECT *\nFROM ${t.full_name}\nLIMIT 100;`);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="page-title">SQL editor</h2>
          {mode.data && (
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                canWrite
                  ? 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200'
                  : 'text-ink-2 ring-1 ring-inset ring-surface-3'
              }`}
              title={
                canWrite
                  ? 'Statements that change the lakehouse run here. Set CROWSNEST_SQL_WRITE=0 to make the editor read-only.'
                  : 'Only reading statements run here. Set CROWSNEST_SQL_WRITE=1 to let the editor change the lakehouse.'
              }
            >
              {canWrite ? 'read-write' : 'read-only'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-ink-3">Ctrl+Enter to run</span>
          <button
            onClick={executeQuery}
            disabled={loading}
            className="btn btn-primary h-9 px-4 text-sm"
          >
            {loading ? 'Running...' : 'Run query'}
          </button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Table sidebar */}
        <div className="w-60 shrink-0">
          <div className="card p-3">
            <h3 className="text-[11px] font-semibold text-ink-3 uppercase tracking-wider mb-2 px-2">Tables</h3>
            <div className="space-y-0.5 max-h-[520px] overflow-y-auto">
              {tables.loading ? (
                <p className="text-xs text-ink-3 px-2">Loading...</p>
              ) : allTables.length === 0 ? (
                <p className="text-xs text-ink-3 px-2">No tables found</p>
              ) : (
                <>
                  <TableTree tables={businessTables} onPick={pickTable} />
                  {metadataTables.length > 0 && (
                    <MetadataGroup tables={metadataTables} onPick={pickTable} />
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Editor + results */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 min-h-0">
          <div className="card overflow-hidden shrink-0">
            <Editor
              height="220px"
              defaultLanguage="sql"
              value={sql}
              onChange={(val) => setSql(val || '')}
              onMount={handleEditorMount}
              theme="vs-light"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                fontFamily: '"JetBrains Mono", monospace',
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                padding: { top: 12, bottom: 12 },
                renderLineHighlight: 'none',
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                scrollbar: { verticalScrollbarSize: 6 },
              }}
            />
          </div>

          {error && (
            <div className="card border-red-200 bg-red-50 px-4 py-3 shrink-0">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {result?.write && (
            <div className="card border-amber-200 bg-amber-50 px-4 py-3 shrink-0 space-y-1">
              <p className="text-sm text-amber-900">
                Done
                {result.rows_affected !== null &&
                  ` · ${result.rows_affected} row${result.rows_affected !== 1 ? 's' : ''} affected`}
                {result.snapshot !== null && ` · snapshot ${result.snapshot}`}
                <span className="ml-2 text-xs text-amber-700 font-mono">{result.duration_ms}ms</span>
              </p>
              {result.snapshot_before !== null ? (
                <p className="text-xs text-amber-800">
                  To undo, read the lakehouse as it was before this change, for example{' '}
                  <code className="font-mono">
                    SELECT * FROM &lt;table&gt; AT (VERSION =&gt; {result.snapshot_before})
                  </code>
                  . Lake maintenance keeps snapshots for about a week.
                </p>
              ) : (
                <p className="text-xs text-amber-800">
                  This database keeps no snapshots, so this change cannot be undone from here.
                </p>
              )}
            </div>
          )}

          {result && !result.write && (
            <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
              <div className="panel-header shrink-0">
                <span className="panel-title">
                  Results
                  <span className="ml-2 text-ink-3 font-normal">
                    {result.row_count} row{result.row_count !== 1 ? 's' : ''}
                    {result.truncated && ' (truncated)'}
                  </span>
                </span>
                <span className="text-xs text-ink-3 font-mono">{result.duration_ms}ms</span>
              </div>
              <div className="overflow-auto flex-1 min-h-0">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-surface-1">
                      {result.columns.map((col) => (
                        <th key={col} className="table-header whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, ri) => (
                      <tr key={ri} className="table-row">
                        {row.map((val, ci) => (
                          <td key={ci} className="table-cell text-xs font-mono whitespace-nowrap">
                            {val === null ? (
                              <span className="text-ink-3 italic">null</span>
                            ) : (
                              String(val)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TableTree({ tables, onPick }) {
  const bySchema = {};
  tables.forEach((t) => {
    const s = t.schema || 'main';
    if (!bySchema[s]) bySchema[s] = [];
    bySchema[s].push(t);
  });
  return Object.entries(bySchema).map(([schema, schemaTables]) => (
    <div key={schema}>
      <div className="px-2 pt-2 pb-0.5 text-[10px] font-semibold text-ink-3 uppercase tracking-wider">
        {schema}
      </div>
      {schemaTables.map((t) => (
        <button
          key={t.full_name}
          onClick={() => onPick(t)}
          className="block w-full text-left px-2 py-1.5 text-xs font-mono text-ink-1 hover:bg-surface-2 rounded transition-colors truncate"
          title={t.full_name}
        >
          {t.type === 'view' && <span className="text-ink-3 mr-1">v</span>}
          {t.name}
        </button>
      ))}
    </div>
  ));
}

// DuckLake's catalog, Elementary's results, dlt's bookkeeping: there to query, out of the way.
function MetadataGroup({ tables, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pt-2 mt-2 border-t border-surface-2">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-surface-2 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          className={`text-ink-3 transition-transform ${open ? 'rotate-90' : ''}`}>
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="text-xs font-semibold text-ink-2">Metadata</span>
        <span className="text-xs text-ink-3">{tables.length}</span>
      </button>
      {open && <TableTree tables={tables} onPick={onPick} />}
    </div>
  );
}

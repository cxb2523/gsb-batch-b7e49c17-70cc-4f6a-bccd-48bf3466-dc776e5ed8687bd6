'use client';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';

// The project's dashboards: Marimo notebooks in apps/, served with `marimo run`
// (output only, no code). The first app opens on arrival; with more than one,
// a row of buttons switches between them.
export default function AppsPanel() {
  const apps = useApi(() => api.getApps(), []);
  const [selected, setSelected] = useState(null);
  const [url, setUrl] = useState(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(null);

  const list = apps.data?.apps || [];

  const open = async (name) => {
    setSelected(name);
    setOpening(true);
    setError(null);
    try {
      const result = await api.openApp(name);
      setUrl(result.url);
    } catch (err) {
      setUrl(null);
      setError(err.message);
    } finally {
      setOpening(false);
    }
  };

  useEffect(() => {
    if (!selected && list.length > 0) open(list[0].name);
  }, [list.length]);

  const current = list.find((app) => app.name === selected);

  return (
    <div className="space-y-4 flex flex-col flex-1 min-h-0">
      <div className="page-head">
        <h2 className="page-title">
          {current?.title || 'Dashboards'}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {list.length > 1 &&
            list.map((app) => (
              <button
                key={app.name}
                onClick={() => open(app.name)}
                className={`btn ${
                  app.name === selected
                    ? 'btn-primary'
                    : ''
                }`}
              >
                {app.title}
              </button>
            ))}
          {url && !opening && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn"
            >
              Open in new tab ↗
            </a>
          )}
        </div>
      </div>

      {apps.loading ? (
        <div className="text-xs text-ink-3">Looking for apps…</div>
      ) : list.length === 0 ? (
        <NoApps available={apps.data?.available} />
      ) : error ? (
        <div className="card border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      ) : opening || !url ? (
        <div className="card px-6 py-12 text-center space-y-3">
          <div className="inline-block w-6 h-6 border-2 border-surface-3 border-t-datavloot-600 rounded-full animate-spin" />
          <p className="text-sm font-medium text-ink-1">Opening {current?.title || selected}…</p>
          <p className="text-xs text-ink-3">The first app can take a few seconds to start.</p>
        </div>
      ) : (
        <div className="card overflow-hidden flex-1 min-h-0">
          <iframe
            key={url}
            src={url}
            className="w-full h-full border-0"
            style={{ minHeight: 'calc(100vh - 180px)' }}
            title={current?.title || selected}
          />
        </div>
      )}
    </div>
  );
}

function NoApps({ available }) {
  return (
    <div className="card px-6 py-6 space-y-3">
      <p className="text-sm font-medium text-ink-1">
        {available === false ? 'No apps/ folder in this project' : 'No apps yet'}
      </p>
      <p className="text-xs text-ink-3">
        An app is a Marimo notebook in the project's{' '}
        <code className="font-mono bg-surface-2 px-1 rounded">apps/</code> folder. It opens here with{' '}
        <code className="font-mono bg-surface-2 px-1 rounded">marimo run</code>: its output, without its code,
        for the people who read the results. Build it in{' '}
        <code className="font-mono bg-surface-2 px-1 rounded">notebooks/</code>, then move it to{' '}
        <code className="font-mono bg-surface-2 px-1 rounded">apps/</code>.
      </p>
    </div>
  );
}

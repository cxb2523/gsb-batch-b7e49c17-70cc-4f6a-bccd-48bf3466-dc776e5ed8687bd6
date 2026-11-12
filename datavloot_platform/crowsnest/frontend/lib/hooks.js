'use client';
import { useState, useEffect, useCallback } from 'react';

export function useApi(fetchFn, deps = [], refreshInterval = null) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await fetchFn();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    load();

    if (refreshInterval) {
      const interval = setInterval(load, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [load, refreshInterval]);

  return { data, loading, error, reload: load };
}

export function formatDuration(seconds) {
  if (!seconds) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function formatTimestamp(ts) {
  if (!ts) return '—';
  const date = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  const now = new Date();
  const diff = (now - date) / 1000;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

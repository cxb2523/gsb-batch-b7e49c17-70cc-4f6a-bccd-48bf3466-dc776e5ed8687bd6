'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';

// Above every panel while `datavloot start` waits for Dagster to load the
// project, which takes from half a minute to several minutes: a first-time
// user should see at once that it is loading, roughly how long it takes, and
// that it is still going (#139). Nothing once Dagster is ready, and nothing
// for `datavloot launch`, which does not start Dagster.
export default function StartupBanner() {
  const [every, setEvery] = useState(3000);
  const health = useApi(() => api.getHealth(), [], every);
  const status = health.data?.services?.dagster;
  const start = health.data?.dagster_start;
  useEffect(() => {
    // Every 3 seconds until the outcome is known, so the steps move along.
    if (status) setEvery(status === 'starting' ? 3000 : 30000);
  }, [status]);

  // The clock ticks every second between polls, from the server's count, so
  // it neither jumps nor depends on this machine's clock agreeing with it.
  const [received, setReceived] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    setReceived(Date.now());
    setNow(Date.now());
  }, [start?.elapsed]);
  useEffect(() => {
    if (status !== 'starting') return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [status]);

  if (status === 'failed') return <Failed error={health.data?.dagster_error} />;
  if (status !== 'starting' || !start) return null;

  const elapsed = start.elapsed + Math.max(0, now - received) / 1000;
  const expected = start.expected;
  const fraction = expected ? elapsed / expected : null;
  const late = fraction !== null && fraction >= 1;
  let estimate;
  if (!expected) {
    estimate = 'This usually takes 1–3 minutes, and longer the first time.';
  } else if (late) {
    estimate = `Taking longer than last time (${clock(expected)}); it is still going.`;
  } else {
    estimate = `The last start took ${clock(expected)}, so about ${aboutLeft(expected - elapsed)} left.`;
  }

  return (
    <div role="status" className="bg-datavloot-50 border-b border-datavloot-200 px-8 py-3 shrink-0">
      <div className="flex items-baseline gap-x-4 gap-y-1 flex-wrap">
        <span className="text-sm font-semibold text-ink-0">Dagster is loading the project.</span>
        <span className="text-sm text-ink-2">{estimate}</span>
        <span className="text-sm text-ink-2 ml-auto tabular-nums">
          Running for <span className="font-mono">{clock(elapsed)}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white mt-2 overflow-hidden" aria-hidden="true">
        {fraction !== null && !late ? (
          <div
            className="h-full rounded-full bg-datavloot-600 transition-[width] duration-1000 ease-linear"
            style={{ width: `${Math.max(2, Math.min(97, fraction * 100))}%` }}
          />
        ) : (
          <div className="h-full w-full progress-stripe" />
        )}
      </div>
      <Steps stage={start.stage} />
    </div>
  );
}

const STEPS = [
  { id: 'server', label: 'Starting Dagster' },
  { id: 'project', label: 'Loading the project' },
  { id: 'ready', label: 'Ready' },
];

function Steps({ stage }) {
  const at = Math.max(0, STEPS.findIndex((step) => step.id === stage));
  return (
    <ol className="flex items-center gap-2 mt-2 text-xs">
      {STEPS.map((step, i) => (
        <li key={step.id} className="flex items-center gap-2">
          {i > 0 && <span className="text-ink-3" aria-hidden="true">→</span>}
          <span
            className={
              i < at ? 'text-ink-2' :
              i === at ? 'font-semibold text-datavloot-700' :
              'text-ink-3'
            }
            aria-current={i === at ? 'step' : undefined}
          >
            {i < at && '✓ '}
            {i === at && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current pulse-dot mr-1.5 align-middle" />}
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

// Loading failed: the reason, which is often a long Python traceback, folded
// away under its first line.
function Failed({ error }) {
  const [first, ...rest] = (error || 'See the log of datavloot start.').split('\n').filter((line) => line.trim());
  return (
    <div role="alert" className="bg-red-50 border-b border-red-200 px-8 py-3 shrink-0">
      <div className="text-sm text-red-800">
        <span className="font-semibold">Dagster did not start.</span>{' '}
        {first} Fix the cause, then start Datavloot again.
      </div>
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="text-xs font-semibold text-red-700 cursor-pointer">The full message</summary>
          <pre className="mt-2 max-h-64 overflow-auto text-xs font-mono text-red-900 whitespace-pre-wrap">{rest.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

// 0:45, 1:05, 12:30
function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function aboutLeft(seconds) {
  if (seconds < 15) return 'a few seconds';
  if (seconds < 45) return 'half a minute';
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

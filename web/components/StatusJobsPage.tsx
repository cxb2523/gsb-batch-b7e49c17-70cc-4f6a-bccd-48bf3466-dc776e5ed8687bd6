"use client";

import { useMemo } from "react";
import { useStatuses } from "@/components/StatusProvider";
import { useJobsByIds } from "@/lib/useJobsByIds";
import JobList from "@/components/JobList";

// The Applied and Ignored pages: every job the user marked with `status`.
export default function StatusJobsPage({
  status,
  title,
  empty,
}: {
  status: "applied" | "ignored";
  title: string;
  empty: string;
}) {
  const { statuses } = useStatuses();

  const ids = useMemo(
    () =>
      Object.entries(statuses)
        .filter(([, s]) => s === status)
        .map(([id]) => id),
    [statuses, status]
  );

  const { jobs, loading, incomplete } = useJobsByIds(ids);

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="font-display text-xl font-bold tracking-tight">{title}</h1>
        <span className="font-mono text-sm text-ink-muted">{jobs.length}</span>
      </div>

      {incomplete && (
        <p className="mb-4 text-sm text-ink-muted">Some jobs couldn&apos;t load. Refresh to retry.</p>
      )}

      {loading ? (
        <div className="py-20 text-center">
          <p className="text-sm text-ink-muted animate-pulse">Loading...</p>
        </div>
      ) : (
        <JobList jobs={jobs} emptyMessage={empty} />
      )}
    </div>
  );
}

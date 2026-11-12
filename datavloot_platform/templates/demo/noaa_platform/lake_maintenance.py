"""
Lake maintenance: merges small files, expires old snapshots and deletes files
nothing refers to any more, so the lake does not grow without bound.

Runs daily at 03:00 while Dagster runs, unless DATAVLOOT_LAKE_MAINTENANCE=off
(in .env or the environment): then the schedule starts stopped and the job
runs only when started by hand. What each step does, and why its margins are
what they are: datavloot_platform/maintenance.py.
"""

import datetime

from dagster import Config, DefaultScheduleStatus, OpExecutionContext, Output, ScheduleDefinition, job, op

from datavloot_platform import maintenance

from .assets import LAKE_POOL, PROJECT_DIR


class LakeMaintenanceConfig(Config):
    # How long old snapshots stay available for time travel, in whole days.
    keep_snapshots_days: int = maintenance.KEEP_SNAPSHOTS.days


# In the lake pool: merging and expiring commit to the lake like any writer.
@op(pool=LAKE_POOL)
def maintain_lake(context: OpExecutionContext, config: LakeMaintenanceConfig):
    result = maintenance.maintain(
        PROJECT_DIR, keep_snapshots=datetime.timedelta(days=config.keep_snapshots_days)
    )
    if result["cleanup_skipped"]:
        context.log.warning("The lake's file lock is held (a backup?); deleting files waits for the next run.")
    return Output(result, metadata=result)


@job
def lake_maintenance():
    maintain_lake()


lake_maintenance_schedule = ScheduleDefinition(
    job=lake_maintenance,
    cron_schedule="0 3 * * *",
    default_status=DefaultScheduleStatus.RUNNING if maintenance.scheduled() else DefaultScheduleStatus.STOPPED,
)

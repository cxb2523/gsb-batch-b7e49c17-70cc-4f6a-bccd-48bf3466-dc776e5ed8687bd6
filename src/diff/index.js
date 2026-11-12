const store = require('../store');
const { logger } = require('../utils');

const EVENT_TYPES = {
  JOB_NEW: 'JOB_NEW',
  JOB_UPDATED: 'JOB_UPDATED',
  JOB_REMOVED: 'JOB_REMOVED',
};

async function detectChanges(normalizedJobs, company) {
  const changes = [];
  const currentActiveJobIds = normalizedJobs.map(j => j.jobId);

  // Skip re-sending the (large) description over the wire for jobs whose
  // content hasn't changed — this is what was blowing through Neon's egress cap.
  const existingHashes = await store.getContentHashesForCompany(company);

  for (const job of normalizedJobs) {
    if (existingHashes.get(job.jobId) === job.contentHash) {
      await store.touchJob(company, job.jobId, job.scrapedAt);
      continue;
    }

    const result = await store.upsertJob(job);

    if (result === 'inserted') {
      changes.push({ type: EVENT_TYPES.JOB_NEW, job });
      await store.saveSnapshot(job);
      logger.debug(`NEW: ${job.title} at ${company}`);
    } else if (result === 'updated') {
      // No need to re-fetch — the job object in hand IS the new version.
      // previousJob is not used in any consumer, so we omit the extra SELECT.
      changes.push({
        type: EVENT_TYPES.JOB_UPDATED,
        job,
      });
      await store.saveSnapshot(job);
      logger.debug(`UPDATED: ${job.title} at ${company}`);
    }
  }

  const removedJobs = await store.markRemovedJobs(company, currentActiveJobIds);

  for (const job of removedJobs) {
    changes.push({ type: EVENT_TYPES.JOB_REMOVED, job });
    logger.debug(`REMOVED: ${job.title} at ${company}`);
  }

  logger.info(
    `Diff for ${company}: ${countByType(changes, EVENT_TYPES.JOB_NEW)} new, ` +
    `${countByType(changes, EVENT_TYPES.JOB_UPDATED)} updated, ` +
    `${countByType(changes, EVENT_TYPES.JOB_REMOVED)} removed`
  );

  return changes;
}

function countByType(changes, type) {
  return changes.filter(c => c.type === type).length;
}

module.exports = { detectChanges, EVENT_TYPES };

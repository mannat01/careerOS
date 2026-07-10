
import { Queue } from 'bullmq';

/**
 * ExportQueue — injectable boundary for enqueuing full-export jobs (me.export, Green).
 * Real BullMQ→Redis in dev/CI integration; in-memory fake available for pure-unit tests.
 */
export interface ExportJob {
  userId: string;
  requestedAt: string;
  traceId: string;
}

export interface ExportQueue {
  enqueue(job: ExportJob): Promise<{ jobId: string }>;
}

export const EXPORT_QUEUE_NAME = 'me-export';

/** BullMQ-backed queue (Redis). */
export class BullMqExportQueue implements ExportQueue {
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    const url = new URL(redisUrl);
    this.queue = new Queue(EXPORT_QUEUE_NAME, {
      connection: { host: url.hostname, port: url.port ? Number(url.port) : 6379 },
    });
  }

  async enqueue(job: ExportJob): Promise<{ jobId: string }> {
    const added = await this.queue.add('full-export', job, {
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    return { jobId: added.id ?? 'unknown' };
  }

  /** For tests: count waiting jobs, then close. */
  async waitingCount(): Promise<number> {
    return this.queue.getWaitingCount();
  }

  async drain(): Promise<void> {
    await this.queue.drain();
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

/** In-memory fake for DB-free unit tests. */
export class InMemoryExportQueue implements ExportQueue {
  readonly jobs: ExportJob[] = [];

  enqueue(job: ExportJob): Promise<{ jobId: string }> {
    this.jobs.push(job);
    return Promise.resolve({ jobId: `mem-${this.jobs.length}` });
  }
}

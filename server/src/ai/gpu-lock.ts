import { logger } from "../logger.js";

/**
 * A global singleton queue so VRAM-intensive tasks (LLM inference, voice
 * generation) never overlap on a shared GPU. Ported from epyc-codex.
 */
export class GpuLock {
  private static instance: GpuLock;
  private queue: Promise<unknown> = Promise.resolve();
  private activeCount = 0;

  private constructor() {}

  static getInstance(): GpuLock {
    if (!GpuLock.instance) {
      GpuLock.instance = new GpuLock();
    }
    return GpuLock.instance;
  }

  async enqueue<T>(taskName: string, task: () => Promise<T>, coolDownMs = 1000): Promise<T> {
    const runTask = this.queue.then(async () => {
      this.activeCount += 1;
      logger.debug({ taskName, activeCount: this.activeCount }, "GPU task started");
      try {
        return await task();
      } finally {
        this.activeCount -= 1;
        logger.debug({ taskName, activeCount: this.activeCount }, "GPU task finished");
      }
    });

    this.queue = runTask.then(
      () => new Promise((resolve) => setTimeout(resolve, coolDownMs)),
      () => new Promise((resolve) => setTimeout(resolve, coolDownMs)),
    );

    return runTask;
  }
}

export const gpuLock = GpuLock.getInstance();

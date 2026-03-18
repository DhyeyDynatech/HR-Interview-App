export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

export class AIHandler {
  private static instance: AIHandler;
  private concurrencyLimit: number = 5;
  private activeCount: number = 0;
  private queue: (() => Promise<any>)[] = [];

  private constructor() {}

  public static getInstance(): AIHandler {
    if (!AIHandler.instance) {
      AIHandler.instance = new AIHandler();
    }
    return AIHandler.instance;
  }

  public setConcurrency(limit: number) {
    this.concurrencyLimit = limit;
  }

  /**
   * Executes a task with concurrency control and exponential backoff
   */
  public async execute<T>(
    task: () => Promise<T>,
    config: RetryConfig = { maxRetries: 5, initialDelayMs: 2000, maxDelayMs: 30000 }
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          const result = await this.executeWithRetry(task, config);
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.activeCount--;
          this.processQueue();
        }
      };

      this.queue.push(wrappedTask);
      this.processQueue();
    });
  }

  private processQueue() {
    while (this.activeCount < this.concurrencyLimit && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task) {
        this.activeCount++;
        task();
      }
    }
  }

  private async executeWithRetry<T>(
    task: () => Promise<T>,
    config: RetryConfig,
    attempt: number = 0
  ): Promise<T> {
    try {
      return await task();
    } catch (error: any) {
      const isRateLimit = error?.status === 429 || error?.message?.includes("429");
      const isTimeout = error?.message?.includes("timeout");

      if ((isRateLimit || isTimeout) && attempt < config.maxRetries) {
        const delay = Math.min(
          config.initialDelayMs * Math.pow(2, attempt),
          config.maxDelayMs
        );
        console.warn(`[AIHandler] Rate limit/timeout hit. Retrying in ${delay}ms... (Attempt ${attempt + 1}/${config.maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
        return this.executeWithRetry(task, config, attempt + 1);
      }
      throw error;
    }
  }
}

export const aiHandler = AIHandler.getInstance();

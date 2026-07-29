export const CHAT_RECEIVE_MAX_PENDING = 256
export const CHAT_RECEIVE_CONCURRENCY = 8

interface QueueItem<TInput> {
  sequence: number
  input: TInput
}

type QueueOutcome<TOutput> = { ok: true; value: TOutput } | { ok: false; error: unknown }

export interface OrderedReceiveQueueOptions<TInput, TOutput> {
  maxPending: number
  concurrency: number
  process: (input: TInput) => Promise<TOutput>
  commit: (output: TOutput) => void | Promise<void>
  onError?: (error: unknown) => void
  onOverflow?: (pending: number) => void
  onRecovered?: (dropped: number) => void
}

/**
 * Runs expensive receive work concurrently while committing results in input
 * order. The pending limit includes queued, running and completed work so slow
 * consumers cannot retain an unbounded number of frames.
 */
export class OrderedReceiveQueue<TInput, TOutput> {
  private readonly queued: QueueItem<TInput>[] = []
  private readonly completed = new Map<number, QueueOutcome<TOutput>>()
  private nextSequence = 0
  private nextCommit = 0
  private running = 0
  private outstanding = 0
  private committing = false
  private closed = false
  private overflowActive = false
  private droppedInEpisode = 0

  constructor(private readonly options: OrderedReceiveQueueOptions<TInput, TOutput>) {}

  get pendingCount(): number {
    return this.outstanding
  }

  enqueue(input: TInput): boolean {
    if (this.closed) return false
    if (this.outstanding >= this.options.maxPending) {
      this.droppedInEpisode++
      if (!this.overflowActive) {
        this.overflowActive = true
        this.notify(this.options.onOverflow, this.outstanding)
      }
      return false
    }

    this.queued.push({ sequence: this.nextSequence++, input })
    this.outstanding++
    this.pump()
    return true
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.queued.length = 0
    this.completed.clear()
    this.outstanding = 0
  }

  private pump(): void {
    if (this.closed) return
    while (this.running < this.options.concurrency && this.queued.length > 0) {
      const item = this.queued.shift()
      if (!item) return
      this.start(item)
    }
  }

  private start(item: QueueItem<TInput>): void {
    this.running++
    void Promise.resolve()
      .then(() => this.options.process(item.input))
      .then(
        (value) => this.finish(item.sequence, { ok: true, value }),
        (error) => this.finish(item.sequence, { ok: false, error })
      )
  }

  private finish(sequence: number, outcome: QueueOutcome<TOutput>): void {
    this.running--
    if (this.closed) return
    this.completed.set(sequence, outcome)
    this.pump()
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.closed || this.committing) return
    this.committing = true
    try {
      while (!this.closed) {
        const outcome = this.completed.get(this.nextCommit)
        if (!outcome) break
        this.completed.delete(this.nextCommit)

        if (outcome.ok) {
          try {
            await this.options.commit(outcome.value)
          } catch (error) {
            this.reportError(error)
          }
        } else {
          this.reportError(outcome.error)
        }
        if (this.closed) break

        this.nextCommit++
        this.outstanding--
        if (this.overflowActive && this.outstanding < this.options.maxPending / 2) {
          const dropped = this.droppedInEpisode
          this.overflowActive = false
          this.droppedInEpisode = 0
          this.notify(this.options.onRecovered, dropped)
        }
      }
    } finally {
      this.committing = false
      if (!this.closed && this.completed.has(this.nextCommit)) void this.drain()
    }
  }

  private reportError(error: unknown): void {
    this.notify(this.options.onError, error)
  }

  private notify<T>(notify: ((value: T) => void) | undefined, value: T): void {
    try {
      notify?.(value)
    } catch {
      // Observability callbacks must never break receive progress.
    }
  }
}

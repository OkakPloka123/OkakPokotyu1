import { randomBytes } from 'node:crypto'
import { startCommand, type CommandProcess } from './shell'

/** Background commands are killed after this long. */
export const JOB_TIME_LIMIT_MS = 60 * 60_000
const MAX_RUNNING = 8
const MAX_KEPT_FINISHED = 50

export type JobState = 'running' | 'done' | 'failed' | 'stopped' | 'timeout'

export interface JobInfo {
  id: string
  command: string
  state: JobState
  exitCode: number | null
  runtimeMs: number
  truncated: boolean
  output: string
}

interface Job {
  id: string
  command: string
  proc: CommandProcess
  startedAt: number
  endedAt: number | null
  state: JobState
  exitCode: number | null
  error: string | null
  readOffset: number
  settled: Promise<void>
}

/**
 * Commands that keep running after the request that started them returns, so a long build or a
 * dev server does not run into the MCP client's request timeout.
 */
export class JobManager {
  private readonly jobs = new Map<string, Job>()

  /** `onFinish` gets the job with its full output. */
  constructor(private readonly onFinish: (job: JobInfo) => void = () => {}) {}

  start(command: string, cwd: string): string {
    const running = this.list().filter((job) => job.state === 'running').length
    if (running >= MAX_RUNNING) {
      throw new Error(
        `${running} background commands are already running. Stop some with stop_command first.`
      )
    }
    const proc = startCommand(command, cwd)
    const job: Job = {
      id: randomBytes(4).toString('hex'),
      command,
      proc,
      startedAt: Date.now(),
      endedAt: null,
      state: 'running',
      exitCode: null,
      error: null,
      readOffset: 0,
      settled: Promise.resolve()
    }
    const timer = setTimeout(() => {
      if (job.state !== 'running') return
      job.state = 'timeout'
      proc.kill()
    }, JOB_TIME_LIMIT_MS)
    job.settled = proc.done
      .then(
        (exitCode) => {
          job.exitCode = exitCode
          if (job.state === 'running') job.state = exitCode === 0 ? 'done' : 'failed'
        },
        (err: unknown) => {
          job.error = err instanceof Error ? err.message : String(err)
          if (job.state === 'running') job.state = 'failed'
        }
      )
      .finally(() => {
        clearTimeout(timer)
        job.endedAt = Date.now()
        this.prune()
        try {
          this.onFinish(this.info(job, false))
        } catch (err) {
          console.error('[jobs] onFinish failed', err)
        }
      })
    this.jobs.set(job.id, job)
    return job.id
  }

  /** Waits until the job finishes or `ms` passes; returns the output produced since the last read. */
  async wait(id: string, ms: number, signal?: AbortSignal): Promise<JobInfo> {
    const job = this.get(id)
    if (job.state === 'running' && ms > 0) await Promise.race([job.settled, delay(ms, signal)])
    return this.info(job, true)
  }

  stop(id: string): JobInfo {
    const job = this.get(id)
    if (job.state === 'running') {
      job.state = 'stopped'
      job.proc.kill()
    }
    return this.info(job, true)
  }

  stopAll(): void {
    for (const job of this.jobs.values()) {
      if (job.state !== 'running') continue
      job.state = 'stopped'
      job.proc.kill()
    }
  }

  /** Known jobs, oldest first, without their output. */
  list(): JobInfo[] {
    return [...this.jobs.values()].map((job) => ({ ...this.info(job, false), output: '' }))
  }

  private get(id: string): Job {
    const job = this.jobs.get(id)
    if (!job)
      throw new Error(`Unknown job "${id}". Call command_output without job_id to list jobs.`)
    return job
  }

  private info(job: Job, consume: boolean): JobInfo {
    const all = job.proc.output
    let output = consume ? all.slice(job.readOffset) : all
    if (consume) job.readOffset = all.length
    if (job.error) output += `${output ? '\n' : ''}${job.error}`
    return {
      id: job.id,
      command: job.command,
      state: job.state,
      exitCode: job.exitCode,
      runtimeMs: (job.endedAt ?? Date.now()) - job.startedAt,
      truncated: job.proc.truncated,
      output
    }
  }

  private prune(): void {
    const finished = [...this.jobs.values()].filter((job) => job.state !== 'running')
    for (const job of finished.slice(0, Math.max(0, finished.length - MAX_KEPT_FINISHED))) {
      this.jobs.delete(job.id)
    }
  }
}

/** Resolves after `ms`, or earlier when `signal` aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }
    const finish = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
  })
}

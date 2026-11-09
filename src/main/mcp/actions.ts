import { randomUUID } from 'node:crypto'
import type { ToolCall, ToolItem, ToolStatus } from '../../shared/types'
import { truncateMiddle } from '../agent/protocol'
import { executeTool } from '../tools'
import { JOB_TIME_LIMIT_MS, JobManager, type JobInfo } from '../tools/jobs'
import { decide } from '../tools/policy'
import { shellCommand } from '../tools/shell'

/**
 * How long one MCP call may take, approval included. MCP clients commonly give up on a request
 * after about 60 s, so answer before that.
 */
export const CALL_BUDGET_MS = 50_000
export const DEFAULT_COMMAND_WAIT_MS = 30_000
const MAX_RESULT_CHARS = 30_000
const MAX_JOURNAL_CHARS = 8_000

export interface ActionResult {
  ok: boolean
  text: string
}

export interface ActionHost {
  workspace(): string | null
  /** Adds a journal item or replaces the one with the same id. */
  log(item: ToolItem): void
  approvalRequested(item: ToolItem): void
}

type Answer = 'approved' | 'rejected' | 'timeout' | 'cancelled'
type Gate =
  { kind: 'allowed'; item: ToolItem; workspace: string } | { kind: 'done'; result: ActionResult }

/** The tools an external agent calls over MCP, behind the same approvals as the built-in chat. */
export class McpActions {
  readonly jobs: JobManager
  private readonly approvals = new Map<string, (answer: Answer) => void>()
  private readonly jobItems = new Map<string, ToolItem>()

  constructor(
    private readonly host: ActionHost,
    private readonly budgetMs = CALL_BUDGET_MS
  ) {
    this.jobs = new JobManager((job) => this.jobFinished(job))
  }

  workspaceInfo(): ActionResult {
    const workspace = this.host.workspace()
    const os =
      process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'
    const shell = process.platform === 'win32' ? 'PowerShell' : shellCommand('').file
    return {
      ok: true,
      text: [
        `Operating system: ${os}`,
        `Shell for run_command: ${shell}`,
        `Working folder: ${workspace ?? 'not selected. Ask the user to choose one in the Desktop Agent app.'}`,
        '',
        'Rules:',
        '- Paths are relative to the working folder; file tools cannot leave it.',
        `- write_file and run_command wait up to ${Math.round(this.budgetMs / 1000)} s for the user to approve them in the app.`,
        '- run_command returns after wait_seconds; a longer command keeps running in the background, follow it with command_output.',
        '- Obviously destructive commands are blocked.'
      ].join('\n')
    }
  }

  /** list_dir, read_file and write_file. */
  async runTool(call: ToolCall, signal: AbortSignal): Promise<ActionResult> {
    const gate = await this.authorize(call, signal, Date.now() + this.budgetMs)
    if (gate.kind === 'done') return gate.result
    this.host.log({ ...gate.item, status: 'running' })
    const result = await executeTool(call, gate.workspace, signal)
    return this.finish(gate.item, result.ok ? 'done' : 'error', {
      ok: result.ok,
      text: result.output
    })
  }

  async runCommand(command: string, waitMs: number, signal: AbortSignal): Promise<ActionResult> {
    const deadline = Date.now() + this.budgetMs
    const gate = await this.authorize({ name: 'run_command', args: { command } }, signal, deadline)
    if (gate.kind === 'done') return gate.result

    let jobId: string
    try {
      jobId = this.jobs.start(command, gate.workspace)
    } catch (err) {
      return this.finish(gate.item, 'error', { ok: false, text: errorMessage(err) })
    }
    const running: ToolItem = { ...gate.item, status: 'running', jobId }
    this.jobItems.set(jobId, running)
    this.host.log(running)
    const job = await this.jobs.wait(
      jobId,
      Math.min(waitMs, Math.max(1000, deadline - Date.now())),
      signal
    )
    return describeJob(job)
  }

  async commandOutput(
    jobId: string | undefined,
    waitMs: number,
    signal: AbortSignal
  ): Promise<ActionResult> {
    if (jobId === undefined) {
      const jobs = this.jobs.list()
      if (jobs.length === 0) return { ok: true, text: 'No background commands.' }
      return {
        ok: true,
        text: jobs.map((job) => `${job.id}  ${job.state}  ${job.command}`).join('\n')
      }
    }
    try {
      return describeJob(await this.jobs.wait(jobId, Math.min(waitMs, this.budgetMs), signal))
    } catch (err) {
      return { ok: false, text: errorMessage(err) }
    }
  }

  stopCommand(jobId: string): ActionResult {
    try {
      return describeJob(this.jobs.stop(jobId))
    } catch (err) {
      return { ok: false, text: errorMessage(err) }
    }
  }

  respond(itemId: string, approved: boolean): void {
    this.approvals.get(itemId)?.(approved ? 'approved' : 'rejected')
  }

  /** Declines every pending approval and stops every background command. */
  cancelAll(): void {
    for (const settle of [...this.approvals.values()]) settle('cancelled')
    this.jobs.stopAll()
  }

  private async authorize(call: ToolCall, signal: AbortSignal, deadline: number): Promise<Gate> {
    const item: ToolItem = {
      id: randomUUID(),
      at: Date.now(),
      kind: 'tool',
      call,
      status: 'pending'
    }
    const done = (status: ToolStatus, result: ActionResult, journal?: string): Gate => ({
      kind: 'done',
      result: this.finish(item, status, result, journal)
    })

    const workspace = this.host.workspace()
    if (!workspace) {
      return done(
        'error',
        {
          ok: false,
          text: 'No working folder is selected. Ask the user to choose one in the Desktop Agent app.'
        },
        'Рабочая папка не выбрана.'
      )
    }

    const decision = decide(call)
    if (decision.kind === 'deny') {
      return done(
        'blocked',
        {
          ok: false,
          text: `Blocked by the Desktop Agent app (${decision.reason}). Commands like this are never run.`
        },
        `Заблокировано: ${decision.reason}.`
      )
    }

    if (decision.kind === 'ask') {
      this.host.log(item)
      this.host.approvalRequested(item)
      const answer = await this.waitForAnswer(item.id, deadline - Date.now(), signal)
      if (answer !== 'approved') {
        const seconds = Math.round(this.budgetMs / 1000)
        const declined = {
          rejected: [
            'The user rejected this action. Do not retry it; ask the user what to do instead.',
            'Вы отклонили действие.'
          ],
          timeout: [
            `The user did not answer within ${seconds} s, so nothing was done. Ask the user to keep the Desktop Agent window in view and approve the request, then try again.`,
            `Нет ответа за ${seconds} с, агент получил отказ.`
          ],
          cancelled: [
            'The request was cancelled before the user answered.',
            'Запрос отменён до ответа.'
          ]
        }[answer]
        return done('rejected', { ok: false, text: declined[0] }, declined[1])
      }
    }
    return { kind: 'allowed', item, workspace }
  }

  private waitForAnswer(itemId: string, ms: number, signal: AbortSignal): Promise<Answer> {
    return new Promise((resolve) => {
      const settle = (answer: Answer): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        this.approvals.delete(itemId)
        resolve(answer)
      }
      const onAbort = (): void => settle('cancelled')
      const timer = setTimeout(() => settle('timeout'), Math.max(0, ms))
      this.approvals.set(itemId, settle)
      if (signal.aborted) settle('cancelled')
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private jobFinished(job: JobInfo): void {
    const item = this.jobItems.get(job.id)
    if (!item) return
    this.jobItems.delete(job.id)
    const { text } = describeJob(job)
    this.host.log({
      ...item,
      status: job.state === 'done' ? 'done' : 'error',
      output: truncateMiddle(text, MAX_JOURNAL_CHARS)
    })
  }

  private finish(
    item: ToolItem,
    status: ToolStatus,
    result: ActionResult,
    journal = result.text
  ): ActionResult {
    this.host.log({ ...item, status, output: truncateMiddle(journal, MAX_JOURNAL_CHARS) })
    return { ok: result.ok, text: truncateMiddle(result.text, MAX_RESULT_CHARS) }
  }
}

function describeJob(job: JobInfo): ActionResult {
  const output = truncateMiddle(job.output.trimEnd(), MAX_RESULT_CHARS)
  if (job.state === 'running') {
    return {
      ok: true,
      text: [
        `Still running in the background as job ${job.id} (${Math.round(job.runtimeMs / 1000)} s so far).`,
        `Call command_output with job_id "${job.id}" to wait for more output, or stop_command to stop it.`,
        '',
        output ? `Output so far:\n${output}` : 'No output yet.'
      ].join('\n')
    }
  }
  const status =
    job.state === 'stopped'
      ? 'Stopped.'
      : job.state === 'timeout'
        ? `Stopped: the ${JOB_TIME_LIMIT_MS / 60_000}-minute limit was reached.`
        : `Exit code: ${job.exitCode ?? 'none'}`
  const lines = [status, '', output || '(no output)']
  if (job.truncated) lines.push('[output truncated]')
  return { ok: job.state === 'done', text: lines.join('\n') }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

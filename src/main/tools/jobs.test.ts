import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JobManager } from './jobs'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'jobs-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('JobManager', () => {
  it('returns the result of a quick command', async () => {
    const jobs = new JobManager()
    const job = await jobs.wait(jobs.start('echo hello', dir), 5000)
    expect(job).toMatchObject({ state: 'done', exitCode: 0 })
    expect(job.output).toContain('hello')
  })

  it('keeps a long command running and returns only new output', async () => {
    const jobs = new JobManager()
    const id = jobs.start('echo first; sleep 1; echo second', dir)

    const early = await jobs.wait(id, 300)
    expect(early.state).toBe('running')
    expect(early.output).toContain('first')
    expect(early.output).not.toContain('second')

    const late = await jobs.wait(id, 5000)
    expect(late.state).toBe('done')
    expect(late.output).toContain('second')
    expect(late.output).not.toContain('first')
  })

  it('stops a command and reports it with the full output', async () => {
    const finished = vi.fn()
    const jobs = new JobManager(finished)
    const id = jobs.start('echo started; sleep 5', dir)
    await jobs.wait(id, 200)

    expect(jobs.stop(id).state).toBe('stopped')
    await vi.waitFor(() =>
      expect(finished).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          state: 'stopped',
          output: expect.stringContaining('started')
        })
      )
    )
    expect(jobs.list()).toEqual([expect.objectContaining({ id, state: 'stopped', output: '' })])
  })

  it('reports a failing command and an unknown job', async () => {
    const jobs = new JobManager()
    expect(await jobs.wait(jobs.start('exit 2', dir), 5000)).toMatchObject({
      state: 'failed',
      exitCode: 2
    })
    await expect(jobs.wait('nope', 0)).rejects.toThrow(/Unknown job/)
  })
})

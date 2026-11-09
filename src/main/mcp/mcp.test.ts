import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolItem } from '../../shared/types'
import { Store } from '../store'
import { McpService } from './service'

let dataDir: string
let workspace: string
let service: McpService
let approvals: ToolItem[]
let answered: Set<string>
let clients: Client[]

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'mcp-data-'))
  workspace = await realpath(await mkdtemp(path.join(tmpdir(), 'mcp-ws-')))
  await writeFile(path.join(workspace, 'notes.txt'), 'hello')
  const store = new Store(dataDir)
  store.settings.workspace = workspace
  store.settings.mcp.port = 0
  approvals = []
  answered = new Set()
  clients = []
  service = new McpService(
    store,
    { updated: () => {}, approvalRequested: (item) => approvals.push(item) },
    { budgetMs: 1500 }
  )
  expect((await service.setEnabled(true)).state).toBe('running')
})

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()))
  await service.setEnabled(false)
  await rm(dataDir, { recursive: true, force: true })
  await rm(workspace, { recursive: true, force: true })
})

async function connect(): Promise<Client> {
  const { url, token } = service.snapshot()
  const client = new Client({ name: 'test-agent', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
  clients.push(client)
  return client
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {}
): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as { type: string; text?: string }[]
  return {
    text: content.map((part) => part.text ?? '').join('\n'),
    isError: result.isError === true
  }
}

/** Answers the oldest approval request not answered yet, waiting for it to show up. */
async function answer(approved: boolean): Promise<void> {
  let next: ToolItem | undefined
  await vi.waitFor(() => {
    next = approvals.find((item) => !answered.has(item.id))
    expect(next).toBeDefined()
  })
  answered.add(next!.id)
  service.respond(next!.id, approved)
}

describe('MCP server', () => {
  it('refuses requests without the right token', async () => {
    const { url } = service.snapshot()
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    expect((await fetch(url, init)).status).toBe(401)
    const wrong = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: 'Bearer wrong' }
    })
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('www-authenticate')).toMatch(/^Bearer/)
  })

  it('lists the tools', async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'command_output',
      'list_dir',
      'read_file',
      'run_command',
      'stop_command',
      'workspace_info',
      'write_file'
    ])
  })

  it('reads without asking and writes only after approval', async () => {
    const client = await connect()
    expect((await call(client, 'workspace_info')).text).toContain(workspace)
    expect((await call(client, 'list_dir')).text).toContain('notes.txt')
    expect(approvals).toHaveLength(0)

    const writing = call(client, 'write_file', { path: 'out/a.txt', content: 'Привет' })
    await answer(true)
    expect((await writing).isError).toBe(false)
    expect(await readFile(path.join(workspace, 'out', 'a.txt'), 'utf8')).toBe('Привет')
    expect(service.snapshot().items[0]).toMatchObject({
      status: 'done',
      call: { name: 'write_file' }
    })
  })

  it('reports rejections, timeouts and blocked commands to the agent', async () => {
    const client = await connect()

    const rejected = call(client, 'write_file', { path: 'a.txt', content: 'x' })
    await answer(false)
    expect(await rejected).toMatchObject({
      isError: true,
      text: expect.stringContaining('rejected')
    })

    const ignored = await call(client, 'write_file', { path: 'b.txt', content: 'x' })
    expect(ignored).toMatchObject({
      isError: true,
      text: expect.stringContaining('did not answer')
    })

    const before = approvals.length
    const blocked = await call(client, 'run_command', { command: 'rm -rf /' })
    expect(blocked).toMatchObject({ isError: true, text: expect.stringContaining('Blocked') })
    expect(approvals).toHaveLength(before)
    expect(service.snapshot().items.map((item) => item.status)).toEqual([
      'blocked',
      'rejected',
      'rejected'
    ])
  })

  it('runs commands and follows the ones that outlive the call', async () => {
    const client = await connect()

    const quick = call(client, 'run_command', { command: 'echo hi' })
    await answer(true)
    expect((await quick).text).toMatch(/Exit code: 0\s+hi/)

    const slow = call(client, 'run_command', {
      command: 'sleep 2 && echo finished',
      wait_seconds: 1
    })
    await answer(true)
    const started = await slow
    expect(started.text).toContain('Still running')
    const jobId = /job ([0-9a-f]{8})/.exec(started.text)?.[1]
    expect(jobId).toBeDefined()

    const done = await call(client, 'command_output', { job_id: jobId, wait_seconds: 10 })
    expect(done.text).toMatch(/Exit code: 0\s+finished/)
    await vi.waitFor(() =>
      expect(service.snapshot().items[0]).toMatchObject({ jobId, status: 'done' })
    )
  })

  it('answers 2025-era clients with plain JSON', async () => {
    const { url, token } = service.snapshot()
    const post = async (body: object): Promise<Response> =>
      fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-06-18'
        },
        body: JSON.stringify(body)
      })

    const init = await post({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'old-agent', version: '1.0.0' }
      }
    })
    expect(init.status).toBe(200)
    expect(init.headers.get('content-type')).toContain('application/json')
    expect((await init.json()).result.serverInfo.name).toBe('desktop-agent')

    const listed = await post({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_dir', arguments: {} }
    })
    expect(listed.headers.get('content-type')).toContain('application/json')
    expect((await listed.json()).result.content[0].text).toContain('notes.txt')
  })
})

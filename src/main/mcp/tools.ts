import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import {
  CALL_BUDGET_MS,
  DEFAULT_COMMAND_WAIT_MS,
  type ActionResult,
  type McpActions
} from './actions'

const MAX_WAIT_SECONDS = Math.floor(CALL_BUDGET_MS / 1000) - 5

/** A fresh MCP server instance; the HTTP layer creates one per request. */
export function buildMcpServer(actions: McpActions, version: string): McpServer {
  const shell = process.platform === 'win32' ? 'PowerShell' : "the user's default shell"
  const server = new McpServer(
    { name: 'desktop-agent', version },
    {
      instructions: [
        "Tools of the Desktop Agent app on the user's own computer.",
        'Start with workspace_info. Paths are relative to the working folder chosen in the app.',
        'write_file and run_command run only after the user approves them in the app window.',
        'Long commands keep running in the background: follow them with command_output.'
      ].join(' ')
    }
  )

  server.registerTool(
    'workspace_info',
    {
      title: 'Computer and working folder',
      description:
        "Describe the user's computer: operating system, shell and the working folder that all paths are relative to. Call this first.",
      annotations: { readOnlyHint: true }
    },
    () => toResult(actions.workspaceInfo())
  )

  server.registerTool(
    'list_dir',
    {
      title: 'List folder',
      description: 'List files and folders inside the working folder.',
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe('Folder relative to the working folder, "." by default')
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ path }, ctx) =>
      toResult(
        await actions.runTool(
          { name: 'list_dir', args: path === undefined ? {} : { path } },
          ctx.mcpReq.signal
        )
      )
  )

  server.registerTool(
    'read_file',
    {
      title: 'Read file',
      description: 'Read a UTF-8 text file (up to 512 KB) from the working folder.',
      inputSchema: z.object({ path: z.string().describe('File relative to the working folder') }),
      annotations: { readOnlyHint: true }
    },
    async ({ path }, ctx) =>
      toResult(await actions.runTool({ name: 'read_file', args: { path } }, ctx.mcpReq.signal))
  )

  server.registerTool(
    'write_file',
    {
      title: 'Write file',
      description:
        'Create or overwrite a text file in the working folder. Runs only after the user approves it in the Desktop Agent app.',
      inputSchema: z.object({
        path: z.string().describe('File relative to the working folder'),
        content: z.string().describe('The complete new file content')
      }),
      annotations: { destructiveHint: true }
    },
    async ({ path, content }, ctx) =>
      toResult(
        await actions.runTool({ name: 'write_file', args: { path, content } }, ctx.mcpReq.signal)
      )
  )

  server.registerTool(
    'run_command',
    {
      title: 'Run command',
      description: `Run a command in the working folder with ${shell}. Runs only after the user approves it in the Desktop Agent app. Waits up to wait_seconds for the command to finish; a command that is still running continues in the background, and the result names a job_id for command_output and stop_command.`,
      inputSchema: z.object({
        command: z.string().describe('The command line to run'),
        wait_seconds: z
          .number()
          .int()
          .min(1)
          .max(MAX_WAIT_SECONDS)
          .optional()
          .describe(`How long to wait for the result, ${DEFAULT_COMMAND_WAIT_MS / 1000} by default`)
      }),
      annotations: { destructiveHint: true, openWorldHint: true }
    },
    async ({ command, wait_seconds }, ctx) =>
      toResult(
        await actions.runCommand(
          command,
          (wait_seconds ?? DEFAULT_COMMAND_WAIT_MS / 1000) * 1000,
          ctx.mcpReq.signal
        )
      )
  )

  server.registerTool(
    'command_output',
    {
      title: 'Command output',
      description:
        'Wait for a background command started by run_command and return the output produced since the previous check. Without job_id, list background commands.',
      inputSchema: z.object({
        job_id: z.string().optional(),
        wait_seconds: z
          .number()
          .int()
          .min(0)
          .max(MAX_WAIT_SECONDS)
          .optional()
          .describe('How long to wait for the command to finish, 10 by default')
      }),
      annotations: { readOnlyHint: true }
    },
    async ({ job_id, wait_seconds }, ctx) =>
      toResult(await actions.commandOutput(job_id, (wait_seconds ?? 10) * 1000, ctx.mcpReq.signal))
  )

  server.registerTool(
    'stop_command',
    {
      title: 'Stop command',
      description: 'Stop a background command started by run_command.',
      inputSchema: z.object({ job_id: z.string() })
    },
    ({ job_id }) => toResult(actions.stopCommand(job_id))
  )

  return server
}

function toResult(result: ActionResult): CallToolResult {
  const content: CallToolResult['content'] = [{ type: 'text', text: result.text }]
  return result.ok ? { content } : { content, isError: true }
}

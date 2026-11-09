import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  createMcpHandler,
  isLegacyRequest,
  WebStandardStreamableHTTPServerTransport,
  type McpServer
} from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'

export interface McpHttpOptions {
  port: number
  host?: string
  /** Read on every request, so a new token applies immediately. */
  token(): string
  createServer(): McpServer
  onerror?(error: Error): void
}

export interface McpHttpServer {
  port: number
  close(): Promise<void>
}

/**
 * Serves MCP over Streamable HTTP behind a bearer token. Every response is plain JSON, never SSE:
 * Cloudflare quick tunnels do not support SSE.
 */
export async function startMcpHttp(options: McpHttpOptions): Promise<McpHttpServer> {
  const onerror = (error: Error): void => options.onerror?.(error)
  const modern = createMcpHandler(() => options.createServer(), {
    legacy: 'reject',
    responseMode: 'json',
    onerror
  })
  const handle = toNodeHandler(
    {
      fetch: async (request) => {
        if (request.method !== 'POST') {
          return new Response('Method not allowed.', { status: 405, headers: { Allow: 'POST' } })
        }
        // The SDK's own fallback for 2025-era clients answers with SSE, so serve those ourselves.
        if (await isLegacyRequest(request)) return serveLegacy(request, options.createServer)
        return modern.fetch(request)
      }
    },
    { onerror }
  )

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path !== '/mcp' && path !== '/') {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    if (!isAuthorized(req, options.token())) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="desktop-agent"')
      sendJson(res, 401, {
        error: 'unauthorized',
        error_description:
          'Send the token from the Desktop Agent app as "Authorization: Bearer <token>".'
      })
      return
    }
    void handle(req, res)
  })
  await listen(server, options.port, options.host ?? '127.0.0.1')
  const address = server.address()

  return {
    port: typeof address === 'object' && address ? address.port : options.port,
    close: async () => {
      await modern.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

async function serveLegacy(request: Request, create: () => McpServer): Promise<Response> {
  const server = create()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  })
  await server.connect(transport)
  // Closing the transport aborts the running tool call, e.g. a pending approval.
  const onAbort = (): void => void transport.close()
  request.signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await transport.handleRequest(request)
  } finally {
    request.signal.removeEventListener('abort', onAbort)
    void server.close()
  }
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  if (!token) return false
  const candidates: string[] = []
  const auth = req.headers.authorization
  if (auth) candidates.push(auth.replace(/^Bearer\s+/i, '').trim())
  const apiKey = req.headers['x-api-key']
  if (typeof apiKey === 'string') candidates.push(apiKey.trim())
  return candidates.some((candidate) => sameSecret(candidate, token))
}

function sameSecret(a: string, b: string): boolean {
  // Hashing gives equal-length buffers, which timingSafeEqual requires.
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(a), digest(b))
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

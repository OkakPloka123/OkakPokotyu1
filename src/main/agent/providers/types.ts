import type { ProviderInfo } from '../../../shared/types'

/** One conversation with an agent ("brain"). */
export interface ProviderSession {
  /** Sends a user message or a <result> block and resolves with the agent's full reply. */
  send(message: string, signal: AbortSignal): Promise<string>
}

export interface AgentProvider {
  info: ProviderInfo
  /**
   * `rules` explain the tool protocol. A provider decides how to deliver them: as a system prompt,
   * as part of the first message, and so on.
   */
  createSession(rules: string): ProviderSession
}

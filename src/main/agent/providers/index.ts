import { demoProvider } from './demo'
import type { AgentProvider } from './types'

export const providers: AgentProvider[] = [demoProvider]

export function getProvider(id: string): AgentProvider {
  return providers.find((provider) => provider.info.id === id) ?? demoProvider
}

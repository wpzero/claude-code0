import React from 'react'
import { ChatScreen } from './ui/ChatScreen.js'
import type { AgentDefinition, AnthropicMessageClient } from './types.js'

export function App(props: {
  client: AnthropicMessageClient
  model: string
  maxIterations: number
  workdir: string
  agents: AgentDefinition[]
}) {
  return <ChatScreen {...props} />
}

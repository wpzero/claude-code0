import React from 'react'
import { ChatScreen } from './ui/ChatScreen.js'
import type { AnthropicMessageClient } from './types.js'

export function App(props: {
  client: AnthropicMessageClient
  model: string
  maxIterations: number
  workdir: string
}) {
  return <ChatScreen {...props} />
}

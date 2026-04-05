import { streamAnthropicAssistantMessage } from './anthropic.js'
import { executeToolCall } from './toolExecutor.js'
import {
  createId,
  toAnthropicMessages,
} from './utils/messageTransform.js'
import type {
  AnthropicMessageClient,
  ChatMessage,
  QueryLoopEvent,
  ToolDefinition,
} from './types.js'

export async function runQueryLoop(params: {
  client: AnthropicMessageClient
  model: string
  history: ChatMessage[]
  tools: ToolDefinition[]
  maxIterations: number
  workdir: string
  onEvent?: (event: QueryLoopEvent) => void
}): Promise<{
  history: ChatMessage[]
  stopReason: 'completed' | 'max_iterations' | 'error'
}> {
  let history = [...params.history]

  for (let iteration = 0; iteration < params.maxIterations; iteration += 1) {
    try {
      const assistantMessage = await streamAnthropicAssistantMessage({
        client: params.client,
        model: params.model,
        messages: toAnthropicMessages(history),
        tools: params.tools,
        onSnapshot: message => {
          params.onEvent?.({ type: 'assistant_stream', message })
        },
      })
      history.push(assistantMessage)
      params.onEvent?.({ type: 'assistant', message: assistantMessage })

      const toolCalls = assistantMessage.content.filter(
        block => block.type === 'tool_use',
      )

      if (toolCalls.length === 0) {
        return { history, stopReason: 'completed' }
      }

      for (const toolCall of toolCalls) {
        const toolResult = await executeToolCall({
          request: toolCall,
          tools: params.tools,
          context: { workdir: params.workdir },
          onEvent: params.onEvent,
        })
        history.push(toolResult)
        params.onEvent?.({ type: 'tool_result', message: toolResult })
      }
    } catch (error) {
      const message = {
        type: 'system' as const,
        id: createId('system'),
        level: 'error' as const,
        text: error instanceof Error ? error.message : String(error),
      }
      history.push(message)
      params.onEvent?.({ type: 'system', message })
      return { history, stopReason: 'error' }
    }
  }

  const limitMessage = {
    type: 'system' as const,
    id: createId('system'),
    level: 'error' as const,
    text: `Stopped after reaching max iterations (${params.maxIterations}).`,
  }
  history.push(limitMessage)
  params.onEvent?.({ type: 'system', message: limitMessage })
  return { history, stopReason: 'max_iterations' }
}

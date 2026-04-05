import { streamAnthropicAssistantMessage } from './anthropic.js'
import { executeToolCall } from './toolExecutor.js'
import {
  createId,
  createToolResultMessage,
  toAnthropicMessages,
} from './utils/messageTransform.js'
import type {
  AnthropicMessageClient,
  ChatMessage,
  ToolApprovalDecision,
  ToolApprovalRequest,
  QueryLoopEvent,
  ToolDefinition,
} from './types.js'
import { debugLog } from './debug.js'

export async function runQueryLoop(params: {
  client: AnthropicMessageClient
  model: string
  history: ChatMessage[]
  tools: ToolDefinition[]
  maxIterations: number
  workdir: string
  onEvent?: (event: QueryLoopEvent) => void
  requestToolApproval?: (
    request: ToolApprovalRequest,
  ) => Promise<ToolApprovalDecision>
}): Promise<{
  history: ChatMessage[]
  stopReason: 'completed' | 'max_iterations' | 'error'
}> {
  let history = [...params.history]

  for (let iteration = 0; iteration < params.maxIterations; iteration += 1) {
    try {
      const apiMessages = toAnthropicMessages(history)
      debugLog('query.iteration.start', {
        iteration: iteration + 1,
        historyCount: history.length,
        apiMessageCount: apiMessages.length,
      })

      const assistantMessage = await streamAnthropicAssistantMessage({
        client: params.client,
        model: params.model,
        messages: apiMessages,
        tools: params.tools,
        onSnapshot: message => {
          params.onEvent?.({ type: 'assistant_stream', message })
        },
      })
      debugLog('query.assistant.final', {
        iteration: iteration + 1,
        assistantId: assistantMessage.id,
        content: assistantMessage.content.map(block =>
          block.type === 'text'
            ? { type: 'text', textLength: block.text.length }
            : { type: 'tool_use', name: block.name, input: block.input },
        ),
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
        const tool = params.tools.find(candidate => candidate.name === toolCall.name)
        if (tool?.requiresApproval === 'always') {
          const request: ToolApprovalRequest = {
            toolCall,
            tool: {
              name: tool.name,
              description: tool.description,
              requiresApproval: tool.requiresApproval,
              isReadOnly: tool.isReadOnly,
            },
          }
          params.onEvent?.({ type: 'tool_approval_requested', request })
          const decision = params.requestToolApproval
            ? await params.requestToolApproval(request)
            : 'rejected'

          debugLog('query.tool_approval', {
            iteration: iteration + 1,
            name: toolCall.name,
            decision,
          })

          if (decision === 'rejected') {
            const toolResult = createToolResultMessage({
              toolUseId: toolCall.id,
              toolName: toolCall.name,
              content: `Tool execution rejected by user: ${toolCall.name}`,
              isError: true,
            })
            history.push(toolResult)
            params.onEvent?.({ type: 'tool_result', message: toolResult })
            continue
          }
        }

        debugLog('query.tool_call', {
          iteration: iteration + 1,
          name: toolCall.name,
          input: toolCall.input,
        })
        const toolResult = await executeToolCall({
          request: toolCall,
          tools: params.tools,
          context: { workdir: params.workdir },
          onEvent: params.onEvent,
        })
        history.push(toolResult)
        debugLog('query.tool_result', {
          iteration: iteration + 1,
          toolName: toolResult.toolName,
          isError: toolResult.isError,
          contentLength: toolResult.content.length,
        })
        params.onEvent?.({ type: 'tool_result', message: toolResult })
      }
    } catch (error) {
      debugLog('query.error', {
        error: error instanceof Error ? error.message : String(error),
      })
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

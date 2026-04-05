import type {
  AnthropicMessageClient,
  AssistantMessage,
  AssistantTextBlock,
  AssistantToolUseBlock,
  ChatMessage,
  ToolResultMessage,
} from '../types.js'

export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now()}_${random}`
}

export function toAnthropicMessages(
  history: ChatMessage[],
): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = []

  for (const message of history) {
    if (message.type === 'system') {
      continue
    }

    if (message.type === 'user') {
      messages.push({ role: 'user', content: message.text })
      continue
    }

    if (message.type === 'assistant') {
      messages.push({
        role: 'assistant',
        content: message.content.map(block => {
          if (block.type === 'text') {
            return { type: 'text', text: block.text }
          }

          return {
            type: 'tool_use',
            id: block.id,
            name: block.name,
            input: block.input,
          }
        }),
      })
      continue
    }

    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: message.toolUseId,
          is_error: message.isError,
          content: message.content,
        },
      ],
    })
  }

  return messages
}

export function fromAnthropicAssistantMessage(
  response: Awaited<ReturnType<AnthropicMessageClient['messages']['create']>>,
): AssistantMessage {
  const content = Array.isArray(response.content) ? response.content : []
  const normalized: Array<AssistantTextBlock | AssistantToolUseBlock> = []

  for (const block of content) {
    if (block.type === 'text') {
      normalized.push({
        type: 'text',
        text: typeof block.text === 'string' ? block.text : '',
      })
      continue
    }

    if (block.type === 'tool_use') {
      normalized.push({
        type: 'tool_use',
        id: String(block.id),
        name: String(block.name),
        input:
          block.input && typeof block.input === 'object'
            ? (block.input as Record<string, unknown>)
            : {},
      })
    }
  }

  return {
    type: 'assistant',
    id: String(response.id ?? createId('assistant')),
    content: normalized,
  }
}

export function createToolResultMessage(args: {
  toolUseId: string
  toolName: string
  content: string
  isError?: boolean
}): ToolResultMessage {
  return {
    type: 'tool_result',
    id: createId('tool_result'),
    toolUseId: args.toolUseId,
    toolName: args.toolName,
    content: args.content,
    isError: Boolean(args.isError),
  }
}

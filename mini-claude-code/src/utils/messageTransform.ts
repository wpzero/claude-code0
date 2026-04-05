import type {
  AnthropicMessageClient,
  AnthropicStreamEvent,
  AssistantMessage,
  AssistantTextBlock,
  AssistantToolUseBlock,
  ChatMessage,
  ToolResultMessage,
} from '../types.js'
import { debugLog } from '../debug.js'

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

type StreamAccumulator = {
  id: string
  content: Array<AssistantTextBlock | AssistantToolUseBlock>
  toolJsonBuffers: Record<number, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function createStreamAccumulator(id = createId('assistant')): StreamAccumulator {
  return {
    id,
    content: [],
    toolJsonBuffers: {},
  }
}

export function applyStreamEventToAccumulator(
  accumulator: StreamAccumulator,
  event: AnthropicStreamEvent,
): AssistantMessage {
  switch (event.type) {
    case 'message_start': {
      const message = isRecord(event.message) ? event.message : undefined
      if (typeof message?.id === 'string') {
        accumulator.id = message.id
      }
      debugLog('stream.message_start', {
        assistantId: accumulator.id,
      })
      break
    }
    case 'content_block_start': {
      const index =
        typeof event.index === 'number' ? event.index : accumulator.content.length
      const contentBlock = isRecord(event.content_block) ? event.content_block : {}

      if (contentBlock.type === 'text') {
        accumulator.content[index] = {
          type: 'text',
          text: typeof contentBlock.text === 'string' ? contentBlock.text : '',
        }
        debugLog('stream.content_block_start', {
          index,
          blockType: 'text',
        })
      }

      if (contentBlock.type === 'tool_use') {
        const initialInput = isRecord(contentBlock.input)
          ? contentBlock.input
          : {}
        const initialBuffer =
          Object.keys(initialInput).length > 0
            ? JSON.stringify(initialInput)
            : ''

        accumulator.content[index] = {
          type: 'tool_use',
          id:
            typeof contentBlock.id === 'string'
              ? contentBlock.id
              : createId('tool_use'),
          name:
            typeof contentBlock.name === 'string' ? contentBlock.name : 'unknown',
          input: initialInput,
        }
        accumulator.toolJsonBuffers[index] = initialBuffer
        debugLog('stream.content_block_start', {
          index,
          blockType: 'tool_use',
          toolId: accumulator.content[index]?.type === 'tool_use'
            ? accumulator.content[index].id
            : undefined,
          toolName: accumulator.content[index]?.type === 'tool_use'
            ? accumulator.content[index].name
            : undefined,
          initialInput:
            accumulator.content[index]?.type === 'tool_use'
              ? accumulator.content[index].input
              : undefined,
          initialBuffer,
        })
      }
      break
    }
    case 'content_block_delta': {
      const index = typeof event.index === 'number' ? event.index : -1
      if (index < 0) {
        break
      }
      const delta = isRecord(event.delta) ? event.delta : {}
      const block = accumulator.content[index]
      if (!block) {
        break
      }

      if (delta.type === 'text_delta' && block.type === 'text') {
        block.text += typeof delta.text === 'string' ? delta.text : ''
        debugLog('stream.text_delta', {
          index,
          deltaLength:
            typeof delta.text === 'string' ? delta.text.length : undefined,
          totalLength: block.text.length,
        })
      }

      if (delta.type === 'input_json_delta' && block.type === 'tool_use') {
        const existing = accumulator.toolJsonBuffers[index] || ''
        const next = existing + (typeof delta.partial_json === 'string' ? delta.partial_json : '')
        accumulator.toolJsonBuffers[index] = next
        const parsed = parseJsonObject(next)
        debugLog('stream.input_json_delta', {
          index,
          toolName: block.name,
          partialJson:
            typeof delta.partial_json === 'string' ? delta.partial_json : '',
          existingBuffer: existing,
          nextBuffer: next,
          parseSucceeded: Object.keys(parsed).length > 0,
          parsedInput: parsed,
        })
        if (Object.keys(parsed).length > 0) {
          block.input = parsed
        }
      }
      break
    }
    case 'content_block_stop': {
      const index = typeof event.index === 'number' ? event.index : -1
      const block = accumulator.content[index]
      if (index >= 0 && block?.type === 'tool_use') {
        const parsed = parseJsonObject(accumulator.toolJsonBuffers[index] || '')
        debugLog('stream.content_block_stop', {
          index,
          blockType: 'tool_use',
          toolName: block.name,
          finalBuffer: accumulator.toolJsonBuffers[index] || '',
          finalParsedInput: parsed,
        })
        if (Object.keys(parsed).length > 0) {
          block.input = parsed
        }
      } else if (index >= 0 && block?.type === 'text') {
        debugLog('stream.content_block_stop', {
          index,
          blockType: 'text',
          textLength: block.text.length,
        })
      }
      break
    }
    default:
      break
  }

  return {
    type: 'assistant',
    id: accumulator.id,
    content: accumulator.content.filter(Boolean),
  }
}

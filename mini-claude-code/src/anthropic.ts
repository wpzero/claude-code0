import Anthropic from '@anthropic-ai/sdk'
import type {
  AnthropicMessageClient,
  AnthropicStreamEvent,
  AssistantMessage,
  ToolDefinition,
} from './types.js'
import type { AppConfig } from './config.js'
import { debugLog } from './debug.js'
import {
  applyStreamEventToAccumulator,
  createStreamAccumulator,
} from './utils/messageTransform.js'

export const DEFAULT_SYSTEM_PROMPT = [
  'You are Mini Claude Code, a terminal coding assistant.',
  'Use tools when needed to inspect files, search content, write files, or run shell commands.',
  'Prefer read-only tools before write tools.',
  'Never reference tools that are not in the tools list.',
  'When a tool returns an error, adapt and continue if possible.',
  'User messages may include <system-reminder> tags injected by the system.',
  '<system-reminder> contains trusted system context such as available agent types and updates.',
].join(' ')

export function getAnthropicClientOptions(config: Pick<
  AppConfig,
  'apiKey' | 'authToken' | 'baseURL'
>): {
  apiKey?: string
  authToken?: string
  baseURL?: string
} {
  return {
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    ...(config.authToken ? { authToken: config.authToken } : {}),
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
  }
}

export function createAnthropicClient(
  config: Pick<AppConfig, 'apiKey' | 'authToken' | 'baseURL'>,
): AnthropicMessageClient {
  debugLog('anthropic.client', {
    baseURL: config.baseURL,
    hasApiKey: Boolean(config.apiKey),
    hasAuthToken: Boolean(config.authToken),
  })

  return new Anthropic(
    getAnthropicClientOptions(config),
  ) as unknown as AnthropicMessageClient
}

export function buildAnthropicRequest(args: {
  model: string
  messages: Array<Record<string, unknown>>
  tools: ToolDefinition[]
  systemPrompt?: string
  stream?: boolean
}): Record<string, unknown> {
  const request = {
    model: args.model,
    max_tokens: 2048,
    system: args.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    ...(args.stream ? { stream: true } : {}),
    messages: args.messages,
    tools: args.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.apiInputSchema,
    })),
  }

  debugLog('anthropic.request', {
    model: args.model,
    stream: Boolean(args.stream),
    messageCount: args.messages.length,
    messages: args.messages.map(message => ({
      role: message.role,
      content:
        typeof message.content === 'string'
          ? { type: 'text', preview: message.content.slice(0, 80) }
          : Array.isArray(message.content)
            ? message.content.map(block =>
                typeof block === 'object' && block && 'type' in block
                  ? {
                      type: (block as { type?: unknown }).type,
                      ...(typeof (block as { name?: unknown }).name === 'string'
                        ? { name: (block as { name: string }).name }
                        : {}),
                    }
                  : { type: 'unknown' },
              )
            : { type: 'unknown' },
    })),
    tools: args.tools.map(tool => tool.name),
  })

  return request
}

export async function streamAnthropicAssistantMessage(args: {
  client: AnthropicMessageClient
  model: string
  messages: Array<Record<string, unknown>>
  tools: ToolDefinition[]
  systemPrompt?: string
  onSnapshot?(message: AssistantMessage): void
}): Promise<AssistantMessage> {
  if (args.client.messages.stream) {
    debugLog('anthropic.stream.start', {
      mode: 'stream',
      model: args.model,
    })
    const accumulator = createStreamAccumulator()
    for await (const event of args.client.messages.stream(
      buildAnthropicRequest({
        model: args.model,
        messages: args.messages,
        tools: args.tools,
        systemPrompt: args.systemPrompt,
        stream: true,
      }),
    )) {
      const eventIndex = (event as Record<string, unknown>).index
      debugLog('anthropic.stream.event', {
        type: event.type,
        index: typeof eventIndex === 'number' ? eventIndex : undefined,
      })
      const snapshot = applyStreamEventToAccumulator(
        accumulator,
        event as AnthropicStreamEvent,
      )
      args.onSnapshot?.(snapshot)
    }
    debugLog('anthropic.stream.final', {
      assistantId: accumulator.id,
      content: accumulator.content.map(block =>
        block.type === 'text'
          ? { type: 'text', textLength: block.text.length }
          : { type: 'tool_use', name: block.name, input: block.input },
      ),
    })
    return {
      type: 'assistant',
      id: accumulator.id,
      content: accumulator.content.filter(Boolean),
    }
  }

  debugLog('anthropic.stream.start', {
    mode: 'create_fallback',
    model: args.model,
  })
  const response = await args.client.messages.create(
    buildAnthropicRequest({
      model: args.model,
      messages: args.messages,
      tools: args.tools,
      systemPrompt: args.systemPrompt,
    }),
  )

  const content: AssistantMessage['content'] = []
  for (const block of Array.isArray(response.content) ? response.content : []) {
    if (block.type === 'text') {
      content.push({
        type: 'text',
        text: String(block.text ?? ''),
      })
      continue
    }

    if (block.type === 'tool_use') {
      content.push({
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
    id: String(response.id ?? 'assistant'),
    content,
  }
}

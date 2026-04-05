import Anthropic from '@anthropic-ai/sdk'
import type {
  AnthropicMessageClient,
  AnthropicStreamEvent,
  AssistantMessage,
  ToolDefinition,
} from './types.js'
import type { AppConfig } from './config.js'
import {
  applyStreamEventToAccumulator,
  createStreamAccumulator,
} from './utils/messageTransform.js'

const SYSTEM_PROMPT = [
  'You are Mini Claude Code, a terminal coding assistant.',
  'Use tools when needed to inspect files, search content, write files, or run shell commands.',
  'Prefer read-only tools before write tools.',
  'Never reference tools that are not in the tools list.',
  'When a tool returns an error, adapt and continue if possible.',
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
  return new Anthropic(
    getAnthropicClientOptions(config),
  ) as unknown as AnthropicMessageClient
}

export function buildAnthropicRequest(args: {
  model: string
  messages: Array<Record<string, unknown>>
  tools: ToolDefinition[]
  stream?: boolean
}): Record<string, unknown> {
  return {
    model: args.model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    ...(args.stream ? { stream: true } : {}),
    messages: args.messages,
    tools: args.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.apiInputSchema,
    })),
  }
}

export async function streamAnthropicAssistantMessage(args: {
  client: AnthropicMessageClient
  model: string
  messages: Array<Record<string, unknown>>
  tools: ToolDefinition[]
  onSnapshot?(message: AssistantMessage): void
}): Promise<AssistantMessage> {
  if (args.client.messages.stream) {
    const accumulator = createStreamAccumulator()
    for await (const event of args.client.messages.stream(
      buildAnthropicRequest({
        model: args.model,
        messages: args.messages,
        tools: args.tools,
      }),
    )) {
      const snapshot = applyStreamEventToAccumulator(
        accumulator,
        event as AnthropicStreamEvent,
      )
      args.onSnapshot?.(snapshot)
    }
    return {
      type: 'assistant',
      id: accumulator.id,
      content: accumulator.content.filter(Boolean),
    }
  }

  const response = await args.client.messages.create(
    buildAnthropicRequest({
      model: args.model,
      messages: args.messages,
      tools: args.tools,
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

import Anthropic from '@anthropic-ai/sdk'
import type { AnthropicMessageClient, ToolDefinition } from './types.js'
import type { AppConfig } from './config.js'

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
}): Record<string, unknown> {
  return {
    model: args.model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: args.messages,
    tools: args.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.apiInputSchema,
    })),
  }
}

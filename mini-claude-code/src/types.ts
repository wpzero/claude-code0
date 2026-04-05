import type { z } from 'zod'

export type UserMessage = {
  type: 'user'
  id: string
  text: string
}

export type AssistantTextBlock = {
  type: 'text'
  text: string
}

export type AssistantToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type AssistantMessage = {
  type: 'assistant'
  id: string
  content: Array<AssistantTextBlock | AssistantToolUseBlock>
}

export type ToolResultMessage = {
  type: 'tool_result'
  id: string
  toolUseId: string
  toolName: string
  isError: boolean
  content: string
}

export type SystemMessageLevel = 'info' | 'error' | 'tool_progress'

export type SystemMessage = {
  type: 'system'
  id: string
  level: SystemMessageLevel
  text: string
}

export type ChatMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | SystemMessage

export type ToolExecutionResult = {
  content: string
  isError?: boolean
}

export type ToolApprovalRequirement = 'never' | 'always'

export type ToolContext = {
  workdir: string
}

export type ToolDefinition = {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  apiInputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
  requiresApproval: ToolApprovalRequirement
  isReadOnly: boolean
  isConcurrencySafe: boolean
  execute(
    input: unknown,
    context: ToolContext,
  ): Promise<ToolExecutionResult>
}

export type ToolCallRequest = AssistantToolUseBlock

export type ToolApprovalRequest = {
  toolCall: ToolCallRequest
  tool: Pick<
    ToolDefinition,
    'name' | 'description' | 'requiresApproval' | 'isReadOnly'
  >
}

export type ToolApprovalDecision = 'approved' | 'rejected'

export type QueryLoopEvent =
  | { type: 'assistant_stream'; message: AssistantMessage }
  | { type: 'assistant'; message: AssistantMessage }
  | { type: 'tool_result'; message: ToolResultMessage }
  | { type: 'tool_approval_requested'; request: ToolApprovalRequest }
  | { type: 'system'; message: SystemMessage }

export type AnthropicStreamEvent = {
  type: string
  [key: string]: unknown
}

export type AnthropicMessageClient = {
  messages: {
    create(input: Record<string, unknown>): Promise<{
      id?: string
      content?: Array<Record<string, unknown>>
    }>
    stream?(input: Record<string, unknown>): AsyncIterable<AnthropicStreamEvent>
  }
}

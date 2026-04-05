import { z } from 'zod'
import {
  createToolResultMessage,
  createId,
} from './utils/messageTransform.js'
import type {
  QueryLoopEvent,
  ToolCallRequest,
  ToolContext,
  ToolDefinition,
  ToolResultMessage,
} from './types.js'

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`)
    .join('\n')
}

export async function executeToolCall(args: {
  request: ToolCallRequest
  tools: ToolDefinition[]
  context: ToolContext
  onEvent?: (event: QueryLoopEvent) => void
}): Promise<ToolResultMessage> {
  const tool = args.tools.find(candidate => candidate.name === args.request.name)
  if (!tool) {
    return createToolResultMessage({
      toolUseId: args.request.id,
      toolName: args.request.name,
      content: `Unknown tool: ${args.request.name}`,
      isError: true,
    })
  }

  args.onEvent?.({
    type: 'system',
    message: {
      type: 'system',
      id: createId('system'),
      level: 'tool_progress',
      text: `Running ${tool.name}...`,
    },
  })

  const parsed = tool.inputSchema.safeParse(args.request.input)
  if (!parsed.success) {
    return createToolResultMessage({
      toolUseId: args.request.id,
      toolName: args.request.name,
      content: formatZodError(parsed.error),
      isError: true,
    })
  }

  try {
    const result = await tool.execute(parsed.data, args.context)
    return createToolResultMessage({
      toolUseId: args.request.id,
      toolName: args.request.name,
      content: result.content,
      isError: result.isError,
    })
  } catch (error) {
    return createToolResultMessage({
      toolUseId: args.request.id,
      toolName: args.request.name,
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    })
  }
}

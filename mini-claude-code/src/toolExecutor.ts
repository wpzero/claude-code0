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
import { debugLog } from './debug.js'

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
  debugLog('tool.execute.start', {
    toolName: args.request.name,
    rawInput: args.request.input,
  })

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
    debugLog('tool.execute.validation_error', {
      toolName: args.request.name,
      rawInput: args.request.input,
      error: formatZodError(parsed.error),
    })
    return createToolResultMessage({
      toolUseId: args.request.id,
      toolName: args.request.name,
      content: formatZodError(parsed.error),
      isError: true,
    })
  }

  try {
    const result = await tool.execute(parsed.data, args.context)
    debugLog('tool.execute.success', {
      toolName: args.request.name,
      parsedInput: parsed.data,
      isError: Boolean(result.isError),
      contentLength: result.content.length,
    })
    return createToolResultMessage({
      toolUseId: args.request.id,
      toolName: args.request.name,
      content: result.content,
      isError: result.isError,
    })
  } catch (error) {
    debugLog('tool.execute.exception', {
      toolName: args.request.name,
      parsedInput: parsed.data,
      error: error instanceof Error ? error.message : String(error),
    })
    return createToolResultMessage({
      toolUseId: args.request.id,
      toolName: args.request.name,
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    })
  }
}

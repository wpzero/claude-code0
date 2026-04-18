import { streamAnthropicAssistantMessage } from './anthropic.js'
import { createAgentListingInjection } from './agents.js'
import { resolveAgentModel } from './agentModels.js'
import {
  createEmptyTodoState,
  createMainTodoOwner,
  createSubagentTodoOwner,
  createTodoReminderInjection,
  TODO_WRITE_TOOL_NAME,
  setOwnerTodos,
} from './todos.js'
import { executeToolCall } from './toolExecutor.js'
import {
  createId,
  createToolResultMessage,
  toAnthropicMessages,
} from './utils/messageTransform.js'
import type {
  AgentCatalogState,
  AgentDefinition,
  AnthropicMessageClient,
  ChatMessage,
  SubagentLifecycleEvent,
  SubagentRequest,
  ToolApprovalDecision,
  ToolApprovalRequest,
  QueryLoopEvent,
  TodoOwner,
  TodoState,
  ToolDefinition,
} from './types.js'
import { debugLog } from './debug.js'

const SUBAGENT_SYSTEM_PROMPT = [
  'You are Mini Claude Code Worker, a focused subagent.',
  'Complete only the assigned task and return a concise final answer.',
  'Use the provided tools directly when needed.',
  'Do not ask follow-up questions.',
  'Do not call spawn_agent.',
].join(' ')

function extractFinalAssistantText(history: ChatMessage[]): string {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    if (message?.type !== 'assistant') {
      continue
    }

    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text.trim())
      .filter(Boolean)
      .join('\n')

    if (text) {
      return text
    }
  }

  return ''
}

function summarizePrompt(text: string, maxLength = 80): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, maxLength - 3)}...`
}

function emitSubagentLifecycle(
  onEvent: ((event: QueryLoopEvent) => void) | undefined,
  event: SubagentLifecycleEvent,
): void {
  onEvent?.({ type: 'subagent_lifecycle', event })
  onEvent?.({
    type: 'system',
    message: {
      type: 'system',
      id: createId('system'),
      level: 'info',
      text: `[subagent] ${event.status}: ${event.summary}`,
    },
  })
}

export async function runQueryLoop(params: {
  client: AnthropicMessageClient
  model: string
  history: ChatMessage[]
  tools: ToolDefinition[]
  agents?: AgentDefinition[]
  agentCatalogState?: AgentCatalogState
  todoState?: TodoState
  todoOwner?: TodoOwner
  maxIterations: number
  workdir: string
  systemPrompt?: string
  onEvent?: (event: QueryLoopEvent) => void
  requestToolApproval?: (
    request: ToolApprovalRequest,
  ) => Promise<ToolApprovalDecision>
}): Promise<{
  history: ChatMessage[]
  agentCatalogState: AgentCatalogState
  todoState: TodoState
  stopReason: 'completed' | 'max_iterations' | 'error'
}> {
  let history = [...params.history]
  let agentCatalogState: AgentCatalogState = params.agentCatalogState ?? {
    entriesByType: {},
  }
  let todoState = params.todoState ?? createEmptyTodoState()
  const agents = params.agents ?? []
  const todoOwner = params.todoOwner ?? createMainTodoOwner()

  for (let iteration = 0; iteration < params.maxIterations; iteration += 1) {
    try {
      const agentInjection = createAgentListingInjection({
        history,
        agents,
        availableToolNames: params.tools.map(tool => tool.name),
        catalogState: agentCatalogState,
      })
      agentCatalogState = agentInjection.catalogState
      const todoInjection = createTodoReminderInjection({
        history: agentInjection.injectedHistory,
        todoState,
        todoOwner,
      })
      const apiMessages = toAnthropicMessages(todoInjection.injectedHistory)
      debugLog('query.iteration.start', {
        iteration: iteration + 1,
        historyCount: history.length,
        apiMessageCount: apiMessages.length,
        injectedAgentListing: agentInjection.injected,
        injectedTodoReminder: todoInjection.injected,
      })

      const assistantMessage = await streamAnthropicAssistantMessage({
        client: params.client,
        model: params.model,
        messages: apiMessages,
        tools: params.tools,
        systemPrompt: params.systemPrompt,
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
        return { history, agentCatalogState, todoState, stopReason: 'completed' }
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
          context: {
            workdir: params.workdir,
            client: params.client,
            model: params.model,
            maxIterations: params.maxIterations,
            agents,
            todoState,
            todoOwner,
            setTodos: todos => {
              todoState = setOwnerTodos(todoState, todoOwner, todos)
            },
            runSubagent: async (request: SubagentRequest) => {
              const promptSummary = summarizePrompt(request.prompt)
              emitSubagentLifecycle(params.onEvent, {
                type: 'subagent_lifecycle',
                status: 'started',
                summary: promptSummary,
              })

              const selectedAgent = request.agentType
                ? agents.find(agent => agent.agentType === request.agentType)
                : undefined

              if (request.agentType && !selectedAgent) {
                throw new Error(
                  `Unknown agent_type: ${request.agentType}. Available agents: ${agents.map(agent => agent.agentType).join(', ') || 'none'}`,
                )
              }

              const baseChildTools = params.tools.filter(tool => {
                if (tool.name === 'spawn_agent') {
                  return false
                }
                if (tool.name === TODO_WRITE_TOOL_NAME) {
                  return true
                }
                if (!selectedAgent?.tools?.length) {
                  return true
                }
                return selectedAgent.tools.includes(tool.name)
              })

              const filteredChildTools =
                request.allowedTools && request.allowedTools.length > 0
                  ? baseChildTools.filter(tool =>
                      request.allowedTools?.includes(tool.name),
                    )
                  : baseChildTools

              if (filteredChildTools.length === 0) {
                emitSubagentLifecycle(params.onEvent, {
                  type: 'subagent_lifecycle',
                  status: 'finished',
                  summary: 'failed: no available tools',
                })
                if (request.agentType && request.allowedTools?.length) {
                  throw new Error(
                    `Requested allowed_tools excludes all tools available to agent_type ${request.agentType}.`,
                  )
                }
                throw new Error('Subagent has no available tools.')
              }

              params.onEvent?.({
                type: 'system',
                message: {
                  type: 'system',
                  id: createId('system'),
                  level: 'info',
                  text: `[subagent] tools: ${filteredChildTools.map(tool => tool.name).join(', ')}`,
                },
              })

              const childTodoOwner = createSubagentTodoOwner(request.agentType)
              const childResult = await runQueryLoop({
                client: params.client,
                model: resolveAgentModel(selectedAgent?.model, params.model),
                history: [
                  {
                    type: 'user',
                    id: createId('user'),
                    text: request.prompt,
                  },
                ],
                tools: filteredChildTools,
                agents: [],
                todoState,
                todoOwner: childTodoOwner,
                maxIterations: Math.min(params.maxIterations, 6),
                workdir: params.workdir,
                systemPrompt: selectedAgent?.prompt ?? SUBAGENT_SYSTEM_PROMPT,
                requestToolApproval: params.requestToolApproval,
                onEvent: childEvent => {
                  if (
                    childEvent.type === 'system' &&
                    childEvent.message.level === 'tool_progress'
                  ) {
                    params.onEvent?.({
                      type: 'system',
                      message: {
                        type: 'system',
                        id: createId('system'),
                        level: 'info',
                        text: `[subagent] ${childEvent.message.text}`,
                      },
                    })
                    return
                  }

                  if (childEvent.type === 'tool_result') {
                    params.onEvent?.({
                      type: 'system',
                      message: {
                        type: 'system',
                        id: createId('system'),
                        level: childEvent.message.isError ? 'error' : 'info',
                        text: `[subagent] ${childEvent.message.toolName}${childEvent.message.isError ? ' failed' : ' finished'}`,
                      },
                    })
                  }
                },
              })
              todoState = childResult.todoState

              const finalText = extractFinalAssistantText(childResult.history)
              emitSubagentLifecycle(params.onEvent, {
                type: 'subagent_lifecycle',
                status: 'finished',
                summary: finalText
                  ? summarizePrompt(finalText)
                  : `stopReason=${childResult.stopReason}`,
              })
              if (finalText) {
                return finalText
              }

              return `Subagent stopped with reason: ${childResult.stopReason}`
            },
          },
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
      return { history, agentCatalogState, todoState, stopReason: 'error' }
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
  return { history, agentCatalogState, todoState, stopReason: 'max_iterations' }
}

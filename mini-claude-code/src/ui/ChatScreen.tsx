import React from 'react'
import { Box, Text } from 'ink'
import { runQueryLoop } from '../queryLoop.js'
import { getTools } from '../toolRegistry.js'
import type {
  AgentCatalogState,
  AgentDefinition,
  AnthropicMessageClient,
  ChatMessage,
  QueryLoopEvent,
  ToolApprovalDecision,
  ToolApprovalRequest,
} from '../types.js'
import { createId } from '../utils/messageTransform.js'
import { ApprovalPrompt } from './ApprovalPrompt.js'
import { MessageList } from './MessageList.js'
import { PromptInput } from './PromptInput.js'
import { StatusBar } from './StatusBar.js'

export function ChatScreen(props: {
  client: AnthropicMessageClient
  model: string
  maxIterations: number
  workdir: string
  agents: AgentDefinition[]
}) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      type: 'system',
      id: createId('system'),
      level: 'info',
      text: 'Mini Claude Code ready. Enter a prompt to start.',
    },
  ])
  const [streamingAssistant, setStreamingAssistant] =
    React.useState<ChatMessage | null>(null)
  const [isBusy, setIsBusy] = React.useState(false)
  const [pendingApproval, setPendingApproval] =
    React.useState<ToolApprovalRequest | null>(null)
  const [agentCatalogState, setAgentCatalogState] =
    React.useState<AgentCatalogState>({
      entriesByType: {},
    })
  const tools = React.useMemo(() => getTools(), [])
  const approvalResolverRef = React.useRef<
    ((decision: ToolApprovalDecision) => void) | null
  >(null)

  const appendEvent = React.useCallback((event: QueryLoopEvent) => {
    if (event.type === 'assistant_stream') {
      setStreamingAssistant(event.message)
      return
    }

    if (event.type === 'assistant') {
      setStreamingAssistant(null)
      setMessages(current => [...current, event.message])
      return
    }

    if (event.type === 'tool_result') {
      setStreamingAssistant(null)
      setMessages(current => [...current, event.message])
      return
    }

    if (event.type === 'tool_approval_requested') {
      return
    }

    if (event.type === 'subagent_lifecycle') {
      return
    }

    setStreamingAssistant(null)
    setMessages(current => [...current, event.message])
  }, [])

  const handleApprovalDecision = React.useCallback(
    (decision: ToolApprovalDecision) => {
      const resolve = approvalResolverRef.current
      approvalResolverRef.current = null
      setPendingApproval(null)
      resolve?.(decision)
    },
    [],
  )

  const requestToolApproval = React.useCallback(
    (request: ToolApprovalRequest) =>
      new Promise<ToolApprovalDecision>(resolve => {
        approvalResolverRef.current = resolve
        setPendingApproval(request)
      }),
    [],
  )

  const handleSubmit = React.useCallback(
    async (text: string) => {
      if (isBusy || pendingApproval) {
        return
      }

      setIsBusy(true)
      const userMessage: ChatMessage = {
        type: 'user',
        id: createId('user'),
        text,
      }

      const nextHistory = [...messages, userMessage]
      setStreamingAssistant(null)
      setMessages(nextHistory)

      try {
        const result = await runQueryLoop({
          client: props.client,
          model: props.model,
          history: nextHistory,
          tools,
          agents: props.agents,
          agentCatalogState,
          maxIterations: props.maxIterations,
          workdir: props.workdir,
          onEvent: appendEvent,
          requestToolApproval,
        })

        setMessages(result.history)
        setAgentCatalogState(result.agentCatalogState)
      } finally {
        approvalResolverRef.current = null
        setPendingApproval(null)
        setIsBusy(false)
      }
    },
    [
      appendEvent,
      isBusy,
      messages,
      pendingApproval,
      agentCatalogState,
      props.agents,
      props.client,
      props.maxIterations,
      props.model,
      props.workdir,
      requestToolApproval,
      tools,
    ],
  )

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="green">
        Mini Claude Code
      </Text>
      <StatusBar
        model={props.model}
        workdir={props.workdir}
        isBusy={isBusy}
        isAwaitingApproval={Boolean(pendingApproval)}
      />
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <MessageList
          messages={
            streamingAssistant ? [...messages, streamingAssistant] : messages
          }
        />
      </Box>
      {pendingApproval ? (
        <ApprovalPrompt
          request={pendingApproval}
          onDecision={handleApprovalDecision}
        />
      ) : (
        <PromptInput disabled={isBusy} onSubmit={handleSubmit} />
      )}
      <Text color="gray">
        {pendingApproval
          ? 'Approval mode active. Ctrl+C to exit.'
          : 'Enter to send. Ctrl+C to exit.'}
      </Text>
    </Box>
  )
}

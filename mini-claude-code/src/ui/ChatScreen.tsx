import React from 'react'
import { Box, Text } from 'ink'
import { runQueryLoop } from '../queryLoop.js'
import { getTools } from '../toolRegistry.js'
import type {
  AnthropicMessageClient,
  ChatMessage,
  QueryLoopEvent,
} from '../types.js'
import { createId } from '../utils/messageTransform.js'
import { MessageList } from './MessageList.js'
import { PromptInput } from './PromptInput.js'
import { StatusBar } from './StatusBar.js'

export function ChatScreen(props: {
  client: AnthropicMessageClient
  model: string
  maxIterations: number
  workdir: string
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
  const tools = React.useMemo(() => getTools(), [])

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

    setStreamingAssistant(null)
    setMessages(current => [...current, event.message])
  }, [])

  const handleSubmit = React.useCallback(
    async (text: string) => {
      if (isBusy) {
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
          maxIterations: props.maxIterations,
          workdir: props.workdir,
          onEvent: appendEvent,
        })

        setMessages(result.history)
      } finally {
        setIsBusy(false)
      }
    },
    [
      appendEvent,
      isBusy,
      messages,
      props.client,
      props.maxIterations,
      props.model,
      props.workdir,
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
      />
      <Box marginTop={1} marginBottom={1} flexDirection="column">
        <MessageList
          messages={
            streamingAssistant ? [...messages, streamingAssistant] : messages
          }
        />
      </Box>
      <PromptInput disabled={isBusy} onSubmit={handleSubmit} />
      <Text color="gray">Enter to send. Ctrl+C to exit.</Text>
    </Box>
  )
}

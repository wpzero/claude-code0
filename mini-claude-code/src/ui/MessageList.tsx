import React from 'react'
import { Box, Text } from 'ink'
import type { ChatMessage } from '../types.js'

function stringifyInput(input: Record<string, unknown>): string {
  return JSON.stringify(input)
}

function truncate(text: string, limit = 800): string {
  if (text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit)}\n...<truncated>`
}

export function MessageList(props: { messages: ChatMessage[] }) {
  return (
    <Box flexDirection="column">
      {props.messages.map(message => {
        if (message.type === 'user') {
          return (
            <Text key={message.id} color="cyan">
              {'>'} {message.text}
            </Text>
          )
        }

        if (message.type === 'assistant') {
          return (
            <Box key={message.id} flexDirection="column" marginBottom={1}>
              {message.content.map((block, index) => {
                if (block.type === 'text') {
                  return (
                    <Text key={`${message.id}-${index}`} color="green">
                      {block.text}
                    </Text>
                  )
                }

                return (
                  <Text key={`${message.id}-${index}`} color="yellow">
                    [tool] {block.name}({stringifyInput(block.input)})
                  </Text>
                )
              })}
            </Box>
          )
        }

        if (message.type === 'tool_result') {
          return (
            <Box key={message.id} flexDirection="column" marginBottom={1}>
              <Text color={message.isError ? 'red' : 'magenta'}>
                [tool_result] {message.toolName}
                {message.isError ? ' (error)' : ''}
              </Text>
              <Text>{truncate(message.content)}</Text>
            </Box>
          )
        }

        return (
          <Text
            key={message.id}
            color={message.level === 'error' ? 'red' : 'gray'}
          >
            [{message.level}] {message.text}
          </Text>
        )
      })}
    </Box>
  )
}

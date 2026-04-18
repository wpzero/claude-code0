import React from 'react'
import { Box, Text, useInput } from 'ink'
import type { ToolApprovalDecision, ToolApprovalRequest } from '../types.js'

function stringifyInput(input: Record<string, unknown>): string {
  return JSON.stringify(input, null, 2)
}

export function ApprovalPrompt(props: {
  request: ToolApprovalRequest
  onDecision(decision: ToolApprovalDecision): void
}) {
  useInput((input, key) => {
    if (key.return) {
      props.onDecision('approved')
      return
    }

    if (key.escape) {
      props.onDecision('rejected')
      return
    }

    if (input.toLowerCase() === 'y') {
      props.onDecision('approved')
      return
    }

    if (input.toLowerCase() === 'n') {
      props.onDecision('rejected')
    }
  })

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginTop={1}
    >
      <Text color="yellow">Approval required</Text>
      <Text>
        {props.request.tool.name}: {props.request.tool.description}
      </Text>
      <Text>input:</Text>
      <Text>{stringifyInput(props.request.toolCall.input)}</Text>
      <Text color="gray">Press Enter or y to allow. Press Esc or n to reject.</Text>
    </Box>
  )
}

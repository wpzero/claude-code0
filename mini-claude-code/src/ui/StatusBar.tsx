import React from 'react'
import { Box, Text } from 'ink'

export function StatusBar(props: {
  model: string
  workdir: string
  isBusy: boolean
  isAwaitingApproval: boolean
}) {
  const statusText = props.isAwaitingApproval
    ? 'awaiting approval'
    : props.isBusy
      ? 'busy'
      : 'idle'

  const statusColor = props.isAwaitingApproval || props.isBusy ? 'yellow' : 'green'

  return (
    <Box justifyContent="space-between">
      <Text color="blue">model: {props.model}</Text>
      <Text color="blue">workdir: {props.workdir}</Text>
      <Text color={statusColor}>{statusText}</Text>
    </Box>
  )
}

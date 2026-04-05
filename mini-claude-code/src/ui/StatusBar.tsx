import React from 'react'
import { Box, Text } from 'ink'

export function StatusBar(props: {
  model: string
  workdir: string
  isBusy: boolean
}) {
  return (
    <Box justifyContent="space-between">
      <Text color="blue">model: {props.model}</Text>
      <Text color="blue">workdir: {props.workdir}</Text>
      <Text color={props.isBusy ? 'yellow' : 'green'}>
        {props.isBusy ? 'busy' : 'idle'}
      </Text>
    </Box>
  )
}

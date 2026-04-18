import React from 'react'
import { Box, Text, useInput } from 'ink'

export function PromptInput(props: {
  disabled?: boolean
  onSubmit(text: string): void
}) {
  const [value, setValue] = React.useState('')

  useInput((input, key) => {
    if (props.disabled) {
      return
    }

    if (key.return) {
      const next = value.trim()
      if (next) {
        props.onSubmit(next)
        setValue('')
      }
      return
    }

    if (key.backspace || key.delete) {
      setValue(current => current.slice(0, -1))
      return
    }

    if (key.ctrl || key.meta || key.tab || key.escape) {
      return
    }

    if (input) {
      setValue(current => current + input)
    }
  })

  return (
    <Box borderStyle="round" paddingX={1}>
      <Text color={props.disabled ? 'gray' : 'white'}>
        {props.disabled ? 'Working...' : `Prompt: ${value || ' '}`}
      </Text>
    </Box>
  )
}

import React from 'react'
import { Box, Text } from 'ink'
import { sortTodoOwners, summarizeTodoStatus } from '../todos.js'
import type { TodoState, TodoStatus } from '../types.js'

function getTodoColor(status: TodoStatus): 'green' | 'yellow' | 'gray' {
  switch (status) {
    case 'completed':
      return 'green'
    case 'in_progress':
      return 'yellow'
    default:
      return 'gray'
  }
}

export function TodoPanel(props: { todoState: TodoState }) {
  const owners = sortTodoOwners(props.todoState)
  if (owners.length === 0) {
    return null
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Text bold color="cyan">
        Todos
      </Text>
      {owners.map(([ownerId, owner]) => (
        <Box key={ownerId} flexDirection="column" marginTop={1}>
          <Text bold>{owner.title}</Text>
          {owner.todos.map((todo, index) => (
            <Text key={`${ownerId}-${index}`} color={getTodoColor(todo.status)}>
              [{todo.status}] {summarizeTodoStatus(todo)}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

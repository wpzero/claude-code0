import { createId } from './utils/messageTransform.js'
import type { ChatMessage, TodoItem, TodoList, TodoOwner, TodoState } from './types.js'

export const TODO_WRITE_TOOL_NAME = 'todo_write'
const TODO_REMINDER_THRESHOLD = 3

export function createEmptyTodoState(): TodoState {
  return { byOwner: {} }
}

export function createMainTodoOwner(): TodoOwner {
  return { id: 'main', title: 'Main session' }
}

export function createSubagentTodoOwner(agentType?: string): TodoOwner {
  const label = agentType ?? 'worker'
  return {
    id: `subagent:${label}:${createId('todo_owner')}`,
    title: `Subagent: ${label}`,
  }
}

export function hasOpenTodos(todos: TodoList | undefined): boolean {
  return Boolean(todos?.some(todo => todo.status !== 'completed'))
}

export function setOwnerTodos(
  state: TodoState,
  owner: TodoOwner,
  todos: TodoList,
): TodoState {
  const nextOwnerState = { title: owner.title, todos }
  if (todos.length === 0) {
    const { [owner.id]: _, ...rest } = state.byOwner
    return { byOwner: rest }
  }

  return {
    byOwner: {
      ...state.byOwner,
      [owner.id]: nextOwnerState,
    },
  }
}

function countAssistantTurnsSinceLastTodoWrite(history: ChatMessage[]): number {
  let count = 0

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]
    if (message?.type !== 'assistant') {
      continue
    }

    const usedTodoWrite = message.content.some(
      block => block.type === 'tool_use' && block.name === TODO_WRITE_TOOL_NAME,
    )
    if (usedTodoWrite) {
      return count
    }

    count += 1
  }

  return count
}

export function createTodoReminderInjection(args: {
  history: ChatMessage[]
  todoState: TodoState
  todoOwner: TodoOwner
}): {
  injectedHistory: ChatMessage[]
  injected: boolean
} {
  const todos = args.todoState.byOwner[args.todoOwner.id]?.todos
  if (!hasOpenTodos(todos)) {
    return {
      injectedHistory: args.history,
      injected: false,
    }
  }

  const turnsSinceLastTodoWrite = countAssistantTurnsSinceLastTodoWrite(
    args.history,
  )

  if (turnsSinceLastTodoWrite !== TODO_REMINDER_THRESHOLD) {
    return {
      injectedHistory: args.history,
      injected: false,
    }
  }

  const reminder: ChatMessage = {
    type: 'user',
    id: createId('user'),
    text: [
      '<system-reminder>',
      `You have active todos for ${args.todoOwner.title}. If progress has changed, update the todo list with ${TODO_WRITE_TOOL_NAME}.`,
      '</system-reminder>',
    ].join('\n'),
    isInjected: true,
  }

  return {
    injectedHistory: [reminder, ...args.history],
    injected: true,
  }
}

export function sortTodoOwners(
  todoState: TodoState,
): Array<[string, { title: string; todos: TodoList }]> {
  return Object.entries(todoState.byOwner).sort((left, right) => {
    if (left[0] === 'main') {
      return -1
    }
    if (right[0] === 'main') {
      return 1
    }
    return left[1].title.localeCompare(right[1].title)
  })
}

export function summarizeTodoStatus(todo: TodoItem): string {
  return todo.status === 'in_progress' ? todo.activeForm : todo.content
}

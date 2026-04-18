import { z } from 'zod'
import { TODO_WRITE_TOOL_NAME } from '../todos.js'
import type { TodoList, ToolDefinition } from '../types.js'

const todoStatusSchema = z.enum(['pending', 'in_progress', 'completed'])

const todoItemSchema = z.object({
  content: z.string().min(1),
  activeForm: z.string().min(1),
  status: todoStatusSchema,
})

const schema = z.object({
  todos: z.array(todoItemSchema).min(1),
})

const TODO_WRITE_DESCRIPTION = [
  'Use this tool to maintain a structured todo list for the current task.',
  '',
  'Use it when:',
  '- the task has multiple meaningful steps',
  '- the user gave several requirements',
  '- you need to track progress across file reads, edits, tests, or subagent work',
  '- the work is complex enough that keeping a checklist will reduce mistakes',
  '',
  'Do not use it when:',
  '- the task is trivial or single-step',
  '- the user is only asking a simple question',
  '- there is no meaningful progress to track',
  '',
  'Rules:',
  '- Provide the full updated todo list each time',
  '- Each todo item must include content, activeForm, and status',
  '- content should be imperative, for example "Run tests"',
  '- activeForm should be present continuous, for example "Running tests"',
  '- Keep at most one item in_progress at a time',
  '- If any work remains, exactly one item should be in_progress',
  '- Mark items completed immediately after finishing them',
  '- Remove items that are no longer relevant',
  '- Make todo items concrete and actionable',
  '',
  'When in doubt, use this tool for complex multi-step work.',
].join('\n')

function validateTodos(todos: TodoList): void {
  const inProgressCount = todos.filter(todo => todo.status === 'in_progress').length
  if (inProgressCount > 1) {
    throw new Error('Todo list can have at most one in_progress item.')
  }

  const hasOpenTodos = todos.some(todo => todo.status !== 'completed')
  if (hasOpenTodos && inProgressCount !== 1) {
    throw new Error(
      'Todo list must have exactly one in_progress item while work remains.',
    )
  }
}

export const todoWriteTool: ToolDefinition = {
  name: TODO_WRITE_TOOL_NAME,
  description: TODO_WRITE_DESCRIPTION,
  inputSchema: schema,
  apiInputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        description:
          'The full updated todo list for the current owner. Provide the entire list each time, with concrete items and exactly one in_progress item while work remains.',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Imperative task text, for example "Run tests".',
            },
            activeForm: {
              type: 'string',
              description:
                'Present continuous form, for example "Running tests".',
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Current task status.',
            },
          },
          required: ['content', 'activeForm', 'status'],
          additionalProperties: false,
        },
      },
    },
    required: ['todos'],
    additionalProperties: false,
  },
  requiresApproval: 'never',
  isReadOnly: false,
  isConcurrencySafe: false,
  async execute(input, context) {
    const { todos } = schema.parse(input)
    validateTodos(todos)

    const allCompleted = todos.every(todo => todo.status === 'completed')
    context.setTodos(allCompleted ? [] : todos)

    return {
      content: allCompleted
        ? `Cleared todo list for ${context.todoOwner.title}.`
        : `Updated todo list for ${context.todoOwner.title}.`,
    }
  },
}

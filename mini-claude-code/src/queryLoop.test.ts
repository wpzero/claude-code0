import { describe, expect, test } from 'bun:test'
import { runQueryLoop } from './queryLoop.js'
import {
  createId,
  toAnthropicMessages,
} from './utils/messageTransform.js'
import { getTools } from './toolRegistry.js'
import type {
  AnthropicMessageClient,
  AssistantMessage,
  ChatMessage,
} from './types.js'

describe('messageTransform', () => {
  test('serializes assistant tool use and tool result messages', () => {
    const history: ChatMessage[] = [
      { type: 'user', id: createId('user'), text: 'read file' },
      {
        type: 'assistant',
        id: createId('assistant'),
        content: [
          { type: 'text', text: 'Checking.' },
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'read_file',
            input: { path: 'README.md' },
          },
        ],
      },
      {
        type: 'tool_result',
        id: createId('tool_result'),
        toolUseId: 'tool_1',
        toolName: 'read_file',
        content: 'file content',
        isError: false,
      },
    ]

    const serialized = toAnthropicMessages(history)
    expect(serialized).toHaveLength(3)
    expect(serialized[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking.' },
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'read_file',
          input: { path: 'README.md' },
        },
      ],
    })
    expect(serialized[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool_1',
          is_error: false,
          content: 'file content',
        },
      ],
    })
  })
})

describe('runQueryLoop', () => {
  test('completes after a tool call and follow-up response', async () => {
    const responses = [
      {
        id: 'assistant_1',
        content: [
          { type: 'text', text: 'I will inspect it.' },
          {
            type: 'tool_use',
            id: 'tool_1',
            name: 'list_files',
            input: { path: '.', recursive: false },
          },
        ],
      },
      {
        id: 'assistant_2',
        content: [{ type: 'text', text: 'Done.' }],
      },
    ]

    const client: AnthropicMessageClient = {
      messages: {
        async create() {
          return responses.shift() as never
        },
      },
    }

    const history: ChatMessage[] = [
      { type: 'user', id: createId('user'), text: 'list files' },
    ]

    const result = await runQueryLoop({
      client,
      model: 'test-model',
      history,
      tools: getTools(),
      maxIterations: 4,
      workdir: process.cwd(),
    })

    expect(result.stopReason).toBe('completed')
    expect(
      result.history.some(
        message =>
          message.type === 'tool_result' && message.toolUseId === 'tool_1',
      ),
    ).toBe(true)
    expect(
      result.history.filter(message => message.type === 'assistant').length,
    ).toBe(2)
  })

  test('stops on iteration limit', async () => {
    const loopingAssistant: AssistantMessage = {
      type: 'assistant',
      id: 'assistant_loop',
      content: [
        {
          type: 'tool_use',
          id: 'tool_loop',
          name: 'list_files',
          input: { path: '.', recursive: false },
        },
      ],
    }

    const client: AnthropicMessageClient = {
      messages: {
        async create() {
          return {
            id: loopingAssistant.id,
            content: loopingAssistant.content,
          } as never
        },
      },
    }

    const result = await runQueryLoop({
      client,
      model: 'test-model',
      history: [{ type: 'user', id: createId('user'), text: 'loop' }],
      tools: getTools(),
      maxIterations: 1,
      workdir: process.cwd(),
    })

    expect(result.stopReason).toBe('max_iterations')
  })
})

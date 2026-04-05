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
  ToolApprovalRequest,
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
    const streams = [
      [
        {
          type: 'message_start',
          message: { id: 'assistant_1', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'I will inspect it.' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            id: 'tool_1',
            name: 'list_files',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"path":".","recursive":false}',
          },
        },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_stop' },
      ],
      [
        {
          type: 'message_start',
          message: { id: 'assistant_2', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Done.' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
    ]
    const events: string[] = []

    const client: AnthropicMessageClient = {
      messages: {
        async create() {
          throw new Error('unexpected create call')
        },
        async *stream() {
          const next = streams.shift() || []
          for (const event of next) {
            yield event as never
          }
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
      onEvent: event => {
        events.push(event.type)
      },
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
    expect(events).toContain('assistant_stream')
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
          throw new Error('unexpected create call')
        },
        async *stream() {
          yield {
            type: 'message_start',
            message: { id: loopingAssistant.id, content: [] },
          } as never
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'tool_loop',
              name: 'list_files',
              input: {},
            },
          } as never
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'input_json_delta',
              partial_json: '{"path":".","recursive":false}',
            },
          } as never
          yield { type: 'content_block_stop', index: 0 } as never
          yield { type: 'message_stop' } as never
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

  test('requests approval before executing write tools', async () => {
    const approvals: ToolApprovalRequest[] = []
    const streams = [
      [
        {
          type: 'message_start',
          message: { id: 'assistant_1', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool_write',
            name: 'write_file',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"path":"note.txt","content":"hello"}',
          },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
      [
        {
          type: 'message_start',
          message: { id: 'assistant_2', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Write completed.' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
    ]

    const client: AnthropicMessageClient = {
      messages: {
        async create() {
          throw new Error('unexpected create call')
        },
        async *stream() {
          const next = streams.shift() || []
          for (const event of next) {
            yield event as never
          }
        },
      },
    }

    const result = await runQueryLoop({
      client,
      model: 'test-model',
      history: [{ type: 'user', id: createId('user'), text: 'write file' }],
      tools: getTools(),
      maxIterations: 4,
      workdir: process.cwd(),
      requestToolApproval: async request => {
        approvals.push(request)
        return 'approved'
      },
    })

    expect(result.stopReason).toBe('completed')
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.tool.name).toBe('write_file')
    expect(
      result.history.some(
        message =>
          message.type === 'tool_result' &&
          message.toolName === 'write_file' &&
          message.isError === false,
      ),
    ).toBe(true)
  })

  test('returns an error tool_result when approval is rejected', async () => {
    const streams = [
      [
        {
          type: 'message_start',
          message: { id: 'assistant_1', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool_write',
            name: 'write_file',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"path":"note.txt","content":"hello"}',
          },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
      [
        {
          type: 'message_start',
          message: { id: 'assistant_2', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'I will avoid the write.' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
    ]
    const events: string[] = []

    const client: AnthropicMessageClient = {
      messages: {
        async create() {
          throw new Error('unexpected create call')
        },
        async *stream() {
          const next = streams.shift() || []
          for (const event of next) {
            yield event as never
          }
        },
      },
    }

    const result = await runQueryLoop({
      client,
      model: 'test-model',
      history: [{ type: 'user', id: createId('user'), text: 'write file' }],
      tools: getTools(),
      maxIterations: 4,
      workdir: process.cwd(),
      onEvent: event => {
        events.push(event.type)
      },
      requestToolApproval: async () => 'rejected',
    })

    expect(result.stopReason).toBe('completed')
    expect(events).toContain('tool_approval_requested')
    expect(
      result.history.some(
        message =>
          message.type === 'tool_result' &&
          message.toolName === 'write_file' &&
          message.isError === true &&
          message.content.includes('rejected by user'),
      ),
    ).toBe(true)
  })
})

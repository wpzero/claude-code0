import { afterEach, describe, expect, test } from 'bun:test'
import { runQueryLoop } from './queryLoop.js'
import {
  createId,
  toAnthropicMessages,
} from './utils/messageTransform.js'
import { getTools } from './toolRegistry.js'
import type {
  AgentDefinition,
  AnthropicMessageClient,
  AssistantMessage,
  ChatMessage,
  ToolApprovalRequest,
} from './types.js'

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

afterEach(() => {
  resetEnv()
})

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
  test('injects agent listing reminders incrementally', async () => {
    const requests: Record<string, unknown>[] = []
    const client: AnthropicMessageClient = {
      messages: {
        async create() {
          throw new Error('unexpected create call')
        },
        async *stream(input) {
          requests.push(input)
          yield {
            type: 'message_start',
            message: { id: `assistant_${requests.length}`, content: [] },
          } as never
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          } as never
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Done.' },
          } as never
          yield { type: 'content_block_stop', index: 0 } as never
          yield { type: 'message_stop' } as never
        },
      },
    }

    const reviewer: AgentDefinition = {
      agentType: 'reviewer',
      description: 'Reviews code',
      prompt: 'Review code.',
      tools: ['read_file', 'grep_files'],
      source: 'built-in',
    }

    const first = await runQueryLoop({
      client,
      model: 'test-model',
      history: [{ type: 'user', id: createId('user'), text: 'first turn' }],
      tools: getTools(),
      agents: [reviewer],
      maxIterations: 1,
      workdir: process.cwd(),
    })

    const firstMessages = requests[0]?.messages as Array<Record<string, unknown>>
    expect(
      typeof firstMessages?.[0]?.content === 'string' &&
        String(firstMessages[0].content).includes('<system-reminder>'),
    ).toBe(true)

    const second = await runQueryLoop({
      client,
      model: 'test-model',
      history: [{ type: 'user', id: createId('user'), text: 'second turn' }],
      tools: getTools(),
      agents: [reviewer],
      agentCatalogState: first.agentCatalogState,
      maxIterations: 1,
      workdir: process.cwd(),
    })

    const secondMessages = requests[1]?.messages as Array<Record<string, unknown>>
    expect(
      secondMessages.some(
        message =>
          typeof message.content === 'string' &&
          String(message.content).includes('<system-reminder>'),
      ),
    ).toBe(false)

    await runQueryLoop({
      client,
      model: 'test-model',
      history: [{ type: 'user', id: createId('user'), text: 'third turn' }],
      tools: getTools(),
      agents: [
        reviewer,
        {
          agentType: 'researcher',
          description: 'Researches code',
          prompt: 'Research code.',
          source: 'built-in',
        },
      ],
      agentCatalogState: second.agentCatalogState,
      maxIterations: 1,
      workdir: process.cwd(),
    })

    const thirdMessages = requests[2]?.messages as Array<Record<string, unknown>>
    expect(
      thirdMessages.some(
        message =>
          typeof message.content === 'string' &&
          String(message.content).includes(
            'Available agent types updated. Current list:',
          ),
      ),
    ).toBe(true)
  })

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

  test('spawn_agent runs a nested query loop and returns the final text', async () => {
    const events: string[] = []
    const requestedModels: string[] = []
    const streams = [
      [
        {
          type: 'message_start',
          message: { id: 'assistant_parent_1', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool_spawn',
            name: 'spawn_agent',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json:
              '{"prompt":"Inspect README.md","agent_type":"researcher","allowed_tools":["read_file"]}',
          },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
      [
        {
          type: 'message_start',
          message: { id: 'assistant_child_1', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool_child_read',
            name: 'read_file',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"path":"README.md"}',
          },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
      [
        {
          type: 'message_start',
          message: { id: 'assistant_child_2', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'README inspected successfully.' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
      [
        {
          type: 'message_start',
          message: { id: 'assistant_parent_2', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Subagent summary received.' },
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
        async *stream(input) {
          requestedModels.push(String(input.model))
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
      history: [{ type: 'user', id: createId('user'), text: 'delegate read' }],
      tools: getTools(),
      agents: [
        {
          agentType: 'researcher',
          description: 'Researches code',
          prompt: 'Research code.',
          tools: ['read_file'],
          model: 'sonnet',
          source: 'built-in',
        },
      ],
      maxIterations: 6,
      workdir: process.cwd(),
      onEvent: event => {
        events.push(event.type)
      },
      requestToolApproval: async request =>
        request.tool.name === 'spawn_agent' ? 'approved' : 'rejected',
    })

    const spawnResult = result.history.find(
      message =>
        message.type === 'tool_result' && message.toolName === 'spawn_agent',
    )

    expect(result.stopReason).toBe('completed')
    expect(events).toContain('subagent_lifecycle')
    expect(spawnResult).toBeDefined()
    expect(spawnResult?.type).toBe('tool_result')
    if (spawnResult?.type === 'tool_result') {
      expect(spawnResult.isError).toBe(false)
      expect(spawnResult.content).toContain('README inspected successfully.')
    }
    expect(requestedModels).toEqual([
      'test-model',
      'claude-sonnet-4-5',
      'claude-sonnet-4-5',
      'test-model',
    ])
  })

  test('spawn_agent keeps alias-based agents on the parent model for third-party gateways', async () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'
    const requestedModels: string[] = []
    const streams = [
      [
        {
          type: 'message_start',
          message: { id: 'assistant_parent_1', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool_spawn',
            name: 'spawn_agent',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"prompt":"Inspect README.md","agent_type":"researcher"}',
          },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
      [
        {
          type: 'message_start',
          message: { id: 'assistant_child_1', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Child done.' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
      [
        {
          type: 'message_start',
          message: { id: 'assistant_parent_2', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Parent done.' },
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
        async *stream(input) {
          requestedModels.push(String(input.model))
          const next = streams.shift() || []
          for (const event of next) {
            yield event as never
          }
        },
      },
    }

    const result = await runQueryLoop({
      client,
      model: 'MiniMax-M2.7',
      history: [{ type: 'user', id: createId('user'), text: 'delegate read' }],
      tools: getTools(),
      agents: [
        {
          agentType: 'researcher',
          description: 'Researches code',
          prompt: 'Research code.',
          model: 'sonnet',
          source: 'built-in',
        },
      ],
      maxIterations: 4,
      workdir: process.cwd(),
      requestToolApproval: async () => 'approved',
    })

    expect(result.stopReason).toBe('completed')
    expect(requestedModels).toEqual([
      'MiniMax-M2.7',
      'MiniMax-M2.7',
      'MiniMax-M2.7',
    ])
  })

  test('spawn_agent cannot recursively invoke itself', async () => {
    const systemMessages: string[] = []
    const streams = [
      [
        {
          type: 'message_start',
          message: { id: 'assistant_parent_1', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool_spawn',
            name: 'spawn_agent',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json:
              '{"prompt":"Try recursion","allowed_tools":["spawn_agent"]}',
          },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
      [
        {
          type: 'message_start',
          message: { id: 'assistant_parent_2', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Handled recursion failure.' },
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
      history: [{ type: 'user', id: createId('user'), text: 'delegate recursively' }],
      tools: getTools(),
      agents: [],
      maxIterations: 4,
      workdir: process.cwd(),
      onEvent: event => {
        if (event.type === 'system') {
          systemMessages.push(event.message.text)
        }
      },
      requestToolApproval: async () => 'approved',
    })

    expect(result.stopReason).toBe('completed')
    expect(systemMessages.some(message => message.includes('[subagent] started:'))).toBe(
      true,
    )
    expect(
      result.history.some(
        message =>
          message.type === 'tool_result' &&
          message.toolName === 'spawn_agent' &&
          message.isError === true &&
          message.content.includes('Subagent has no available tools'),
      ),
    ).toBe(true)
  })

  test('spawn_agent reports a clear error when allowed_tools excludes the selected agent toolset', async () => {
    const streams = [
      [
        {
          type: 'message_start',
          message: { id: 'assistant_parent_1', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool_spawn',
            name: 'spawn_agent',
            input: {},
          },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json:
              '{"prompt":"Inspect README.md","agent_type":"researcher","allowed_tools":["write_file"]}',
          },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ],
      [
        {
          type: 'message_start',
          message: { id: 'assistant_parent_2', content: [] },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Handled restrictive tool filter.' },
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
      history: [{ type: 'user', id: createId('user'), text: 'delegate read' }],
      tools: getTools(),
      agents: [
        {
          agentType: 'researcher',
          description: 'Researches code',
          prompt: 'Research code.',
          tools: ['read_file'],
          source: 'built-in',
        },
      ],
      maxIterations: 4,
      workdir: process.cwd(),
      requestToolApproval: async () => 'approved',
    })

    expect(result.stopReason).toBe('completed')
    expect(
      result.history.some(
        message =>
          message.type === 'tool_result' &&
          message.toolName === 'spawn_agent' &&
          message.isError === true &&
          message.content.includes(
            'Requested allowed_tools excludes all tools available to agent_type researcher.',
          ),
      ),
    ).toBe(true)
  })
})

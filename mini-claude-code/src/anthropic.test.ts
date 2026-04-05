import { describe, expect, test } from 'bun:test'
import {
  getAnthropicClientOptions,
  streamAnthropicAssistantMessage,
} from './anthropic.js'
import type { AnthropicMessageClient } from './types.js'

describe('getAnthropicClientOptions', () => {
  test('returns auth token and base url for compatible providers', () => {
    expect(
      getAnthropicClientOptions({
        authToken: 'token',
        baseURL: 'https://api.minimaxi.com/anthropic',
      }),
    ).toEqual({
      authToken: 'token',
      baseURL: 'https://api.minimaxi.com/anthropic',
    })
  })

  test('returns api key for official anthropic mode', () => {
    expect(
      getAnthropicClientOptions({
        apiKey: 'sk-ant',
      }),
    ).toEqual({
      apiKey: 'sk-ant',
    })
  })
})

describe('streamAnthropicAssistantMessage', () => {
  test('assembles text deltas into a final assistant message', async () => {
    const snapshots: string[] = []
    const client: AnthropicMessageClient = {
      messages: {
        async create() {
          throw new Error('unexpected create call')
        },
        async *stream() {
          yield {
            type: 'message_start',
            message: { id: 'assistant_1', content: [] },
          }
          yield {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          }
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hello' },
          }
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: ' world' },
          }
          yield { type: 'content_block_stop', index: 0 }
          yield { type: 'message_stop' }
        },
      },
    }

    const message = await streamAnthropicAssistantMessage({
      client,
      model: 'test-model',
      messages: [],
      tools: [],
      onSnapshot: snapshot => {
        const text = snapshot.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('')
        snapshots.push(text)
      },
    })

    expect(message.id).toBe('assistant_1')
    expect(message.content).toEqual([{ type: 'text', text: 'Hello world' }])
    expect(snapshots.at(-1)).toBe('Hello world')
  })
})

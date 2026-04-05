import { describe, expect, test } from 'bun:test'
import { getAnthropicClientOptions } from './anthropic.js'

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

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { debugLog, isDebugEnabled, redactSecrets } from './debug.js'

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

describe('debug', () => {
  test('is disabled by default', () => {
    delete process.env.MINI_CLAUDE_CODE_DEBUG
    expect(isDebugEnabled()).toBe(false)
  })

  test('redacts secret fields', () => {
    expect(
      redactSecrets({
        apiKey: 'sk-1234567890',
        authToken: 'token-1234567890',
        nested: { authorization: 'Bearer abcdefghijklmnop' },
        baseURL: 'https://api.minimaxi.com/anthropic',
      }),
    ).toEqual({
      apiKey: 'sk-1...[redacted]...7890',
      authToken: 'toke...[redacted]...7890',
      nested: { authorization: 'Bear...[redacted]...mnop' },
      baseURL: 'https://api.minimaxi.com/anthropic',
    })
  })

  test('writes logs when enabled', () => {
    process.env.MINI_CLAUDE_CODE_DEBUG = '1'
    const writes: string[] = []
    const originalWrite = process.stderr.write.bind(process.stderr)
    const writeSpy = mock((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    })
    process.stderr.write = writeSpy as typeof process.stderr.write

    try {
      debugLog('test.scope', { authToken: 'token-1234567890', ok: true })
    } finally {
      process.stderr.write = originalWrite
    }

    expect(writes).toHaveLength(1)
    expect(writes[0]).toContain('[debug][')
    expect(writes[0]).toContain('[test.scope]')
    expect(writes[0]).toContain('[redacted]')
  })
})

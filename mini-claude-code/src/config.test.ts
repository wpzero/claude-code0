import { afterEach, describe, expect, test } from 'bun:test'
import { getConfig } from './config.js'

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

describe('getConfig', () => {
  test('accepts api key auth', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    delete process.env.ANTHROPIC_AUTH_TOKEN

    const config = getConfig()
    expect(config.apiKey).toBe('sk-test')
    expect(config.authToken).toBeUndefined()
  })

  test('accepts auth token with custom base url', () => {
    delete process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_AUTH_TOKEN = 'bearer-test'
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'

    const config = getConfig()
    expect(config.authToken).toBe('bearer-test')
    expect(config.baseURL).toBe('https://api.minimaxi.com/anthropic')
  })

  test('prefers ANTHROPIC_MODEL over MVP model override', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    process.env.ANTHROPIC_MODEL = 'MiniMax-M2.7'
    process.env.CLAUDE_CODE_MVP_MODEL = 'claude-sonnet-4-5'

    const config = getConfig()
    expect(config.model).toBe('MiniMax-M2.7')
  })

  test('throws if both auth methods are missing', () => {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_AUTH_TOKEN

    expect(() => getConfig()).toThrow(
      'Either ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required',
    )
  })
})

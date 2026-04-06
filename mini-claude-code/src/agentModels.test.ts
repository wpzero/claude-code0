import { afterEach, describe, expect, test } from 'bun:test'
import { resolveAgentModel } from './agentModels.js'

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

describe('resolveAgentModel', () => {
  test('inherits the parent model by default', () => {
    expect(resolveAgentModel(undefined, 'MiniMax-M2.7')).toBe('MiniMax-M2.7')
    expect(resolveAgentModel('inherit', 'MiniMax-M2.7')).toBe('MiniMax-M2.7')
  })

  test('resolves first-party aliases to built-in defaults', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(resolveAgentModel('sonnet', 'parent-model')).toBe('claude-sonnet-4-5')
    expect(resolveAgentModel('haiku', 'parent-model')).toBe('claude-haiku-4-5')
    expect(resolveAgentModel('opus', 'parent-model')).toBe('claude-opus-4-1')
  })

  test('prefers explicit alias mappings from the environment', () => {
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'MiniMax-Text-01'
    process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'MiniMax-Flash-01'
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'MiniMax-Reasoner-01'

    expect(resolveAgentModel('sonnet', 'parent-model')).toBe('MiniMax-Text-01')
    expect(resolveAgentModel('haiku', 'parent-model')).toBe('MiniMax-Flash-01')
    expect(resolveAgentModel('opus', 'parent-model')).toBe('MiniMax-Reasoner-01')
  })

  test('keeps alias models on the parent model for third-party gateways without explicit mappings', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.minimaxi.com/anthropic'

    expect(resolveAgentModel('sonnet', 'MiniMax-M2.7')).toBe('MiniMax-M2.7')
    expect(resolveAgentModel('haiku', 'MiniMax-M2.7')).toBe('MiniMax-M2.7')
    expect(resolveAgentModel('opus', 'MiniMax-M2.7')).toBe('MiniMax-M2.7')
  })

  test('passes through raw model strings unchanged', () => {
    expect(resolveAgentModel('MiniMax-M2.7', 'parent-model')).toBe('MiniMax-M2.7')
  })
})

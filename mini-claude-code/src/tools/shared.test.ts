import { describe, expect, test } from 'bun:test'
import { resolveSandboxedPath } from './shared.js'

describe('resolveSandboxedPath', () => {
  test('allows files inside the workdir', () => {
    const result = resolveSandboxedPath('/tmp/project', 'src/index.ts')
    expect(result).toBe('/tmp/project/src/index.ts')
  })

  test('rejects paths outside the workdir', () => {
    expect(() => resolveSandboxedPath('/tmp/project', '../secret.txt')).toThrow(
      'Path escapes workdir',
    )
  })
})

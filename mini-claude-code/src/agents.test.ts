import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  createAgentListingInjection,
  loadAgents,
} from './agents.js'
import { createId } from './utils/messageTransform.js'
import type { ChatMessage } from './types.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  )
})

async function createTempWorkdir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-claude-agents-'))
  tempDirs.push(dir)
  return dir
}

describe('loadAgents', () => {
  test('loads project agents from markdown frontmatter', async () => {
    const workdir = await createTempWorkdir()
    const agentDir = path.join(workdir, '.mini-claude/agents')
    await fs.mkdir(agentDir, { recursive: true })
    await fs.writeFile(
      path.join(agentDir, 'reviewer.md'),
      `---
name: reviewer
description: Reviews code carefully
tools: read_file, grep_files
model: sonnet
---
You are a review agent.`,
      'utf8',
    )

    const result = await loadAgents(workdir)
    const reviewer = result.agents.find(agent => agent.agentType === 'reviewer')

    expect(reviewer).toBeDefined()
    expect(reviewer?.source).toBe('project')
    expect(reviewer?.tools).toEqual(['read_file', 'grep_files'])
    expect(reviewer?.model).toBe('sonnet')
  })

  test('reports invalid agent files without failing discovery', async () => {
    const workdir = await createTempWorkdir()
    const agentDir = path.join(workdir, '.mini-claude/agents')
    await fs.mkdir(agentDir, { recursive: true })
    await fs.writeFile(
      path.join(agentDir, 'broken.md'),
      `---
name: broken
---
`,
      'utf8',
    )

    const result = await loadAgents(workdir)

    expect(result.failedFiles).toHaveLength(1)
    expect(result.failedFiles[0]?.error).toContain('description')
    expect(result.agents.some(agent => agent.agentType === 'general-purpose')).toBe(
      true,
    )
  })
})

describe('createAgentListingInjection', () => {
  test('injects full listing on first sight and skips unchanged catalogs', () => {
    const history: ChatMessage[] = [
      { type: 'user', id: createId('user'), text: 'hello' },
    ]
    const agents = [
      {
        agentType: 'reviewer',
        description: 'Reviews code',
        prompt: 'Review code.',
        tools: ['read_file', 'grep_files'],
        source: 'built-in' as const,
      },
    ]

    const first = createAgentListingInjection({
      history,
      agents,
      availableToolNames: ['read_file', 'grep_files', 'spawn_agent'],
    })

    expect(first.injected).toBe(true)
    expect(first.injectedHistory[0]?.type).toBe('user')
    if (first.injectedHistory[0]?.type === 'user') {
      expect(first.injectedHistory[0].text).toContain('<system-reminder>')
      expect(first.injectedHistory[0].text).toContain('Available agent types:')
      expect(first.injectedHistory[0].text).toContain('reviewer')
    }

    const second = createAgentListingInjection({
      history,
      agents,
      availableToolNames: ['read_file', 'grep_files', 'spawn_agent'],
      catalogState: first.catalogState,
    })

    expect(second.injected).toBe(false)
    expect(second.injectedHistory).toEqual(history)
  })

  test('injects the latest full catalog when agents change', () => {
    const history: ChatMessage[] = [
      { type: 'user', id: createId('user'), text: 'hello' },
    ]

    const first = createAgentListingInjection({
      history,
      agents: [
        {
          agentType: 'reviewer',
          description: 'Reviews code',
          prompt: 'Review code.',
          source: 'built-in' as const,
        },
      ],
      availableToolNames: ['read_file', 'grep_files', 'spawn_agent'],
    })

    const second = createAgentListingInjection({
      history,
      agents: [
        {
          agentType: 'researcher',
          description: 'Researches code',
          prompt: 'Research code.',
          source: 'built-in' as const,
        },
      ],
      availableToolNames: ['read_file', 'grep_files', 'spawn_agent'],
      catalogState: first.catalogState,
    })

    expect(second.injected).toBe(true)
    if (second.injectedHistory[0]?.type === 'user') {
      expect(second.injectedHistory[0].text).toContain(
        'Available agent types updated. Current list:',
      )
      expect(second.injectedHistory[0].text).toContain('researcher')
      expect(second.injectedHistory[0].text).not.toContain('Removed agent types:')
      expect(second.injectedHistory[0].text).not.toContain('reviewer')
    }
  })
})

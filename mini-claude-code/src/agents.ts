import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentCatalogState,
  AgentDefinition,
  ChatMessage,
} from './types.js'
import { TODO_WRITE_TOOL_NAME } from './todos.js'
import { createId } from './utils/messageTransform.js'

const AGENT_DIR = '.mini-claude/agents'

const BUILT_IN_AGENTS: AgentDefinition[] = [
  {
    agentType: 'general-purpose',
    description: 'Handles general coding tasks across the current workdir.',
    prompt:
      'You are the general-purpose Mini Claude Code worker. Complete the assigned task with the provided tools. Be concise and practical.',
    source: 'built-in',
  },
  {
    agentType: 'researcher',
    description: 'Explores files and summarizes findings using read-heavy tools.',
    prompt:
      'You are a researcher subagent. Prioritize reading files, listing directories, and searching content. Summarize findings clearly and avoid modifying files unless explicitly requested.',
    tools: ['read_file', 'list_files', 'grep_files'],
    source: 'built-in',
  },
  {
    agentType: 'reviewer',
    description: 'Reviews code for bugs, regressions, and missing tests.',
    prompt:
      'You are a code review subagent. Look for correctness issues, regressions, and missing validation or tests. Return findings first, then a short summary.',
    tools: ['read_file', 'list_files', 'grep_files'],
    source: 'built-in',
  },
]

export type AgentDefinitionsResult = {
  agents: AgentDefinition[]
  failedFiles: Array<{ path: string; error: string }>
}

function parseListValue(raw: string): string[] {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map(value => value.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  }

  return trimmed
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
}

function parseFrontmatterBlock(frontmatterText: string): Record<string, string> {
  const data: Record<string, string> = {}

  for (const line of frontmatterText.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex < 0) {
      continue
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '')

    data[key] = value
  }

  return data
}

function parseAgentMarkdown(filePath: string, raw: string): AgentDefinition {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) {
    throw new Error('Missing YAML frontmatter block.')
  }

  const frontmatter = parseFrontmatterBlock(match[1] ?? '')
  const prompt = (match[2] ?? '').trim()
  const agentType = frontmatter.name?.trim()
  const description = frontmatter.description?.trim()

  if (!agentType) {
    throw new Error('Missing required "name" field in frontmatter.')
  }

  if (!description) {
    throw new Error('Missing required "description" field in frontmatter.')
  }

  if (!prompt) {
    throw new Error('Agent prompt body cannot be empty.')
  }

  return {
    agentType,
    description,
    prompt,
    tools: frontmatter.tools ? parseListValue(frontmatter.tools) : undefined,
    model: frontmatter.model?.trim() || undefined,
    source: 'project',
    filePath,
  }
}

export async function loadAgents(workdir: string): Promise<AgentDefinitionsResult> {
  const projectAgentDir = path.join(workdir, AGENT_DIR)
  const failedFiles: Array<{ path: string; error: string }> = []
  const projectAgents: AgentDefinition[] = []

  try {
    const entries = await fs.readdir(projectAgentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const filePath = path.join(projectAgentDir, entry.name)
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        projectAgents.push(parseAgentMarkdown(filePath, raw))
      } catch (error) {
        failedFiles.push({
          path: filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== 'ENOENT') {
      failedFiles.push({
        path: projectAgentDir,
        error: nodeError.message,
      })
    }
  }

  const merged = new Map<string, AgentDefinition>()
  for (const agent of BUILT_IN_AGENTS) {
    merged.set(agent.agentType, agent)
  }
  for (const agent of projectAgents) {
    merged.set(agent.agentType, agent)
  }

  return {
    agents: Array.from(merged.values()),
    failedFiles,
  }
}

function getEffectiveTools(
  agent: AgentDefinition,
  availableToolNames: string[],
): string[] {
  const baseTools = availableToolNames.filter(name => name !== 'spawn_agent')
  if (!agent.tools || agent.tools.length === 0) {
    return baseTools
  }
  return baseTools.filter(
    name => name === TODO_WRITE_TOOL_NAME || agent.tools?.includes(name),
  )
}

function formatAgentLine(
  agent: AgentDefinition,
  availableToolNames: string[],
): string {
  const tools = getEffectiveTools(agent, availableToolNames)
  return `- ${agent.agentType}: ${agent.description} (Tools: ${tools.join(', ') || 'none'})`
}

export function buildAgentCatalogEntries(
  agents: AgentDefinition[],
  availableToolNames: string[],
): Record<string, string> {
  return Object.fromEntries(
    agents
      .slice()
      .sort((left, right) => left.agentType.localeCompare(right.agentType))
      .map(agent => [agent.agentType, formatAgentLine(agent, availableToolNames)]),
  )
}

export function createAgentListingInjection(args: {
  history: ChatMessage[]
  agents: AgentDefinition[]
  availableToolNames: string[]
  catalogState?: AgentCatalogState
}): {
  injectedHistory: ChatMessage[]
  catalogState: AgentCatalogState
  injected: boolean
} {
  const nextEntries = buildAgentCatalogEntries(args.agents, args.availableToolNames)
  const previousEntries = args.catalogState?.entriesByType ?? {}
  const nextState: AgentCatalogState = { entriesByType: nextEntries }

  if (args.agents.length === 0) {
    return {
      injectedHistory: args.history,
      catalogState: nextState,
      injected: false,
    }
  }

  const nextCatalog = Object.values(nextEntries)
  const previousCatalog = Object.values(previousEntries)
  const isFirstInjection = previousCatalog.length === 0
  const catalogChanged =
    previousCatalog.length !== nextCatalog.length ||
    previousCatalog.some((line, index) => line !== nextCatalog[index])

  if (!isFirstInjection && !catalogChanged) {
    return {
      injectedHistory: args.history,
      catalogState: nextState,
      injected: false,
    }
  }

  const injectedMessage: ChatMessage = {
    type: 'user',
    id: createId('user'),
    text: [
      '<system-reminder>',
      isFirstInjection
        ? 'Available agent types:'
        : 'Available agent types updated. Current list:',
      ...nextCatalog,
      '</system-reminder>',
    ].join('\n'),
    isInjected: true,
    injectionKind: 'agent_listing',
  }

  return {
    injectedHistory: [injectedMessage, ...args.history],
    catalogState: nextState,
    injected: true,
  }
}

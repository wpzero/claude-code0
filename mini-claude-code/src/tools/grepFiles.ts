import { execa } from 'execa'
import { z } from 'zod'
import type { ToolDefinition } from '../types.js'
import { resolveSandboxedPath } from './shared.js'

const schema = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).default('.'),
})

export const grepFilesTool: ToolDefinition = {
  name: 'grep_files',
  description:
    'Search for a text pattern in files inside the sandboxed workdir using ripgrep.',
  inputSchema: schema,
  apiInputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Pattern to search for.' },
      path: { type: 'string', description: 'Search root relative to the workdir.' },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(input, context) {
    const { pattern, path } = schema.parse(input)
    const resolved = resolveSandboxedPath(context.workdir, path)
    const result = await execa('rg', ['-n', '--no-heading', pattern, resolved], {
      cwd: context.workdir,
      reject: false,
    })

    if ((result.exitCode ?? 0) === 1) {
      return { content: 'No matches found.' }
    }

    if ((result.exitCode ?? 0) !== 0) {
      throw new Error(result.stderr || 'rg failed')
    }

    return { content: result.stdout }
  },
}

import fs from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { z } from 'zod'
import type { ToolDefinition } from '../types.js'
import { resolveSandboxedPath } from './shared.js'

const schema = z.object({
  path: z.string().min(1).default('.'),
  recursive: z.boolean().optional(),
})

export const listFilesTool: ToolDefinition = {
  name: 'list_files',
  description:
    'List files inside the sandboxed workdir. Supports recursive search for codebase inspection.',
  inputSchema: schema,
  apiInputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path relative to the workdir.' },
      recursive: {
        type: 'boolean',
        description: 'Whether to recursively list files. Defaults to false.',
      },
    },
    additionalProperties: false,
  },
  requiresApproval: 'never',
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(input, context) {
    const { path: inputPath, recursive = false } = schema.parse(input)
    const resolved = resolveSandboxedPath(context.workdir, inputPath)
    const stats = await fs.stat(resolved)
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${inputPath}`)
    }

    if (recursive) {
      const result = await execa('rg', ['--files', resolved], {
        cwd: context.workdir,
        reject: false,
      })
      if ((result.exitCode ?? 0) > 1) {
        throw new Error(result.stderr || 'rg failed')
      }
      return {
        content: result.stdout
          .split('\n')
          .filter(Boolean)
          .map(filePath => path.relative(context.workdir, filePath))
          .join('\n'),
      }
    }

    const entries = await fs.readdir(resolved, { withFileTypes: true })
    const rows = entries.map(entry =>
      entry.isDirectory() ? `${entry.name}/` : entry.name,
    )
    return { content: rows.join('\n') }
  },
}

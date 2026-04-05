import fs from 'node:fs/promises'
import { z } from 'zod'
import type { ToolDefinition } from '../types.js'
import { ensureTextFileSize, resolveSandboxedPath } from './shared.js'

const schema = z.object({
  path: z.string().min(1),
})

export const readFileTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a UTF-8 text file from the current sandboxed workdir.',
  inputSchema: schema,
  apiInputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workdir.' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(input, context) {
    const { path } = schema.parse(input)
    const resolved = resolveSandboxedPath(context.workdir, path)
    await ensureTextFileSize(resolved)
    const content = await fs.readFile(resolved, 'utf8')
    return {
      content,
    }
  },
}

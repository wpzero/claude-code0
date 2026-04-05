import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition } from '../types.js'
import { resolveSandboxedPath } from './shared.js'

const schema = z.object({
  path: z.string().min(1),
  content: z.string(),
})

export const writeFileTool: ToolDefinition = {
  name: 'write_file',
  description:
    'Write a UTF-8 text file inside the sandboxed workdir, replacing the file content if it exists.',
  inputSchema: schema,
  apiInputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workdir.' },
      content: { type: 'string', description: 'Full file contents to write.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  isReadOnly: false,
  isConcurrencySafe: false,
  async execute(input, context) {
    const { path: inputPath, content } = schema.parse(input)
    const resolved = resolveSandboxedPath(context.workdir, inputPath)
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, content, 'utf8')
    return {
      content: `Wrote ${content.length} characters to ${inputPath}`,
    }
  },
}

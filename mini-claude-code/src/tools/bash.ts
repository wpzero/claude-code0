import { execa } from 'execa'
import { z } from 'zod'
import type { ToolDefinition } from '../types.js'
import { formatCommandOutput } from './shared.js'

const schema = z.object({
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120000).optional(),
})

export const bashTool: ToolDefinition = {
  name: 'bash',
  description:
    'Run a shell command in the current sandboxed workdir and return stdout, stderr, and exit code.',
  inputSchema: schema,
  apiInputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute.' },
      timeoutMs: {
        type: 'number',
        description: 'Optional timeout in milliseconds. Defaults to 20000.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  isReadOnly: false,
  isConcurrencySafe: false,
  async execute(input, context) {
    const { command, timeoutMs = 20000 } = schema.parse(input)
    const result = await execa(command, {
      cwd: context.workdir,
      shell: true,
      reject: false,
      timeout: timeoutMs,
    })

    return {
      content: formatCommandOutput({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? 0,
      }),
      isError: (result.exitCode ?? 0) !== 0,
    }
  },
}

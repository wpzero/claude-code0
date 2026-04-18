import fs from 'node:fs/promises'
import path from 'node:path'

const MAX_FILE_BYTES = 100 * 1024

export function resolveSandboxedPath(workdir: string, inputPath: string): string {
  const resolvedWorkdir = path.resolve(workdir)
  const targetPath = path.resolve(resolvedWorkdir, inputPath)
  const relative = path.relative(resolvedWorkdir, targetPath)

  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path escapes workdir: ${inputPath}`)
  }

  return targetPath
}

export async function ensureTextFileSize(filePath: string): Promise<void> {
  const stats = await fs.stat(filePath)
  if (stats.size > MAX_FILE_BYTES) {
    throw new Error(
      `File too large to read (${stats.size} bytes). Limit is ${MAX_FILE_BYTES} bytes.`,
    )
  }
}

export function formatCommandOutput(args: {
  stdout: string
  stderr: string
  exitCode: number
}): string {
  const chunks = [`exitCode: ${args.exitCode}`]
  if (args.stdout.trim()) {
    chunks.push(`stdout:\n${args.stdout.trimEnd()}`)
  }
  if (args.stderr.trim()) {
    chunks.push(`stderr:\n${args.stderr.trimEnd()}`)
  }
  return chunks.join('\n\n')
}

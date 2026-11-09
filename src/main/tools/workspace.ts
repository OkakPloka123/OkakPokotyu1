import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

export class WorkspaceError extends Error {}

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

/**
 * Resolves a path given by the agent against the workspace and rejects anything that ends up
 * outside of it, including through symlinks.
 */
export async function resolveInWorkspace(workspace: string, input: string): Promise<string> {
  const root = await realpath(workspace)
  const target = path.resolve(root, input)
  if (!isInside(root, target)) throw outside(input)

  // The target may not exist yet, so check the deepest part of the path that does.
  let probe = target
  for (;;) {
    const real = await realpathOrNull(probe)
    if (real !== null) {
      if (!isInside(root, real)) throw outside(input)
      return target
    }
    // A dangling symlink would let a write land wherever it points.
    if ((await lstat(probe).catch(() => null))?.isSymbolicLink()) throw outside(input)
    const parent = path.dirname(probe)
    if (parent === probe) return target
    probe = parent
  }
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await realpath(p)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function outside(input: string): WorkspaceError {
  return new WorkspaceError(`Путь «${input}» ведёт за пределы рабочей папки`)
}

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceError, resolveInWorkspace } from './workspace'

let root: string
let outside: string

beforeEach(async () => {
  // realpath: the temp folder itself is a symlink on macOS.
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'ws-')))
  outside = await realpath(await mkdtemp(path.join(tmpdir(), 'outside-')))
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(outside, 'secret.txt'), 'secret')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(outside, { recursive: true, force: true })
})

describe('resolveInWorkspace', () => {
  it('resolves paths inside the workspace, including ones that do not exist yet', async () => {
    expect(await resolveInWorkspace(root, 'src/new.txt')).toBe(path.join(root, 'src', 'new.txt'))
    expect(await resolveInWorkspace(root, '.')).toBe(root)
    expect(await resolveInWorkspace(root, '..name')).toBe(path.join(root, '..name'))
  })

  it('rejects paths that leave the workspace', async () => {
    await expect(resolveInWorkspace(root, '../x')).rejects.toBeInstanceOf(WorkspaceError)
    await expect(resolveInWorkspace(root, path.join(outside, 'secret.txt'))).rejects.toBeInstanceOf(
      WorkspaceError
    )
  })

  it.skipIf(process.platform === 'win32')('rejects symlinks that point outside', async () => {
    await symlink(outside, path.join(root, 'link'))
    await symlink(path.join(outside, 'missing.txt'), path.join(root, 'dangling'))

    await expect(resolveInWorkspace(root, 'link/secret.txt')).rejects.toBeInstanceOf(WorkspaceError)
    await expect(resolveInWorkspace(root, 'link/new.txt')).rejects.toBeInstanceOf(WorkspaceError)
    await expect(resolveInWorkspace(root, 'dangling')).rejects.toBeInstanceOf(WorkspaceError)
  })
})

import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../../shared/types'
import { decide } from './policy'

const command = (text: string): ToolCall => ({ name: 'run_command', args: { command: text } })

describe('decide', () => {
  it('runs read-only tools without asking', () => {
    expect(decide({ name: 'list_dir', args: {} }).kind).toBe('auto')
    expect(decide({ name: 'read_file', args: { path: 'a.txt' } }).kind).toBe('auto')
  })

  it.each([
    'git status',
    'rm -rf node_modules',
    'rm -rf /tmp/build',
    'del /s /q build',
    'Remove-Item -Recurse .\\dist',
    'git commit -m "fix reboot bug"',
    'git log --pretty=format:%h'
  ])('asks before running %s', (text) => {
    expect(decide(command(text)).kind).toBe('ask')
  })

  it('asks before writing files', () => {
    expect(decide({ name: 'write_file', args: { path: 'a.txt', content: '' } }).kind).toBe('ask')
  })

  it.each([
    'rm -rf /',
    'sudo rm -rf ~',
    'rm -rf --no-preserve-root /',
    'rm -fr /*',
    'mkfs.ext4 /dev/sda1',
    'dd if=/dev/zero of=/dev/sda',
    'chmod -R 777 /',
    'shutdown -h now',
    'Stop-Computer',
    'format C:',
    'rd /s /q C:\\',
    'Remove-Item -Recurse -Force C:\\',
    'Remove-Item -Recurse -Force $HOME',
    'diskpart',
    ':(){ :|:& };:'
  ])('blocks %s', (text) => {
    expect(decide(command(text)).kind).toBe('deny')
  })
})

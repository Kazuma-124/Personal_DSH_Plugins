import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import {
  ACTIVE_DIRECTORY,
  MAX_PROMPT_BYTES,
  PRESET_DIRECTORY,
  ensurePromptLayout,
  listPresets,
  readActivePrompt,
  resolvePromptRoot,
} from '../prompt-store.js'

const roots = []
function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-compaction-prompts-'))
  roots.push(root)
  return root
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('resolvePromptRoot', () => {
  it('falls back to the default layout under the user home', () => {
    assert.match(resolvePromptRoot({}), /compaction-prompts$/u)
  })

  it('honours the environment override and ignores blanks', () => {
    assert.equal(resolvePromptRoot({ DSH_COMPACTION_PROMPTS_DIR: '  C:/prompts  ' }), 'C:/prompts')
    assert.match(resolvePromptRoot({ DSH_COMPACTION_PROMPTS_DIR: '   ' }), /compaction-prompts$/u)
  })
})

describe('ensurePromptLayout', () => {
  it('creates both folders once and leaves existing content alone', () => {
    const root = temporaryRoot()
    assert.equal(ensurePromptLayout(root), true)
    assert.equal(existsSync(join(root, ACTIVE_DIRECTORY)), true)
    assert.equal(existsSync(join(root, PRESET_DIRECTORY)), true)
    assert.match(readFileSync(join(root, 'README.txt'), 'utf8'), /active\//u)
    assert.equal(ensurePromptLayout(root), false)
  })
})

describe('readActivePrompt', () => {
  it('reports a fallback when the folder is missing or empty', () => {
    const root = temporaryRoot()
    assert.match(readActivePrompt(root).reason, /不存在/u)
    ensurePromptLayout(root)
    const empty = readActivePrompt(root)
    assert.equal(empty.kind, 'fallback')
    assert.match(empty.reason, /没有可用的/u)
  })

  it('returns the active prompt and strips a byte-order mark', () => {
    const root = temporaryRoot()
    ensurePromptLayout(root)
    writeFileSync(join(root, ACTIVE_DIRECTORY, 'zh.md'), '\uFEFF用中文写摘要\r\n<compacted-summary>\r\n', 'utf8')
    const active = readActivePrompt(root)
    assert.equal(active.kind, 'ok')
    assert.equal(active.name, 'zh.md')
    assert.equal(active.text.startsWith('用中文'), true)
    assert.deepEqual(active.warnings, [])
  })

  it('warns when the checkpoint merge rule is missing', () => {
    const root = temporaryRoot()
    ensurePromptLayout(root)
    writeFileSync(join(root, ACTIVE_DIRECTORY, 'plain.md'), 'Summarize the conversation.', 'utf8')
    const active = readActivePrompt(root)
    assert.equal(active.kind, 'ok')
    assert.equal(active.warnings.length, 1)
    assert.match(active.warnings[0], /compacted-summary/u)
  })

  it('uses the first file and warns when several are present', () => {
    const root = temporaryRoot()
    ensurePromptLayout(root)
    writeFileSync(join(root, ACTIVE_DIRECTORY, 'b.md'), 'B <compacted-summary>', 'utf8')
    writeFileSync(join(root, ACTIVE_DIRECTORY, 'a.md'), 'A <compacted-summary>', 'utf8')
    const active = readActivePrompt(root)
    assert.equal(active.name, 'a.md')
    assert.match(active.warnings[0], /2 个文件/u)
  })

  it('falls back for empty and oversized files', () => {
    const root = temporaryRoot()
    ensurePromptLayout(root)
    writeFileSync(join(root, ACTIVE_DIRECTORY, 'empty.md'), '   \n', 'utf8')
    assert.match(readActivePrompt(root).reason, /文件为空/u)
    writeFileSync(join(root, ACTIVE_DIRECTORY, 'empty.md'), 'x'.repeat(MAX_PROMPT_BYTES + 1), 'utf8')
    assert.match(readActivePrompt(root).reason, /上限/u)
  })

  it('ignores files that are not prompts', () => {
    const root = temporaryRoot()
    ensurePromptLayout(root)
    writeFileSync(join(root, ACTIVE_DIRECTORY, 'notes.tmp'), 'x', 'utf8')
    assert.equal(readActivePrompt(root).kind, 'fallback')
  })
})

describe('listPresets', () => {
  it('lists prompt files with sizes in name order', () => {
    const root = temporaryRoot()
    ensurePromptLayout(root)
    writeFileSync(join(root, PRESET_DIRECTORY, 'b-en.md'), 'abc', 'utf8')
    writeFileSync(join(root, PRESET_DIRECTORY, 'a-zh.md'), 'abcd', 'utf8')
    writeFileSync(join(root, PRESET_DIRECTORY, 'ignore.json'), '{}', 'utf8')
    assert.deepEqual(listPresets(root), [
      { name: 'a-zh.md', bytes: 4 },
      { name: 'b-en.md', bytes: 3 },
    ])
  })
})

/**
 * Legacy prompt-file readers and data-root helpers.
 * The settings catalog imports active/ and presets/ once on initialization.
 * Current global selection is stored in catalog.json.
 *
 * @module @kazuma-124/dsh-compaction-prompts/prompt-store
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Default root, beside the other per-user DSH directories. */
export const DEFAULT_PROMPT_ROOT = join(homedir(), '.dsh', 'compaction-prompts')

/** Folder holding the prompt currently in effect. */
export const ACTIVE_DIRECTORY = 'active'

/** Folder holding alternatives the user may switch to. */
export const PRESET_DIRECTORY = 'presets'

/** Upper bound for one prompt file; larger files are treated as unusable. */
export const MAX_PROMPT_BYTES = 64 * 1024

/** Environment variable that relocates the whole layout. */
export const ROOT_ENVIRONMENT_VARIABLE = 'DSH_COMPACTION_PROMPTS_DIR'

/** Marker the official instruction uses to fold a previous checkpoint. */
const CHECKPOINT_MARKER = '<compacted-summary>'

/** Files the store is willing to read. */
const PROMPT_FILE_PATTERN = /\.(?:md|txt)$/iu

/** Marker file created once so the layout is discoverable without documentation. */
const LAYOUT_README = 'README.txt'

const LAYOUT_README_TEXT = `Compaction prompts
==================

Choose a prompt in DSH Settings > Compaction prompts.
Paste new custom prompts into the settings page. One global choice is saved
in catalog.json and applies to future compactions across sessions.

Legacy active/ and presets/ files are imported only when catalog.json is
first created. Their original files remain as backups. Moving or editing
these files after migration does not switch the prompt.

Official content is synchronized when the plugin starts after DSH upgrades.
Content changes create immutable snapshots without changing your selection.
Custom prompt text must be non-empty UTF-8 and no larger than 64 KiB.
Include the <compacted-summary> merge rule to merge previous checkpoints.
`

/** Resolve the layout root, honouring the environment override. */
export function resolvePromptRoot(environment = process.env) {
  const configured = typeof environment[ROOT_ENVIRONMENT_VARIABLE] === 'string'
    ? environment[ROOT_ENVIRONMENT_VARIABLE].trim()
    : ''
  return configured.length > 0 ? configured : DEFAULT_PROMPT_ROOT
}

/** Absolute path of the folder holding the prompt in effect. */
export function activeDirectory(root) {
  return join(root, ACTIVE_DIRECTORY)
}

/** Absolute path of the folder holding alternatives. */
export function presetDirectory(root) {
  return join(root, PRESET_DIRECTORY)
}

/**
 * Create the folder layout and the explanatory note when they are missing.
 * @param root - layout root resolved by {@link resolvePromptRoot}.
 * @returns whether anything was created.
 */
export function ensurePromptLayout(root) {
  const presetDir = presetDirectory(root)
  const activeDir = activeDirectory(root)
  let created = false
  for (const directory of [root, presetDir, activeDir]) {
    if (existsSync(directory)) continue
    mkdirSync(directory, { recursive: true })
    created = true
  }
  const readme = join(root, LAYOUT_README)
  if (!existsSync(readme)) {
    writeFileSync(readme, LAYOUT_README_TEXT, 'utf8')
    created = true
  }
  return created
}

/** Regular files in one directory that this store may read, sorted by name. */
function promptFiles(directory) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(entry => entry.isFile() && PROMPT_FILE_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

/**
 * List the alternatives a user can switch to.
 * @param root - layout root.
 * @returns file names with their byte sizes, sorted by name.
 */
export function listPresets(root) {
  const directory = presetDirectory(root)
  return promptFiles(directory).map(name => {
    const path = join(directory, name)
    let bytes = 0
    try {
      bytes = statSync(path).size
    } catch {
      /* an unreadable entry is reported with zero bytes */
    }
    return { name, bytes }
  })
}

/** Read one prompt file, rejecting content this store cannot use. */
function readPromptFile(path) {
  const stats = statSync(path)
  if (!stats.isFile()) return { reason: '不是普通文件' }
  if (stats.size > MAX_PROMPT_BYTES) {
    return { reason: `文件超过 ${MAX_PROMPT_BYTES} 字节上限` }
  }
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { reason: `读取失败：${error instanceof Error ? error.message : String(error)}` }
  }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  if (text.trim().length === 0) return { reason: '文件为空' }
  return {
    text,
    bytes: stats.size,
    modifiedMs: stats.mtimeMs,
  }
}

/**
 * Read the prompt currently in effect.
 *
 * A missing folder, an empty folder and an unusable file all report a
 * fallback reason rather than throwing, because a failed read must never fail
 * a compaction.
 *
 * @param root - layout root.
 * @returns the usable prompt, or the reason the built-in instruction applies.
 */
export function readActivePrompt(root) {
  const directory = activeDirectory(root)
  const names = promptFiles(directory)
  if (names.length === 0) {
    return {
      kind: 'fallback',
      reason: existsSync(directory)
        ? 'active/ 里没有可用的 .md 文件'
        : 'active/ 目录不存在',
      candidates: 0,
    }
  }
  const warnings = []
  if (names.length > 1) {
    warnings.push(`active/ 里有 ${names.length} 个文件，只使用 ${names[0]}`)
  }
  const name = names[0]
  const path = join(directory, name)
  const read = readPromptFile(path)
  if (read.reason !== undefined) {
    return { kind: 'fallback', reason: `${name}：${read.reason}`, candidates: names.length, warnings }
  }
  if (!read.text.includes(CHECKPOINT_MARKER)) {
    warnings.push(`提示词没有 ${CHECKPOINT_MARKER} 合并规则，多次压缩可能嵌套`)
  }
  return {
    kind: 'ok',
    name,
    path,
    text: read.text,
    bytes: read.bytes,
    modifiedMs: read.modifiedMs,
    candidates: names.length,
    warnings,
  }
}

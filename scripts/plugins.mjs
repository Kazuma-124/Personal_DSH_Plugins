/**
 * Plugin directories published by this repository, in index display order, and
 * the market-level declarations their entries refer to.
 *
 * `build-index.mjs` and `version.mjs` both read the list from here, so adding a
 * plugin is a single registration instead of two lists that can drift apart.
 */
export const PLUGINS = [
  { dir: 'dsh-token-usage', category: 'usage' },
  { dir: 'conversation-notebook', category: 'ui' },
  { dir: 'dsh-tweaks', category: 'ui' },
  { dir: 'workspace-session-migration', category: 'workspace' },
];

/** Category ids used by PLUGINS must be declared here or DSH rejects the index. */
export const INDEX_METADATA = {
  categories: {
    usage: { title: { en: 'Usage statistics', zh: '用量统计' } },
    ui: { title: { en: 'Interface', zh: '界面' } },
    workspace: { title: { en: 'Workspaces', zh: '工作区' } },
  },
  labels: {},
  sortKeys: {},
};

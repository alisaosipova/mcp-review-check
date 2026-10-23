// Shared vocabularies (§1.5).
export const READ_VERBS = new Set([
  'get', 'list', 'search', 'find', 'read', 'fetch', 'query', 'lookup', 'describe', 'show', 'view', 'count',
  'check', 'browse', 'retrieve', 'export', 'download', 'summarize', 'resolve', 'inspect', 'preview',
]);

export const WRITE_VERBS = new Set([
  'create', 'add', 'insert', 'update', 'edit', 'modify', 'set', 'patch', 'put', 'post', 'publish', 'send',
  'upload', 'write', 'save', 'submit', 'book', 'reserve', 'order', 'pay', 'purchase', 'transfer', 'enqueue',
  'queue', 'schedule', 'start', 'run', 'trigger', 'execute', 'invite', 'share', 'move', 'rename', 'import',
  'sync', 'reset', 'archive', 'cancel', 'revoke', 'delete', 'remove', 'drop', 'destroy', 'purge', 'wipe',
  'overwrite', 'replace', 'disable', 'deactivate', 'unsubscribe', 'refund', 'close', 'terminate', 'erase',
  'truncate', 'merge', 'approve', 'reject', 'assign',
]);

export const HARD_DESTRUCTIVE = new Set([
  'delete', 'remove', 'drop', 'destroy', 'purge', 'wipe', 'overwrite', 'erase', 'truncate',
]);

export const IRREVERSIBLE = new Set([
  ...HARD_DESTRUCTIVE,
  'replace', 'cancel', 'revoke', 'disable', 'deactivate', 'unsubscribe', 'send', 'pay', 'transfer', 'refund',
  'close', 'terminate', 'reset',
]);

export const ALL_VERBS = new Set([...READ_VERBS, ...WRITE_VERBS]);

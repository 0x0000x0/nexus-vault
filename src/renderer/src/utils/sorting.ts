export function sortEntries(a: { name: string; type: 'folder' | 'file' }, b: { name: string; type: 'folder' | 'file' }): number {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
  return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(a.name, b.name);
}
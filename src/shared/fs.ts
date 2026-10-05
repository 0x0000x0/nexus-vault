export interface DirEntry {
  name: string;
  relPath: string;
  type: 'folder' | 'file';
  isFolderNote?: boolean;
  childCount?: number;
  extension?: string;
}

export interface ListDirResult {
  entries: DirEntry[];
}

export interface SafeCopyResult {
  destPath: string;
  skipped: string[];
}
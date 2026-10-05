export interface TreeNode {
  name: string;
  relPath: string;
  type: 'folder' | 'file';
  isFolderNote?: boolean;
  childCount?: number;
  extension?: string;
  children?: TreeNode[];
  expanded?: boolean;
  selected?: boolean;
}

export interface TreeFolder extends TreeNode {
  type: 'folder';
  children: TreeNode[];
  expanded: boolean;
}

export interface TreeFile extends TreeNode {
  type: 'file';
  children?: never;
}

export interface ExpandState {
  [relPath: string]: boolean;
}
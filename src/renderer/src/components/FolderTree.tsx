import { useState, useEffect, useRef, useCallback } from 'react';
import { FolderIcon, NoteIcon, BoardIcon, ChevronRight, ChevronDown, FolderNoteBadge } from './icons';
import { nexus } from '../utils/nexus';
import { sortEntries } from '../utils/sorting';
import type { DirEntry } from '@shared/fs';

interface TreeNode {
  entry: DirEntry;
  children: TreeNode[];
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
  depth: number;
}

interface FolderTreeProps {
  vault: { name: string; path: string; type: 'copy' | 'real' } | null;
  onSelect: (path: string) => void;
  expandPaths: string[];
  onExpandChange: (paths: string[]) => void;
}

export function FolderTree({ vault, onSelect, expandPaths, onExpandChange }: FolderTreeProps) {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const loadChildren = useCallback(async (node: TreeNode): Promise<TreeNode[]> => {
    const entries = await nexus.fs.listDir(vault!.path, node.entry.relPath);
    return entries.map((e) => ({
      entry: e,
      children: [],
      expanded: expandPaths.includes(e.relPath),
      loaded: false,
      loading: false,
      depth: node.depth + 1,
    }));
  }, [vault, expandPaths]);

  const toggleExpand = useCallback(async (node: TreeNode, nodes: TreeNode[], path: number[]) => {
    if (node.entry.type !== 'folder') return;

    if (!node.loaded && !node.loading) {
      node.loading = true;
      setRootNodes([...nodes]);
      const children = await loadChildren(node);
      node.children = children;
      node.loaded = true;
      node.loading = false;
    }

    const newExpanded = !node.expanded;
    node.expanded = newExpanded;

    const newExpandPaths = newExpanded
      ? [...expandPaths, node.entry.relPath]
      : expandPaths.filter((p) => p !== node.entry.relPath);
    onExpandChange(newExpandPaths);

    setRootNodes([...nodes]);
  }, [expandPaths, loadChildren, onExpandChange]);

  const findNode = (nodes: TreeNode[], relPath: string, path: number[] = []): { node: TreeNode; path: number[] } | null => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].entry.relPath === relPath) return { node: nodes[i], path: [...path, i] };
      if (nodes[i].expanded) {
        const found = findNode(nodes[i].children, relPath, [...path, i]);
        if (found) return found;
      }
    }
    return null;
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const visibleNodes = getVisibleNodes(rootNodes);
      const selectedIndex = visibleNodes.findIndex((n) => n.entry.relPath === selectedPath);
      if (selectedIndex === -1) return;

      let newIndex = selectedIndex;
      if (e.key === 'ArrowDown') newIndex = Math.min(selectedIndex + 1, visibleNodes.length - 1);
      else if (e.key === 'ArrowUp') newIndex = Math.max(selectedIndex - 1, 0);
      else if (e.key === 'ArrowRight') {
        const node = visibleNodes[selectedIndex];
        if (node.entry.type === 'folder' && !node.expanded) {
          toggleExpand(node, rootNodes, []);
        }
        return;
      } else if (e.key === 'ArrowLeft') {
        const node = visibleNodes[selectedIndex];
        if (node.entry.type === 'folder' && node.expanded) {
          toggleExpand(node, rootNodes, []);
        } else if (node.depth > 0) {
          // Collapse parent - find parent
        }
        return;
      } else if (e.key === 'Enter') {
        const node = visibleNodes[selectedIndex];
        if (node.entry.type === 'folder') {
          toggleExpand(node, rootNodes, []);
        } else {
          onSelect(node.entry.relPath);
        }
        return;
      } else {
        return;
      }

      if (newIndex !== selectedIndex) {
        const newNode = visibleNodes[newIndex];
        setSelectedPath(newNode.entry.relPath);
        onSelect(newNode.entry.relPath);
        scrollIntoView(newNode.entry.relPath);
      }
    },
    [rootNodes, selectedPath, toggleExpand, onSelect]
  );

  const getVisibleNodes = (nodes: TreeNode[]): TreeNode[] => {
    const result: TreeNode[] = [];
    const traverse = (ns: TreeNode[]) => {
      for (const n of ns) {
        result.push(n);
        if (n.expanded && n.children.length > 0) {
          traverse(n.children);
        }
      }
    };
    traverse(nodes);
    return result;
  };

  const scrollIntoView = (relPath: string) => {
    setTimeout(() => {
      const el = treeRef.current?.querySelector(`[data-rel-path="${CSS.escape(relPath)}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }, 0);
  };

  useEffect(() => {
    if (!vault) {
      setRootNodes([]);
      return;
    }
    const init = async () => {
      const entries = await nexus.fs.listDir(vault.path, '');
      const nodes: TreeNode[] = entries.map((e) => ({
        entry: e,
        children: [],
        expanded: expandPaths.includes(e.relPath),
        loaded: false,
        loading: false,
        depth: 0,
      }));
      setRootNodes(nodes);
    };
    init();
  }, [vault, expandPaths]);

  useEffect(() => {
    if (!treeRef.current) return;
    treeRef.current.addEventListener('keydown', handleKeyDown);
    return () => treeRef.current?.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const renderNode = (node: TreeNode, index: number): React.ReactElement => {
    const isSelected = selectedPath === node.entry.relPath;
    const hasChildren = node.entry.type === 'folder';
    const indent = node.depth * 14 + 4;

    return (
      <div
        key={node.entry.relPath}
        className={`row${isSelected ? ' sel' : ''}`}
        style={{ paddingLeft: indent }}
        data-rel-path={node.entry.relPath}
        tabIndex={0}
        onClick={() => {
          if (hasChildren) {
            toggleExpand(node, rootNodes, []);
          } else {
            setSelectedPath(node.entry.relPath);
            onSelect(node.entry.relPath);
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (hasChildren) {
            toggleExpand(node, rootNodes, []);
          }
        }}
      >
        {hasChildren ? (
          <span className="chev" onClick={(e) => { e.stopPropagation(); toggleExpand(node, rootNodes, []); }}>
            {node.expanded ? <ChevronDown /> : <ChevronRight />}
          </span>
        ) : (
          <span className="chev" />
        )}
        {node.entry.type === 'folder' ? (
          <>
            <FolderIcon />
            {node.entry.isFolderNote && <FolderNoteBadge />}
          </>
        ) : node.entry.extension === 'canvas' ? (
          <BoardIcon />
        ) : (
          <NoteIcon />
        )}
        <span className="nm">{node.entry.name.replace(/\.md$/, '')}</span>
        {node.entry.extension && node.entry.type === 'file' && <span className="ext">.{node.entry.extension}</span>}
      </div>
    );
  };

  const renderNodes = (nodes: TreeNode[]): React.ReactElement[] => {
    return nodes.flatMap((node, index) => [
      renderNode(node, index),
      node.expanded && node.children.length > 0 && (
        <div key={`${node.entry.relPath}-children`} className="guide">
          {renderNodes(node.children)}
        </div>
      ),
    ]);
  };

  if (!vault) return null;

  return (
    <aside className="tree" ref={treeRef} tabIndex={0}>
      <div className="treehead">
        <span className="lbl">Files</span>
        <button className="iconbtn" title="New note" disabled><NewNoteIcon /></button>
        <button className="iconbtn" title="New folder" disabled><NewFolderIcon /></button>
        <button className="iconbtn" title="Collapse all" onClick={() => onExpandChange([])}><CollapseAllIcon /></button>
      </div>
      <div className="treebody">{renderNodes(rootNodes)}</div>
    </aside>
  );
}
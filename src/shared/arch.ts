// Architecture view model for code-mode nested C4-ish boards (0.0.7). Grok Bot.
export type ArchKind = 'domain' | 'system' | 'app' | 'store' | 'component' | 'actor' | 'external';

export interface ArchNode {
  id: string; // stable, e.g. arch:app:main
  kind: ArchKind;
  name: string;
  caption?: string;
  parentId: string | null;
  paths: string[]; // repo rel paths / prefixes this node covers
  tags?: string[];
  inferred: boolean; // true = heuristic; false = from import file (phase 2)
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  label?: string; // e.g. "imports", "IPC", "reads"
  weight?: number; // aggregated import count
}

export type ArchHeuristic = 'electron' | 'monorepo' | 'web' | 'generic';

export interface ArchModel {
  version: 1;
  rootId: string;
  nodes: ArchNode[];
  edges: ArchEdge[];
  stats: {
    files: number;
    components: number;
    truncated: boolean;
    heuristic: ArchHeuristic;
    /** False when no JS/TS/Python/Go files — folder-only boxes. */
    importsParsed: boolean;
  };
}

/** Persisted next to code boards under userData/code-arch/<hash>.json (never inside the repo). */
export interface ArchCache {
  version: 1;
  model: ArchModel;
  preferredView: 'architecture' | 'folders';
  archUserEdited: boolean;
  updatedAt: number;
}

export const ARCH_BOARD_KEY = '__arch__';

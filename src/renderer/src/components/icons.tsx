// Inline SVG icons (Grok Bot; shapes follow mockup/index.html).
import type { ReactNode } from 'react';

const S = ({ size = 16, children, sw = 2 }: { size?: number; children: ReactNode; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <line x1="6" y1="17" x2="12" y2="6" stroke="var(--accent)" strokeWidth="2" />
    <line x1="12" y1="6" x2="18" y2="17" stroke="var(--accent)" strokeWidth="2" />
    <line x1="6" y1="17" x2="18" y2="17" stroke="var(--accent)" strokeWidth="2" opacity=".55" />
    <circle cx="12" cy="6" r="3.2" fill="var(--accent)" />
    <circle cx="6" cy="17" r="3.2" fill="var(--accent)" />
    <circle cx="18" cy="17" r="3.2" fill="var(--accent)" />
  </svg>
);

export const VaultIcon = () => <S size={15}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="12" cy="12" r="3" /><path d="M12 9V7M12 17v-2" /></S>;
export const GraphIcon = ({ size = 14 }: { size?: number }) => <S size={size}><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="10" cy="18" r="2.5" /><path d="M8 7l8 1M7 8l2 8M12 17l5-7" /></S>;
export const SplitIcon = () => <S size={14}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></S>;
export const BoardIcon = ({ size = 14 }: { size?: number }) => <S size={size}><rect x="3" y="3" width="8" height="7" rx="1.5" /><rect x="13" y="3" width="8" height="11" rx="1.5" /><rect x="3" y="12" width="8" height="9" rx="1.5" /><rect x="13" y="16" width="8" height="5" rx="1.5" /></S>;
export const SwapIcon = () => <S size={15}><path d="M7 7h13l-4-4M17 17H4l4 4" /></S>;
export const MaxIcon = () => <S size={13}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></S>;
export const RestoreIcon = () => <S size={13}><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></S>;
export const SearchIcon = () => <S size={14}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></S>;
export const SunIcon = () => <S size={13}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></S>;
export const MoonIcon = () => <S size={13}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></S>;
export const MonitorIcon = () => <S size={13}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></S>;
export const CollapseIcon = () => <S size={14}><path d="M7 15l5-5 5 5" /></S>;
export const RefreshIcon = () => <S size={14}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></S>;
export const FolderOpenIcon = () => <S size={16}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7l-4 9z" /><path d="M3 19l3.5-8H22l-3.5 8z" /></S>;
export const CopyIcon = () => <S size={16}><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></S>;

export const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2.2h8.8A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" fill="none" stroke="#d9b23a" strokeWidth="1.8" /></svg>
);
export const NoteIcon = () => <S size={16} sw={1.7}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></S>;
export const CanvasIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /><path d="M11 7h4a2 2 0 0 1 2 2v4" /></svg>
);
export const FileIcon = () => <S size={16} sw={1.7}><path d="M6 3h8l4 4v14H6z" /><path d="M9 13h6M9 17h4" /></S>;
export const ImageIcon = () => <S size={16} sw={1.7}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" /></S>;

export const ToolIcons: Record<string, () => JSX.Element> = {
  Note: () => <S><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></S>,
  Board: () => <S><rect x="3" y="3" width="18" height="18" rx="3" /><rect x="7" y="7" width="4" height="4" /><rect x="13" y="7" width="4" height="7" /></S>,
  Link: () => <S><path d="M5 19L19 5M19 5h-6M19 5v6" /></S>,
  Text: () => <S><path d="M5 5h14M12 5v14" /></S>,
  Image: () => <S><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" /></S>,
  'To-do': () => <S><rect x="3" y="4" width="6" height="6" rx="1" /><path d="M4.5 7l1.2 1.2L8 6M12 7h9M3 16h6M12 16h9" /></S>,
  Column: () => <S><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h8" /></S>,
  Globe: () => <S><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></S>,
  Sketch: () => <S><path d="M3 21l3-1 11-11-2-2L4 18zM14 6l2-2 4 4-2 2" /></S>,
};

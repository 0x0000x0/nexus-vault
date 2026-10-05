export const LogoIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
    <line x1="6" y1="17" x2="12" y2="6" stroke="var(--accent)" strokeWidth="2" />
    <line x1="12" y1="6" x2="18" y2="17" stroke="var(--accent)" strokeWidth="2" />
    <line x1="6" y1="17" x2="18" y2="17" stroke="var(--accent)" strokeWidth="2" opacity="0.55" />
    <circle cx="12" cy="6" r="3.2" fill="var(--accent)" />
    <circle cx="6" cy="17" r="3.2" fill="var(--accent)" />
    <circle cx="18" cy="17" r="3.2" fill="var(--accent)" />
  </svg>
);

export const VaultIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 9V7M12 17v-2" />
  </svg>
);

export const ChevronRight = () => <span>▸</span>;
export const ChevronDown = () => <span>▾</span>;

export const FolderIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="var(--c-yellow)" strokeWidth="1.8">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="color-mix(in srgb, var(--c-yellow) 18%, transparent)" />
  </svg>
);

export const NoteIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.7">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

export const BoardIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.7">
    <rect x="3" y="4" width="8" height="7" rx="1.5" />
    <rect x="13" y="4" width="8" height="11" rx="1.5" />
    <rect x="3" y="13" width="8" height="7" rx="1.5" />
  </svg>
);

export const ToolIcons = {
  Note: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  ),
  Board: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <rect x="6.5" y="7" width="5" height="4" rx="1" />
      <rect x="12.5" y="7" width="5" height="9" rx="1" />
      <rect x="6.5" y="13" width="5" height="3" rx="1" />
    </svg>
  ),
  Link: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 18C9 18 9 6 18 6" />
      <path d="M14 3l4 3-4 3" />
    </svg>
  ),
  Text: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </svg>
  ),
  Image: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="2" />
      <path d="M4 18l5-5 4 4 3-3 4 4" />
    </svg>
  ),
  Todo: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="4" y="4" width="5" height="5" rx="1" />
      <path d="M5.5 6.5l1 1 2-2" />
      <rect x="4" y="13" width="5" height="5" rx="1" />
      <path d="M12 7h8M12 16h8" />
    </svg>
  ),
  Column: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <rect x="8" y="6" width="8" height="4" rx="1" />
      <rect x="8" y="12" width="8" height="4" rx="1" />
    </svg>
  ),
  Sketch: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 20l4-1 10-10-3-3L5 16z" />
      <path d="M13 7l3 3" />
      <path d="M14 20c2-2 4 0 6-2" />
    </svg>
  ),
  Import: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 17V7l8-4 8 4v10l-8 4z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </svg>
  ),
};

export const ViewIcons = {
  Graph: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="10" cy="18" r="2.5" />
      <path d="M8 7l8 1M7 8l2 8M12 17l5-7" />
    </svg>
  ),
  Split: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </svg>
  ),
  Board: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="8" height="7" rx="1.5" />
      <rect x="13" y="4" width="8" height="11" rx="1.5" />
      <rect x="3" y="13" width="8" height="7" rx="1.5" />
    </svg>
  ),
};

export const ThemeIcons = {
  Light: () => <span>☀</span>,
  Dark: () => <span>☾</span>,
  System: () => <span>🖥</span>,
};

export const MaximizeIcon = () => <span>⤢</span>;
export const SwapIcon = () => <span>⇄</span>;
export const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-4-4" />
  </svg>
);
export const SettingsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const HelpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14M12 17.5v.01" />
  </svg>
);
export const NewNoteIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 11v6M9 14h6" />
  </svg>
);
export const NewFolderIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 10v6M9 13h6" />
  </svg>
);
export const CollapseAllIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M7 15l5-5 5 5" />
  </svg>
);
export const ExportIcon = () => <span>⇩</span>;
export const LocalGraphIcon = () => <span>◎</span>;
export const FolderNoteBadge = () => (
  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', marginLeft: 6 }} />
);
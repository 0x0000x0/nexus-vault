// Milanote-style tool strip: click adds at board center, drag places at drop point (Grok Bot).
import type { ToolId } from './BoardPane';
import { TOOL_MIME } from './BoardPane';
import { ToolIcons } from './icons';

const TOOLS: { id: ToolId; label: string; icon: string; tip: string }[] = [
  { id: 'note', label: 'Note', icon: 'Note', tip: 'Note card — creates a real .md note in the board folder' },
  { id: 'text', label: 'Text', icon: 'Text', tip: 'Text / sticky (board only)' },
  { id: 'group', label: 'Box', icon: 'Board', tip: 'Box / group — cards inside move with it' },
  { id: 'image', label: 'Image', icon: 'Image', tip: 'Image — pick a picture file' },
  { id: 'link', label: 'Link', icon: 'Globe', tip: 'Link / URL card' },
  { id: 'line', label: 'Line', icon: 'Link', tip: 'Line / arrow — drag from card to card. Note→note lines write [[links]]' },
];

export function ToolStrip({ expanded, width, lineMode, onTool, readOnly }: { expanded: boolean; width: number; lineMode: boolean; onTool: (t: ToolId) => void; readOnly?: boolean }) {
  return (
    <nav className="tools" style={{ width }} aria-label="Board tools">
      {TOOLS.map((t, i) => {
        const Icon = ToolIcons[t.icon];
        const disabled = readOnly && (t.id === 'note' || t.id === 'image');
        return (
          <span key={t.id} style={{ display: 'contents' }}>
            {i === 4 && <div className="toolsep" />}
            <button
              className={`tool${t.id === 'line' && lineMode ? ' on' : ''}`}
              title={disabled ? `${t.label}: not available in a read-only repo` : `${t.tip}\nClick to add · or drag onto the board`}
              data-tool={t.id}
              disabled={disabled}
              draggable={!disabled}
              onDragStart={(e) => {
                e.dataTransfer.setData(TOOL_MIME, t.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onTool(t.id)}
            >
              <Icon />
              {expanded && <span>{t.label}</span>}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

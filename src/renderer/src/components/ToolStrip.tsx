import { ToolIcons } from './icons';

const TOOLS = [
  { id: 'note', label: 'Note', icon: ToolIcons.Note, tooltip: 'Drag onto the board' },
  { id: 'board', label: 'Board', icon: ToolIcons.Board, tooltip: 'Drag onto the board' },
  { id: 'link', label: 'Link', icon: ToolIcons.Link, tooltip: 'Draw a link between cards' },
  { id: 'text', label: 'Text', icon: ToolIcons.Text, tooltip: 'Add a text card' },
  { id: 'image', label: 'Image', icon: ToolIcons.Image, tooltip: 'Add an image card' },
  { id: 'todo', label: 'To-do', icon: ToolIcons.Todo, tooltip: 'Add a to-do card' },
  { id: 'column', label: 'Column', icon: ToolIcons.Column, tooltip: 'Add a column' },
  { id: 'sketch', label: 'Sketch', icon: ToolIcons.Sketch, tooltip: 'Add a sketch' },
  { id: 'import', label: 'Import', icon: ToolIcons.Import, tooltip: 'Import from file' },
];

interface ToolStripProps {
  expanded: boolean;
  onToggle: () => void;
}

export function ToolStrip({ expanded, onToggle }: ToolStripProps) {
  return (
    <nav className="tools" aria-label="Board tools" style={{ width: expanded ? 72 : 44 }}>
      {TOOLS.map((tool) => (
        <div
          key={tool.id}
          className="tool"
          title={tool.tooltip}
          style={{ opacity: 0.5, pointerEvents: 'none' }}
        >
          <tool.icon />
          {expanded && <span className="label">{tool.label}</span>}
        </div>
      ))}
      <div className="toolsep" />
      <div
        className="tool"
        onClick={onToggle}
        title={expanded ? 'Collapse tool strip' : 'Expand tool strip'}
        style={{ cursor: 'col-resize', opacity: 1, pointerEvents: 'auto' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ width: 22, height: 22 }}>
          {expanded ? (
            <>
              <path d="M15 3h6v6" />
              <path d="M9 3H3v6" />
              <path d="M15 15h6v6" />
              <path d="M9 15H3v6" />
            </>
          ) : (
            <>
              <path d="M9 3H3v6" />
              <path d="M15 3h6v6" />
              <path d="M9 15H3v6" />
              <path d="M15 15h6v6" />
            </>
          )}
        </svg>
        {expanded && <span className="label">{expanded ? 'Collapse' : 'Expand'}</span>}
      </div>
    </nav>
  );
}
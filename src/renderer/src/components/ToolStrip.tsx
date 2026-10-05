// Milanote-style tool strip; all tools are disabled placeholders in M0 (Grok Bot).
import { ToolIcons } from './icons';

const TOOLS = ['Note', 'Board', 'Link', 'Text', 'Image', 'To-do', 'Column', 'Sketch'];

export function ToolStrip({ expanded, width }: { expanded: boolean; width: number }) {
  return (
    <nav className="tools" style={{ width }} aria-label="Tools">
      {TOOLS.map((t, i) => {
        const Icon = ToolIcons[t];
        return (
          <span key={t} style={{ display: 'contents' }}>
            {i === 3 && <div className="toolsep" />}
            <button className="tool" aria-disabled="true" title={`${t} — Coming in M2`}>
              <Icon />
              {expanded && <span>{t}</span>}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

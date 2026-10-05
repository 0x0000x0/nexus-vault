// Shared pane chrome (Grok Bot).
import { MaxIcon, RestoreIcon } from './icons';

export function MaxBtn({ single, onMax }: { single: boolean; onMax: () => void }) {
  return (
    <button className="iconbtn" title={single ? 'Restore side-by-side' : 'Maximize pane'} onClick={onMax}>
      {single ? <RestoreIcon /> : <MaxIcon />}
    </button>
  );
}

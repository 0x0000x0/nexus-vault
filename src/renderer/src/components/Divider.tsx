// Draggable vertical divider using pointer capture (Grok Bot).
import { useRef, useState } from 'react';

interface Props {
  onStart?: () => void;
  onDrag: (dx: number) => void;
  onEnd?: (dx: number) => void;
  onReset: () => void;
  title?: string;
  thin?: boolean;
  testId?: string;
}

export function Divider({ onStart, onDrag, onEnd, onReset, title, thin, testId }: Props) {
  const startX = useRef(0);
  const [drag, setDrag] = useState(false);
  return (
    <div
      className={`divider${thin ? ' thin' : ''}${drag ? ' drag' : ''}`}
      role="separator"
      aria-orientation="vertical"
      title={title ?? 'Drag to resize · double-click to reset'}
      data-testid={testId}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        startX.current = e.clientX;
        setDrag(true);
        document.body.classList.add('resizing');
        onStart?.();
      }}
      onPointerMove={(e) => {
        if (drag) onDrag(e.clientX - startX.current);
      }}
      onPointerUp={(e) => {
        if (!drag) return;
        setDrag(false);
        document.body.classList.remove('resizing');
        onEnd?.(e.clientX - startX.current);
      }}
      onDoubleClick={onReset}
    >
      <i />
    </div>
  );
}

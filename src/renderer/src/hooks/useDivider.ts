export function useDivider(
  direction: 'horizontal' | 'vertical',
  getSize: () => number,
  setSize: (px: number) => void,
  min: number,
  max: number,
  defaultSize: number
) {
  const [dragging, setDragging] = useState(false);

  const onMouseDown = (e: React.MouseEvent) => {
    setDragging(true);
    e.preventDefault();
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const pos = direction === 'horizontal' ? e.clientX : e.clientY;
      setSize(Math.max(min, Math.min(max, pos)));
    };
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, direction, setSize, min, max]);

  const onDoubleClick = () => setSize(defaultSize);

  return { dragging, onMouseDown, onDoubleClick };
}

import { useState, useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../../src/shared/types';
import { CARD, freeSlot, overlaps } from '../../src/renderer/src/components/board-utils';

describe('board-utils freeSlot', () => {
  it('places 500 notes in under 500ms', () => {
    const nodes: BoardNode[] = [];
    const t0 = Date.now();
    for (let i = 0; i < 500; i++) {
      const pos = freeSlot(nodes, CARD.note.w, CARD.note.h);
      nodes.push({ id: `n${i}`, type: 'note', x: pos.x, y: pos.y, w: CARD.note.w, h: CARD.note.h });
    }
    expect(Date.now() - t0).toBeLessThan(500);
    expect(nodes).toHaveLength(500);
    // Sanity: no two placed cards overlap.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(overlaps(nodes[i]!, nodes[j]!)).toBe(false);
      }
    }
  });
});

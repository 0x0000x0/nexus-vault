import { describe, expect, it } from 'vitest';
import { LARGE, autoScale, largeLabelDegree, pickInitialCam, shouldShowLabel } from '../../src/renderer/src/graphCam';

describe('graphCam', () => {
  it('autoScale steps', () => {
    expect(autoScale(100)).toBe(1);
    expect(autoScale(500)).toBe(1.2);
    expect(autoScale(1000)).toBe(1.4);
    expect(autoScale(2000)).toBe(1.6);
  });

  it('pickInitialCam prefers selected then highest degree', () => {
    const nodes = [
      { id: 'a', degree: 10, x: 1, y: 1, folder: 'A' },
      { id: 'b', degree: 50, x: 5, y: 5, folder: 'B' },
      { id: 'g', degree: 99, ghost: true, x: 9, y: 9 },
    ];
    expect(pickInitialCam(nodes)?.x).toBe(5);
    expect(pickInitialCam(nodes, { selected: 'a' })?.x).toBe(1);
    expect(pickInitialCam(nodes, { folderFocus: 'A' })?.x).toBe(1);
  });

  it('largeLabelDegree tighter for big graphs', () => {
    const deg = Array.from({ length: 1000 }, (_, i) => 1000 - i);
    expect(largeLabelDegree(deg, 100)).toBeGreaterThanOrEqual(4);
    const big = largeLabelDegree(deg, 2000);
    expect(big).toBe(deg[Math.min(24, Math.floor(2000 * 0.03) - 1)]);
  });

  it('shouldShowLabel gates large graphs', () => {
    expect(shouldShowLabel({ n: LARGE, scale: 0.5, degree: 100, labelDegree: 10, important: false, showLabels: true })).toBe(false);
    expect(shouldShowLabel({ n: LARGE, scale: 1.5, degree: 100, labelDegree: 10, important: false, showLabels: true })).toBe(true);
    expect(shouldShowLabel({ n: 10, scale: 2, degree: 1, labelDegree: 4, important: false, showLabels: true })).toBe(true);
    expect(shouldShowLabel({ n: 10, scale: 1, degree: 1, labelDegree: 4, important: true, showLabels: true })).toBe(true);
  });
});

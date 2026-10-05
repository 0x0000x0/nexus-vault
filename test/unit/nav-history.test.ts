import { describe, expect, it } from 'vitest';
import { createNav, push, back, forward, replace, canBack, canForward, sameSnap, type NavState, type NavSnap, type Cam } from '../../src/renderer/src/nav-history';

describe('nav-history', () => {
  const defaultCap = 100;
  const smallCap = 3;

  function makeState(cap: number = defaultCap): NavState {
    return createNav(cap);
  }

  function makeSnap(
    over: Partial<NavSnap> = {},
  ): NavSnap {
    return {
      boardFolder: 'test-folder',
      boardView: { x: 0, y: 0, k: 1 },
      graphCam: { x: 0, y: 0, k: 1 },
      selected: null,
      openRel: null,
      notePanelOpen: false,
      ...over,
    };
  }

  describe('createNav', () => {
    it('creates a state with default cap of 100', () => {
      const s = createNav();
      expect(s.cap).toBe(100);
    });

    it('creates a state with a custom cap', () => {
      const s = createNav(50);
      expect(s.cap).toBe(50);
    });
  });

  describe('push', () => {
    it('skips if the new snap is identical to the current one', () => {
      const s = makeState();
      const result = push(s, makeSnap());
      expect(result.stack.length).toBe(1);
      expect(result.index).toBe(0);
    });

    it('truncates forward stack after push', () => {
      const s = makeState();
      let r = push(s, makeSnap({ boardView: { x: 1, y: 0, k: 1 } }));
      expect(r.stack.length).toBe(1);
      expect(r.index).toBe(0);

      r = push(r, makeSnap({ boardView: { x: 2, y: 0, k: 1 } }));
      expect(r.stack.length).toBe(2);
      expect(r.index).toBe(1);

      r = push(r, makeSnap({ boardView: { x: 2, y: 0, k: 1 } }));
      expect(r.stack.length).toBe(2);
      expect(r.index).toBe(1);
    });

    it('caps the stack size', () => {
      const s = makeState(smallCap);
      let r = push(s, makeSnap({ boardView: { x: 1, y: 0, k: 1 } }));
      for (let i = 1; i < smallCap; i++) {
        r = push(r, makeSnap({ boardView: { x: i + 1, y: 0, k: 1 } }));
        expect(r.stack.length).toBe(i + 1);
      }
      r = push(r, makeSnap({ boardView: { x: 10, y: 0, k: 1 } }));
      expect(r.stack.length).toBe(smallCap);
      expect(r.index).toBe(smallCap - 1);
    });

    it('drops oldest entries when capping', () => {
      const s = makeState(3);
      let r = push(s, makeSnap({ boardView: { x: 1, y: 0, k: 1 } }));
      r = push(r, makeSnap({ boardView: { x: 2, y: 0, k: 1 } }));
      r = push(r, makeSnap({ boardView: { x: 3, y: 0, k: 1 } }));
      expect(r.stack.length).toBe(3);
      expect(r.index).toBe(2);

      r = push(r, makeSnap({ boardView: { x: 4, y: 0, k: 1 } }));
      expect(r.stack.length).toBe(3);
      expect(r.index).toBe(2);
      expect(r.stack[0].boardView.x).toBe(2);
      expect(r.stack[1].boardView.x).toBe(3);
      expect(r.stack[2].boardView.x).toBe(4);
    });
  });

  describe('back', () => {
    it('returns null when index is 0 or negative', () => {
      expect(back(makeState())).toBeNull();
    });

    it('moves back one step and returns the snapshot', () => {
      const s = makeState();
      let r = push(s, makeSnap({ boardView: { x: 1, y: 0, k: 1 } }));
      r = push(r, makeSnap({ boardView: { x: 2, y: 0, k: 1 } }));
      r = push(r, makeSnap({ boardView: { x: 3, y: 0, k: 1 } }));
      const result = back(r);
      expect(result).not.toBeNull();
      expect(result!.snap.boardView.x).toBe(2);
      expect(result!.state.index).toBe(1);
    });
  });

  describe('forward', () => {
    it('returns null when index is at the end', () => {
      const s = makeState();
      push(s, makeSnap({ boardView: { x: 1, y: 0, k: 1 } }));
      expect(forward(s)).toBeNull();
    });

    it('moves forward one step and returns the snapshot', () => {
      // Construct state: index=1, stack=[snap1, snap2, snap3] so forward goes to index 2
      const t: NavState = { stack: [makeSnap({ boardView: { x: 1, y: 0, k: 1 } }), makeSnap({ boardView: { x: 2, y: 0, k: 1 } }), makeSnap({ boardView: { x: 3, y: 0, k: 1 } })], index: 1, cap: 100 };
      const result = forward(t);
      expect(result).not.toBeNull();
expect(result!.snap.boardView.x).toBe(3);
expect(result!.state.index).toBe(2);
    });
  });

  describe('canBack', () => {
    it('returns true when index > 0', () => {
      const s = makeState(100);
      s.index = 5;
      expect(canBack(s)).toBe(true);
    });

    it('returns false when index is 0', () => {
      const s = makeState(100) as NavState & { index: number };
      s.index = 0;
      expect(canBack(s)).toBe(false);
    });

    it('returns false when index is -1', () => {
      const s = makeState(100) as NavState & { index: number };
      s.index = -1;
      expect(canBack(s)).toBe(false);
    });
  });

  describe('canForward', () => {
    it('returns true when index < stack.length - 1', () => {
      const s: NavState = { stack: [makeSnap({ boardView: { x: 1, y: 0, k: 1 } }), makeSnap({ boardView: { x: 2, y: 0, k: 1 } })], index: 0, cap: 100 };
      expect(canForward(s)).toBe(true);
    });

    it('returns false when index is at the last element', () => {
      const s: NavState = { stack: [makeSnap({ boardView: { x: 1, y: 0, k: 1 } }), makeSnap({ boardView: { x: 2, y: 0, k: 1 } })], index: 1, cap: 100 };
      expect(canForward(s)).toBe(false);
    });

    it('returns false when index is -1 and stack is empty', () => {
      const s: NavState = { stack: [], index: -1, cap: 100 };
      expect(canForward(s)).toBe(false);
    });
  });

  describe('sameSnap', () => {
    it('returns true for identical snaps', () => {
      const a = makeSnap();
      const b = makeSnap();
      expect(sameSnap(a, b)).toBe(true);
    });

    it('returns false when graphCam differs', () => {
      const a = makeSnap({ graphCam: { x: 1, y: 0, k: 1 } });
      const b = makeSnap({ graphCam: { x: 0, y: 0, k: 1 } });
      expect(sameSnap(a, b)).toBe(false);
    });

    it('returns false when boardView differs', () => {
      const a = makeSnap({ boardView: { x: 1, y: 0, k: 1 } });
      const b = makeSnap({ boardView: { x: 0, y: 0, k: 1 } });
      expect(sameSnap(a, b)).toBe(false);
    });
  });
});
describe('nav-history replace', () => {
  const snap = (x: number, rel: string | null = null): NavSnap => ({ boardFolder: '', boardView: { x, y: 0, k: 1 }, graphCam: { x: 0, y: 0, k: 1 }, selected: null, openRel: rel, notePanelOpen: !!rel });
  it('pushes when empty', () => {
    const s = replace(createNav(), snap(1));
    expect(s.index).toBe(0);
    expect(s.stack.length).toBe(1);
  });
  it('updates current entry in place and keeps forward entries', () => {
    let s = createNav();
    s = push(s, snap(1));
    s = push(s, snap(2));
    s = push(s, snap(3));
    s = back(s)!.state; // index 1
    s = replace(s, snap(22, 'a.md'));
    expect(s.index).toBe(1);
    expect(s.stack.length).toBe(3);
    expect(s.stack[1].boardView.x).toBe(22);
    expect(s.stack[1].openRel).toBe('a.md');
    expect(canForward(s)).toBe(true);
  });
});

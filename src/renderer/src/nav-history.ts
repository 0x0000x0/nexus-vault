// Pure history stack for board+graph view navigation (Alt+Left/Right, pane buttons).
// No React dependencies — plain TS types + functions.

export type Cam = { x: number; y: number; k: number };

export interface NavSnap {
  boardFolder: string;
  boardView: Cam;
  graphCam: Cam;
  selected: string | null;
  openRel: string | null;
  notePanelOpen: boolean;
}

export type NavState = { stack: NavSnap[]; index: number; cap: number };

/** Create a new history stack with given cap (default 100). */
export function createNav(cap = 100): NavState {
  return { stack: [], index: -1, cap };
}

/** Snapshots are identical if all fields match (shallow). */
export function sameSnap(a: NavSnap, b: NavSnap): boolean {
  return (
    a.boardFolder === b.boardFolder &&
    a.boardView.x === b.boardView.x &&
    a.boardView.y === b.boardView.y &&
    a.boardView.k === b.boardView.k &&
    a.graphCam.x === b.graphCam.x &&
    a.graphCam.y === b.graphCam.y &&
    a.graphCam.k === b.graphCam.k &&
    a.selected === b.selected &&
    a.openRel === b.openRel &&
    a.notePanelOpen === b.notePanelOpen
  );
}

/** Truncate forward stack, skip if same as current, cap at `state.cap`. */
export function push(state: NavState, snap: NavSnap): NavState {
  // Skip if the new snap is identical to the current one.
  if (state.index >= 0 && sameSnap(state.stack[state.index], snap)) {
    return state;
  }
  // Truncate forward stack (everything after the current index).
  const newStack = state.index + 1 < state.stack.length ? state.stack.slice(0, state.index + 1) : [...state.stack];
  const newIndex = newStack.length;
  const newState = { ...state, stack: [...newStack, snap], index: newIndex };
  // Cap the stack size.
  if (newState.stack.length > state.cap) {
    newState.stack = newState.stack.slice(newState.stack.length - state.cap);
    newState.index = newState.stack.length - 1;
  }
  return newState;
}

/** Update the current entry in place (like history.replaceState): forward entries are kept. Pushes if empty. */
export function replace(state: NavState, snap: NavSnap): NavState {
  if (state.index < 0) return push(state, snap);
  if (sameSnap(state.stack[state.index], snap)) return state;
  const stack = [...state.stack];
  stack[state.index] = snap;
  return { ...state, stack };
}

/** Move one step back, returning new state + the snapshot that was made active. */
export function back(state: NavState): { state: NavState; snap: NavSnap } | null {
  if (state.index <= 0) return null;
  const newIndex = state.index - 1;
  const snap = state.stack[newIndex];
  return { state: { ...state, index: newIndex }, snap };
}

/** Move one step forward, returning new state + the snapshot that was made active. */
export function forward(state: NavState): { state: NavState; snap: NavSnap } | null {
  if (state.index < 0 || state.index >= state.stack.length - 1) return null;
  const newIndex = state.index + 1;
  const snap = state.stack[newIndex];
  return { state: { ...state, index: newIndex }, snap };
}

/** Check if can go back. */
export function canBack(s: NavState): boolean {
  return s.index > 0;
}

/** Check if can go forward. */
export function canForward(s: NavState): boolean {
  return s.index >= 0 && s.index < s.stack.length - 1;
}

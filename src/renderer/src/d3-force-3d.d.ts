// Minimal types for the d3-force-3d subset used by the layout worker (no upstream types).
declare module 'd3-force-3d' {
  interface Sim {
    force(name: string, f: unknown): Sim;
    alphaDecay(v: number): Sim;
    stop(): Sim;
    tick(n?: number): Sim;
  }
  export function forceSimulation(nodes: unknown[], numDimensions?: number): Sim;
  export function forceLink(links: unknown[]): { distance(d: number): unknown };
  export function forceManyBody(): { strength(s: number): unknown };
  export function forceCenter(): unknown;
}

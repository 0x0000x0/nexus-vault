// 0.0.9 speed: force layout off the UI thread. Same forces/parameters as force-graph's built-in engine
// (d3-force-3d in 2D: link distance 40, many-body charge, center), streamed back as Float32Arrays. Grok Bot.
import { forceCenter, forceLink, forceManyBody, forceSimulation } from 'd3-force-3d';

export interface LayoutJob {
  job: number;
  xs: Float64Array; // NaN = no position yet
  ys: Float64Array;
  links: Uint32Array; // [s0, t0, s1, t1, ...] node indices
  charge: number;
  alphaDecay: number;
  ticks: number;
  every: number; // post positions every N ticks
}
export interface LayoutMsg {
  job: number;
  xs: Float32Array;
  ys: Float32Array;
  done: boolean;
}

interface SimNode {
  index: number;
  x?: number;
  y?: number;
}

let current = 0;
self.onmessage = (e: MessageEvent<LayoutJob | { cancel: number }>) => {
  if ('cancel' in e.data) {
    if (current === e.data.cancel) current = 0;
    return;
  }
  const j = e.data;
  current = j.job;
  const n = j.xs.length;
  const nodes: SimNode[] = Array.from({ length: n }, (_, i) => (Number.isNaN(j.xs[i]) ? { index: i } : { index: i, x: j.xs[i], y: j.ys[i] }));
  const links: { source: number; target: number }[] = [];
  for (let i = 0; i < j.links.length; i += 2) links.push({ source: j.links[i], target: j.links[i + 1] });
  const sim = forceSimulation(nodes, 2)
    .force('link', forceLink(links).distance(40))
    .force('charge', forceManyBody().strength(j.charge))
    .force('center', forceCenter())
    .alphaDecay(j.alphaDecay)
    .stop();
  const post = (done: boolean) => {
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = nodes[i].x ?? 0;
      ys[i] = nodes[i].y ?? 0;
    }
    (self as unknown as Worker).postMessage({ job: j.job, xs, ys, done } satisfies LayoutMsg, [xs.buffer, ys.buffer]);
  };
  let t = 0;
  // Ticks run in slices so a newer job (or cancel) can preempt this one.
  const slice = () => {
    if (current !== j.job) return;
    const end = Math.min(j.ticks, t + j.every);
    for (; t < end; t++) sim.tick();
    const done = t >= j.ticks;
    post(done);
    if (!done) setTimeout(slice, 0);
    else current = 0;
  };
  slice();
};

import { useRef, useEffect } from 'react';

interface GraphPaneProps {
  maximized: boolean;
  onCloseMaximize: () => void;
}

export function GraphPane({ maximized, onCloseMaximize }: GraphPaneProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = svgRef.current;
    const width = svg.clientWidth || 400;
    const height = svg.clientHeight || 400;

    // Draw a simple decorative graph
    const groups = [
      { color: 'var(--c-purple)', angle: -1.9, count: 14 },
      { color: 'var(--c-green)', angle: -0.2, count: 11 },
      { color: 'var(--c-orange)', angle: 1.1, count: 10 },
      { color: 'var(--c-blue)', angle: 2.4, count: 12 },
      { color: 'var(--faint)', angle: 3.5, count: 16 },
    ];

    const scale = Math.min(width, height) / 2.6;
    const cx = width / 2;
    const cy = height / 2 + 10;

    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };

    const nodes: Array<{ x: number; y: number; color: string; hub: boolean; size: number }> = [];
    const hubs: number[] = [];

    groups.forEach((g, gi) => {
      const gx = cx + Math.cos(g.angle) * scale * 0.62;
      const gy = cy + Math.sin(g.angle) * scale * 0.62;
      for (let i = 0; i < g.count; i++) {
        const r = i === 0 ? 0 : 18 + rnd() * scale * 0.42;
        const t = rnd() * Math.PI * 2;
        const isHub = i === 0;
        nodes.push({
          x: gx + Math.cos(t) * r,
          y: gy + Math.sin(t) * r,
          color: g.color,
          hub: isHub,
          size: isHub ? 9 : 2.6 + rnd() * 3.4,
        });
        if (isHub) hubs.push(nodes.length - 1);
      }
    });

    const links: Array<[number, number]> = [];
    nodes.forEach((n, i) => {
      if (!n.hub) {
        const hub = nodes.findIndex((m) => m.hub && Math.abs(m.x - n.x) < scale && Math.abs(m.y - n.y) < scale);
        if (hub >= 0) links.push([i, hub]);
      }
      if (rnd() < 0.35) {
        const j = Math.floor(rnd() * nodes.length);
        if (j !== i) links.push([i, j]);
      }
    });
    for (let i = 0; i < hubs.length; i++) {
      links.push([hubs[i], hubs[(i + 1) % hubs.length]]);
    }

    let svgContent = '<defs>';
    svgContent += '<marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">';
    svgContent += '<path d="M0 0L10 5L0 10z" fill="var(--line)"/>';
    svgContent += '</marker>';
    svgContent += '</defs>';

    links.forEach(([a, b]) => {
      const A = nodes[a];
      const B = nodes[b];
      svgContent += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="var(--line)" stroke-opacity="0.35" stroke-width="0.9"/>`;
    });

    nodes.forEach((n, i) => {
      const isSel = hubs[3] === i;
      svgContent += `<circle cx="${n.x}" cy="${n.y}" r="${isSel ? 11 : n.size}" fill="${n.color}" ${isSel ? 'stroke="var(--text)" stroke-width="2"' : ''} opacity="${n.hub || isSel ? 1 : 0.85}"/>`;
    });

    const labels = ['Projects', 'Health', 'Finance', 'Ideas', 'Daily Notes'];
    hubs.forEach((h, k) => {
      const n = nodes[h];
      svgContent += `<text x="${n.x}" y="${n.y + (k === 3 ? 26 : 22)}" text-anchor="middle" font-size="${k === 3 ? 12 : 11}" font-weight="${k === 3 ? 700 : 500}" fill="var(--text)" opacity="0.9">${labels[k]}</text>`;
    });

    svg.innerHTML = svgContent;
  }, [maximized]);

  return (
    <section className="pane" style={{ flex: maximized ? '1' : 'none', width: maximized ? '100%' : undefined }}>
      <div className="panehead">
        <b>Graph</b>
        <span>· {maximized ? 'Maximized' : 'Graph view arrives in M1'}</span>
        <div className="r">
          <button className="iconbtn" title="Local graph">◎</button>
          <button className="iconbtn max" title={maximized ? 'Restore' : 'Maximize'} onClick={onCloseMaximize}>
            {maximized ? '⤡' : '⤢'}
          </button>
        </div>
      </div>
      <div className="graphbg">
        <svg ref={svgRef} width="100%" height="100%" />
      </div>
    </section>
  );
}
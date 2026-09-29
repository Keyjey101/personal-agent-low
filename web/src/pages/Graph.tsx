import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface Ent { id: number; kind: string; name: string; description: string }
interface Edge { from: number; to: number; relation: string }

/** Простая круговая раскладка графа знаний на SVG. */
export function GraphPage() {
  const [entities, setEntities] = useState<Ent[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<{ entities: Ent[]; edges: Edge[] }>('/api/entities')
      .then((d) => { setEntities(d.entities); setEdges(d.edges); })
      .catch((e) => setMsg((e as Error).message));
  }, []);

  const W = 900, H = 520, R = 200;
  const pos = new Map<number, { x: number; y: number }>();
  entities.forEach((e, i) => {
    const a = (2 * Math.PI * i) / Math.max(entities.length, 1) - Math.PI / 2;
    pos.set(e.id, { x: W / 2 + R * Math.cos(a), y: H / 2 + R * Math.sin(a) });
  });

  return (
    <div>
      <div className="card">
        <h2>Граф знаний</h2>
        {entities.length ? (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
            {edges.map((ed, i) => {
              const a = pos.get(ed.from), b = pos.get(ed.to);
              if (!a || !b) return null;
              return (
                <g key={i}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2a3342" strokeWidth={1.5} />
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} fill="#8a97a8" fontSize={9} textAnchor="middle">{ed.relation}</text>
                </g>
              );
            })}
            {entities.map((e) => {
              const p = pos.get(e.id)!;
              return (
                <g key={e.id}>
                  <circle cx={p.x} cy={p.y} r={5} fill="#4da3ff" />
                  <text x={p.x} y={p.y - 10} fill="#dbe4f0" fontSize={12} textAnchor="middle">{e.name}</text>
                  <text x={p.x} y={p.y + 18} fill="#8a97a8" fontSize={9} textAnchor="middle">{e.kind}</text>
                </g>
              );
            })}
          </svg>
        ) : <div className="dim">Пока пусто.</div>}
      </div>
      {msg && <div className="error small">{msg}</div>}
    </div>
  );
}

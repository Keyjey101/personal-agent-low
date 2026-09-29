import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtTime } from '../api';

interface Mem { id: number; kind: string; content: string; source: string; is_active: boolean; created_at: string }

export function MemoryPage() {
  const [items, setItems] = useState<Mem[]>([]);
  const [kind, setKind] = useState('preference');
  const [content, setContent] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => api<Mem[]>('/api/memory').then(setItems).catch((e) => setMsg((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (content.trim().length < 3) return;
    await api('/api/memory', { method: 'POST', body: { kind, content } });
    setContent('');
    await load();
  };

  const toggle = async (m: Mem) => {
    await api(`/api/memory/${m.id}`, { method: 'PATCH', body: { is_active: !m.is_active } });
    await load();
  };

  return (
    <div>
      <div className="card">
        <h2>Добавить в память</h2>
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {['preference', 'fact', 'insight', 'routine', 'pattern'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input className="grow" placeholder="Например: вечером мне проще делать бытовые задачи" value={content} onChange={(e) => setContent(e.target.value)} />
          <button className="primary" onClick={() => void add()}>Запомнить</button>
        </div>
      </div>
      <div className="card">
        <h2>Что система помнит</h2>
        <table>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} style={{ opacity: m.is_active ? 1 : 0.4 }}>
                <td><span className="badge">{m.kind}</span></td>
                <td>{m.content}</td>
                <td className="dim small">{m.source} · {fmtTime(m.created_at)}</td>
                <td><button className="small" onClick={() => void toggle(m)}>{m.is_active ? 'выключить' : 'включить'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className="error small">{msg}</div>}
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtTime } from '../api';

interface Ev { id: number; ts: string; type: string; task_id: number | null; text: string | null; payload: Record<string, unknown> }

const TYPES = ['', 'USER_MESSAGE', 'AGENT_MESSAGE', 'TASK_COMPLETED', 'TASK_CREATED', 'PROACTIVE_SENT',
  'PROACTIVE_SUPPRESSED', 'REMINDER_FIRED', 'STATE_RECORDED', 'SESSION_START', 'SESSION_END',
  'BACKUP_DONE', 'SYSTEM_ERROR', 'GLM_UNAVAILABLE'];

export function ActivityPage() {
  const [events, setEvents] = useState<Ev[]>([]);
  const [type, setType] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    const q = type ? `?type=${encodeURIComponent(type)}&limit=200` : '?limit=200';
    api<Ev[]>(`/api/events${q}`).then(setEvents).catch((e) => setMsg((e as Error).message));
  }, [type]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <h2 className="grow" style={{ margin: 0 }}>Журнал событий</h2>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t || 'все типы'}</option>)}
        </select>
      </div>
      <table>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="dim small" style={{ whiteSpace: 'nowrap' }}>{fmtTime(e.ts)}</td>
              <td><span className="badge">{e.type}</span></td>
              <td className="small">
                {e.text ??
                  (Object.keys(e.payload ?? {}).length ? JSON.stringify(e.payload).slice(0, 120) : '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {msg && <div className="error small">{msg}</div>}
    </div>
  );
}

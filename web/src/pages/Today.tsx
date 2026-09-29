import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface StateResp {
  time: { dateStr: string };
  state: { energy: number | null; available_minutes: number | null; intoxication: string | null; recorded_at: string } | null;
  completed_today: number;
  next: { id: number; title: string; project: string | null; est_min: number | null; reasons: string[] }[];
  session: { ends_at: string; completed_count: number } | null;
  muted_topics: { topic: string; mutedUntil: string }[];
}

export function TodayPage() {
  const [data, setData] = useState<StateResp | null>(null);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ energy: 5, available_minutes: 60, intoxication: 'none' });

  const load = useCallback(() => api<StateResp>('/api/state').then(setData).catch((e) => setMsg((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);

  const act = async (path: string, body?: unknown) => {
    try {
      await api(path, { method: 'POST', body });
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  if (!data) return <div className="dim">{msg || '…'}</div>;
  const top = data.next[0];

  return (
    <div>
      <div className="card">
        <h2>Сейчас</h2>
        <div className="row">
          <span>{data.time.dateStr}</span>
          <span className="dim">сегодня сделано: <b>{data.completed_today}</b></span>
          {data.session && <span className="badge critical">сессия до {new Date(data.session.ends_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}, выполнено {data.session.completed_count}</span>}
          {data.state && <span className="dim">энергия {data.state.energy ?? '?'}/10{data.state.available_minutes != null ? `, ${data.state.available_minutes} мин` : ''}{data.state.intoxication && data.state.intoxication !== 'none' ? `, ${data.state.intoxication}` : ''}</span>}
        </div>
        {top ? (
          <>
            <div className="big-action">{top.title}</div>
            <div className="dim small">
              ~{top.est_min ?? '?'} мин{top.project ? ` · ${top.project}` : ''}{top.reasons.length ? ` · ${top.reasons.join(', ')}` : ''}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" onClick={() => void act(`/api/tasks/${top.id}/complete`)}>✅ Сделал</button>
              <button onClick={() => void act(`/api/tasks/${top.id}/snooze`, { days: 1 })}>⏸ Потом</button>
            </div>
          </>
        ) : <div className="dim">Подходящих задач под текущее состояние нет.</div>}
      </div>

      <div className="card">
        <h2>Сообщить состояние</h2>
        <div className="row">
          <label className="small dim">энергия
            <input type="number" min={1} max={10} value={form.energy}
              onChange={(e) => setForm({ ...form, energy: Number(e.target.value) })} style={{ width: 70 }} />
          </label>
          <label className="small dim">свободно, мин
            <input type="number" min={5} max={720} value={form.available_minutes}
              onChange={(e) => setForm({ ...form, available_minutes: Number(e.target.value) })} style={{ width: 80 }} />
          </label>
          <label className="small dim">состояние
            <select value={form.intoxication} onChange={(e) => setForm({ ...form, intoxication: e.target.value })}>
              <option value="none">норма</option>
              <option value="mild">легкое опьянение</option>
              <option value="significant">сильное опьянение</option>
            </select>
          </label>
          <button onClick={() => void act('/api/state', form)}>Записать</button>
        </div>
      </div>

      <div className="card">
        <h2>Кандидаты</h2>
        {data.next.map((n) => (
          <div className="row" key={n.id} style={{ padding: '6px 0' }}>
            <span className="grow">{n.title}</span>
            <span className="dim small">~{n.est_min ?? '?'} мин{n.project ? ` · ${n.project}` : ''}</span>
            <button className="small" onClick={() => void act(`/api/tasks/${n.id}/complete`)}>готово</button>
          </div>
        ))}
      </div>

      {data.muted_topics.length > 0 && (
        <div className="card">
          <h2>Замученные темы</h2>
          {data.muted_topics.map((m) => (
            <div key={m.topic} className="small dim">{m.topic} — до {new Date(m.mutedUntil).toLocaleDateString('ru-RU')}</div>
          ))}
        </div>
      )}
      {msg && <div className="error small">{msg}</div>}
    </div>
  );
}

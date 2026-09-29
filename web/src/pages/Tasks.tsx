import React, { useCallback, useEffect, useState } from 'react';
import { api, Project, Task } from '../api';

const STATUSES = ['idea', 'todo', 'next', 'active', 'waiting', 'done', 'cancelled'];

export function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState('todo,next,active,waiting');
  const [form, setForm] = useState({ title: '', project_id: '', estimated_minutes: '' });
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    void api<Project[]>('/api/projects').then(setProjects);
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    api<Task[]>(`/api/tasks${q}`).then(setTasks).catch((e) => setMsg((e as Error).message));
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!form.title.trim()) return;
    try {
      await api('/api/tasks', {
        method: 'POST',
        body: {
          title: form.title,
          project_id: form.project_id ? Number(form.project_id) : null,
          estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
        },
      });
      setForm({ title: '', project_id: '', estimated_minutes: '' });
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  const patch = async (id: number, body: unknown) => {
    await api(`/api/tasks/${id}`, { method: 'PATCH', body });
    await load();
  };

  return (
    <div>
      <div className="card">
        <h2>Новая задача</h2>
        <div className="row">
          <input className="grow" placeholder="Что сделать" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
            <option value="">— входящие —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input placeholder="мин" style={{ width: 60 }} value={form.estimated_minutes} onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })} />
          <button className="primary" onClick={() => void create()}>Добавить</button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 className="grow" style={{ margin: 0 }}>Задачи</h2>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">все</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <table>
          <thead><tr><th>#</th><th>Задача</th><th>Проект</th><th>~мин</th><th>e</th><th>до</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="dim">{t.id}</td>
                <td>{t.title}</td>
                <td className="dim small">{t.project_name ?? '—'}</td>
                <td>{t.estimated_minutes ?? '—'}</td>
                <td>{t.energy_required ?? '—'}</td>
                <td className={'small ' + (t.due_at && t.due_at < new Date().toISOString().slice(0, 10) ? 'error' : 'dim')}>{t.due_at ?? ''}</td>
                <td>
                  <select value={t.status} onChange={(e) => void patch(t.id, { status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td>{t.status !== 'done' && <button className="small" onClick={() => void api(`/api/tasks/${t.id}/complete`, { method: 'POST' }).then(load)}>готово</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <div className="error small">{msg}</div>}
    </div>
  );
}

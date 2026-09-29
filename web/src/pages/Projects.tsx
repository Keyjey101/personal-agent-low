import React, { useCallback, useEffect, useState } from 'react';
import { api, Project, Task } from '../api';

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<{ project: Project; tasks: Task[]; blocked_task_ids: number[] } | null>(null);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => api<Project[]>('/api/projects').then(setProjects).catch((e) => setMsg((e as Error).message)), []);
  useEffect(() => { void load(); }, [load]);

  const open = async (id: number) => {
    setSelected(await api(`/api/projects/${id}`));
  };

  const setStatus = async (id: number, status: string) => {
    await api(`/api/projects/${id}`, { method: 'PATCH', body: { status } });
    await load();
    if (selected?.project.id === id) await open(id);
  };

  const create = async () => {
    if (!name.trim()) return;
    await api('/api/projects', { method: 'POST', body: { name } });
    setName('');
    await load();
  };

  return (
    <div>
      <div className="card">
        <h2>Новый проект</h2>
        <div className="row">
          <input className="grow" placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary" onClick={() => void create()}>Создать</button>
        </div>
      </div>

      <div className="card">
        <h2>Проекты</h2>
        <table>
          <thead><tr><th>Название</th><th>Область</th><th>Приоритет</th><th>Открыто</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td><a href="#" onClick={(e) => { e.preventDefault(); void open(p.id); }}>{p.name}</a></td>
                <td className="dim">{p.area}</td>
                <td>{p.priority}</td>
                <td>{p.open_tasks}</td>
                <td>
                  <select value={p.status} onChange={(e) => void setStatus(p.id, e.target.value)}>
                    {['active', 'paused', 'done', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td><button className="small" onClick={() => void open(p.id)}>задачи</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card">
          <h2>{selected.project.name} — задачи</h2>
          <table>
            <tbody>
              {selected.tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.title}
                    {selected.blocked_task_ids.includes(t.id) && <span className="badge" style={{ marginLeft: 8 }}>заблокировано</span>}
                    {t.status === 'next' && <span className="badge next" style={{ marginLeft: 8 }}>next</span>}
                  </td>
                  <td className="dim small">~{t.estimated_minutes ?? '?'} мин</td>
                  <td><span className="badge">{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && <div className="error small">{msg}</div>}
    </div>
  );
}

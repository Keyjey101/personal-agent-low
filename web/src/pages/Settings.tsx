import React, { useCallback, useEffect, useState } from 'react';
import { api, fmtSize } from '../api';

interface Backup { file: string; size: number; at: string }

export function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [backups, setBackups] = useState<Backup[]>([]);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    void api<Record<string, any>>('/api/settings').then(setSettings);
    void api<Backup[]>('/api/backups').then(setBackups);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    try {
      await api('/api/settings', { method: 'PATCH', body: settings });
      setMsg('Сохранено');
    } catch (e) { setMsg((e as Error).message); }
  };

  const set = (k: string, v: unknown) => setSettings({ ...settings, [k]: v });
  const setNested = (k: string, field: string, v: unknown) => set(k, { ...(settings[k] ?? {}), [field]: v });

  const backupNow = async () => {
    try {
      const r = await api<{ file: string; size: number }>('/api/backup', { method: 'POST' });
      setMsg(`Бэкап создан: ${r.file} (${fmtSize(r.size)})`);
      await load();
    } catch (e) { setMsg((e as Error).message); }
  };

  const lvl = Number(settings.proactivity_level ?? 2);
  const qh = settings.quiet_hours ?? { start: '23:00', end: '09:00' };
  const wh = settings.work_hours ?? { start: '07:00', end: '18:00', days: ['mon', 'tue', 'wed', 'thu', 'fri'] };
  const pb = settings.proactive_budget ?? { max_per_day: 2, min_interval_hours: 4, max_critical_work_per_day: 1 };

  return (
    <div>
      <div className="card">
        <h2>Проактивность</h2>
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="dim">Уровень: <b>{lvl}</b></span>
          <input type="range" min={0} max={4} value={lvl} onChange={(e) => set('proactivity_level', Number(e.target.value))} />
          <span className="small dim">{['выкл', 'только дедлайны', 'обычный', 'инициативный', 'коуч'][lvl]}</span>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="small dim">тихие часы
            <input type="time" value={qh.start} onChange={(e) => setNested('quiet_hours', 'start', e.target.value)} />
            —
            <input type="time" value={qh.end} onChange={(e) => setNested('quiet_hours', 'end', e.target.value)} />
          </label>
          <label className="small dim">рабочие часы
            <input type="time" value={wh.start} onChange={(e) => setNested('work_hours', 'start', e.target.value)} />
            —
            <input type="time" value={wh.end} onChange={(e) => setNested('work_hours', 'end', e.target.value)} />
          </label>
        </div>
        <div className="row small dim" style={{ marginBottom: 10 }}>
          дни рабочих часов:
          {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => (
            <label key={d}>
              <input type="checkbox" checked={(wh.days ?? []).includes(d)}
                onChange={(e) => setNested('work_hours', 'days',
                  e.target.checked ? [...(wh.days ?? []), d] : (wh.days ?? []).filter((x: string) => x !== d))}
              /> {d}
            </label>
          ))}
        </div>
        <div className="row">
          <label className="small dim">макс. сообщений/день
            <input type="number" min={0} max={10} value={pb.max_per_day} style={{ width: 60 }}
              onChange={(e) => setNested('proactive_budget', 'max_per_day', Number(e.target.value))} />
          </label>
          <label className="small dim">мин. интервал, ч
            <input type="number" min={1} max={24} value={pb.min_interval_hours} style={{ width: 60 }}
              onChange={(e) => setNested('proactive_budget', 'min_interval_hours', Number(e.target.value))} />
          </label>
          <label className="small dim">критичных в рабочие часы
            <input type="number" min={0} max={5} value={pb.max_critical_work_per_day} style={{ width: 60 }}
              onChange={(e) => setNested('proactive_budget', 'max_critical_work_per_day', Number(e.target.value))} />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Бэкапы</h2>
        <button className="primary" onClick={() => void backupNow()}>Сделать бэкап сейчас</button>
        <table style={{ marginTop: 10 }}>
          <tbody>
            {backups.map((b) => (
              <tr key={b.file}>
                <td><a href={`/api/backups/${b.file}`}>{b.file}</a></td>
                <td className="dim small">{fmtSize(b.size)}</td>
              </tr>
            ))}
            {!backups.length && <tr><td className="dim">пока нет</td></tr>}
          </tbody>
        </table>
      </div>

      <button className="primary" onClick={() => void save()}>Сохранить настройки</button>
      {msg && <div className="small dim" style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

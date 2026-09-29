import React, { useEffect, useState } from 'react';
import { api, UnauthorizedError } from './api';
import { LoginPage } from './pages/Login';
import { TodayPage } from './pages/Today';
import { ProjectsPage } from './pages/Projects';
import { TasksPage } from './pages/Tasks';
import { GraphPage } from './pages/Graph';
import { MemoryPage } from './pages/Memory';
import { ActivityPage } from './pages/Activity';
import { SettingsPage } from './pages/Settings';

const PAGES = ['today', 'projects', 'tasks', 'graph', 'memory', 'activity', 'settings'] as const;
type Page = typeof PAGES[number];
const TITLES: Record<Page, string> = {
  today: 'Сегодня', projects: 'Проекты', tasks: 'Задачи', graph: 'Граф знаний',
  memory: 'Память', activity: 'Активность', settings: 'Настройки',
};

export function App() {
  const [page, setPage] = useState<Page>('today');
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    api('/api/state').then(() => setAuthed(true)).catch((e) => {
      setAuthed(e instanceof UnauthorizedError);
    });
  }, []);

  if (authed === null) return <div className="center">…</div>;
  if (!authed) return <LoginPage onOk={() => setAuthed(true)} />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Диспетчер</h1>
        <nav>
          {PAGES.map((p) => (
            <button key={p} className={page === p ? 'active' : ''} onClick={() => setPage(p)}>{TITLES[p]}</button>
          ))}
        </nav>
        <button className="logout" onClick={() => { document.cookie = 'sid=; max-age=0'; location.reload(); }}>Выйти</button>
      </aside>
      <main>
        {page === 'today' && <TodayPage />}
        {page === 'projects' && <ProjectsPage />}
        {page === 'tasks' && <TasksPage />}
        {page === 'graph' && <GraphPage />}
        {page === 'memory' && <MemoryPage />}
        {page === 'activity' && <ActivityPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

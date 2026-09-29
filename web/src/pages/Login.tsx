import React, { useState } from 'react';
import { api } from '../api';

export function LoginPage({ onOk }: { onOk: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: { password } });
      onOk();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card login-box" onSubmit={submit}>
      <h1>Диспетчер</h1>
      <input
        type="password" placeholder="Пароль" value={password} autoFocus
        onChange={(e) => setPassword(e.target.value)} style={{ width: '100%' }}
      />
      {error && <div className="error small" style={{ marginTop: 8 }}>{error}</div>}
      <button className="primary" style={{ marginTop: 12, width: '100%' }} disabled={busy || !password}>
        {busy ? '…' : 'Войти'}
      </button>
    </form>
  );
}

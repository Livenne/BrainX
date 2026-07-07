import { FormEvent, useState } from 'react';
import { loginUser, registerUser } from '../services/brainxApi';
import { useAuth } from '../state/auth';
import './pages.css';

export function AuthPage() {
  const auth = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = mode === 'login'
        ? await loginUser(username, password)
        : await registerUser(username, password);
      auth.setAuth(response.token, response.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-panel" onSubmit={handleSubmit}>
        <div>
          <h1>brainx</h1>
          <p>Sign in to bind local clients and run the agent loop.</p>
        </div>
        <label className="field-stack">
          <span>Username</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label className="field-stack">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <div role="alert">{error}</div> : null}
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? 'Working...' : mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => setMode((current) => (current === 'login' ? 'register' : 'login'))}
        >
          {mode === 'login' ? 'Create a new account' : 'Use an existing account'}
        </button>
      </form>
    </main>
  );
}

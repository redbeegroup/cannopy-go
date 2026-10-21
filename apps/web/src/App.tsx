import { formatKyat } from '@cannopy/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { localDb } from './db/local';

type ServerState = 'checking' | 'ok' | 'degraded' | 'unreachable';

export function App() {
  const { t, i18n } = useTranslation();
  const language = i18n.language === 'en' ? 'en' : 'my';
  const online = useOnline();
  const server = useServerHealth(online);
  const pending = useLiveQuery(() => localDb.outbox.count(), [], 0);

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>{t('app.name')}</h1>
          <div className="muted">{t('app.tagline')}</div>
        </div>
        <button
          type="button"
          className="lang-toggle"
          onClick={() => i18n.changeLanguage(language === 'en' ? 'my' : 'en')}
          aria-label={t('language.switch')}
        >
          {t('language.switch')}
        </button>
      </header>

      <div className={`status ${online ? 'online' : 'offline'}`} role="status">
        <span className="dot" />
        <span>
          {online ? t('status.online') : t('status.offline')}{' '}
          {pending > 0 ? `· ${t('status.pending', { count: pending })}` : null}
          {online ? ` · ${t('status.server', { state: server })}` : null}
        </span>
      </div>

      <section className="actions" aria-label="main actions">
        <button type="button" className="big-button">
          {t('actions.sell')}
        </button>
        <button type="button" className="big-button">
          {t('actions.spend')}
        </button>
        <button type="button" className="big-button">
          {t('actions.get_paid')}
        </button>
      </section>

      <section className="card">
        <h2>{t('home.money_today')}</h2>
        <div className="amount">{formatKyat(0, { language })}</div>
      </section>
      <section className="card">
        <h2>{t('home.who_owes_me')}</h2>
        <div className="amount">{formatKyat(0, { language })}</div>
      </section>
      <section className="card">
        <h2>{t('home.profit_this_month')}</h2>
        <div className="amount">{formatKyat(0, { language })}</div>
      </section>

      <p className="muted">{t('home.scaffold_note')}</p>
    </main>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

function useServerHealth(online: boolean): ServerState {
  const [state, setState] = useState<ServerState>('checking');
  useEffect(() => {
    if (!online) return;
    const base = import.meta.env.VITE_API_BASE_URL ?? '/api';
    let cancelled = false;
    fetch(`${base}/health`)
      .then(async (r) => {
        const body = (await r.json()) as { status?: string };
        if (!cancelled) setState(body.status === 'ok' ? 'ok' : 'degraded');
      })
      .catch(() => {
        if (!cancelled) setState('unreachable');
      });
    return () => {
      cancelled = true;
    };
  }, [online]);
  return state;
}

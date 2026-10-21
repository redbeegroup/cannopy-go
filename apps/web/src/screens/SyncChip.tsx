import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useSyncStatus } from '../sync/manager';

/** One line under the title: offline, syncing, N waiting, or all saved. */
export function SyncChip() {
  const { t } = useTranslation();
  const s = useSyncStatus();
  let text: string;
  let tone = 'ok';
  if (!s.online || s.phase === 'offline') {
    text = s.pending > 0 ? t('sync.offline_pending', { count: s.pending }) : t('sync.offline');
    tone = 'warn';
  } else if (s.phase === 'syncing') {
    text = t('sync.syncing');
  } else if (s.phase === 'error') {
    text = t('sync.error');
    tone = 'warn';
  } else if (s.pending > 0) {
    text = t('sync.pending', { count: s.pending });
    tone = 'warn';
  } else {
    text = t('sync.saved');
  }
  return (
    <Link to="/settings/sync" className={`sync-chip ${tone}`}>
      <span className="dot" />
      {text}
    </Link>
  );
}

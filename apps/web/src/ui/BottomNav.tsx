import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';

const ICONS = {
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  history: 'M12 8v5l3 2M21 12a9 9 0 1 1-3-6.7M21 3v5h-5',
  items: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
  contacts:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  reports: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
} as const;

export function BottomNav() {
  const { t } = useTranslation();
  const tabs: { to: string; icon: keyof typeof ICONS; label: string }[] = [
    { to: '/', icon: 'home', label: t('nav.home') },
    { to: '/history', icon: 'history', label: t('nav.history') },
    { to: '/items', icon: 'items', label: t('nav.items') },
    { to: '/contacts', icon: 'contacts', label: t('nav.contacts') },
    { to: '/reports', icon: 'reports', label: t('nav.reports') },
  ];
  return (
    <nav className="bottom-nav" aria-label={t('nav.main')}>
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className="nav-tab">
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d={ICONS[tab.icon]}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

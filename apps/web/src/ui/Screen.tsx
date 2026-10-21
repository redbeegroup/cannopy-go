import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

interface ScreenProps {
  title: string;
  subtitle?: string | undefined;
  /** Where the back arrow goes; omit for a top-level tab. */
  back?: string | true;
  actions?: ReactNode | undefined;
  children: ReactNode;
  /** Sticky bar at the bottom, usually the Save button. */
  footer?: ReactNode | undefined;
  className?: string | undefined;
}

export function Screen({
  title,
  subtitle,
  back,
  actions,
  children,
  footer,
  className,
}: ScreenProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <div className={`screen ${className ?? ''}`}>
      <header className="screen-header">
        {back ? (
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.back')}
            onClick={() => (back === true ? navigate(-1) : navigate(back))}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
        <div className="screen-title">
          <h1>{title}</h1>
          {subtitle ? <div className="muted small">{subtitle}</div> : null}
        </div>
        {actions ? <div className="screen-actions">{actions}</div> : null}
      </header>
      <div className="screen-body">{children}</div>
      {footer ? <div className="screen-footer">{footer}</div> : null}
    </div>
  );
}

export function Section({
  title,
  children,
  aside,
}: {
  title?: string | undefined;
  children: ReactNode;
  aside?: ReactNode | undefined;
}) {
  return (
    <section className="section">
      {title ? (
        <div className="section-head">
          <h2>{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className ?? ''}`}>{children}</div>;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {hint ? <div className="muted">{hint}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

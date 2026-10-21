import type { ReactNode } from 'react';
import { Link } from 'react-router';

interface RowProps {
  title: ReactNode;
  subtitle?: ReactNode | undefined;
  right?: ReactNode | undefined;
  rightSub?: ReactNode | undefined;
  to?: string | undefined;
  onClick?: (() => void) | undefined;
  tone?: 'in' | 'out' | 'neutral' | undefined;
  leading?: ReactNode | undefined;
}

/** One line in a list: title and subtitle on the left, an amount on the right. */
export function Row({ title, subtitle, right, rightSub, to, onClick, tone, leading }: RowProps) {
  const body = (
    <>
      {leading ? <span className="row-leading">{leading}</span> : null}
      <span className="row-main">
        <span className="row-title">{title}</span>
        {subtitle ? <span className="row-sub">{subtitle}</span> : null}
      </span>
      {right !== undefined ? (
        <span className={`row-right ${tone ?? ''}`}>
          <span className="row-amount">{right}</span>
          {rightSub ? <span className="row-sub">{rightSub}</span> : null}
        </span>
      ) : null}
      {to || onClick ? (
        <span className="chev" aria-hidden="true">
          ›
        </span>
      ) : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className="list-row">
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className="list-row" onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className="list-row static">{body}</div>;
}

export function List({ children }: { children: ReactNode }) {
  return <div className="list">{children}</div>;
}

/** Big stat on a card, used on the home screen and report headers. */
export function Stat({
  label,
  value,
  sub,
  to,
  tone,
}: {
  label: string;
  value: string;
  sub?: ReactNode | undefined;
  to?: string | undefined;
  tone?: 'in' | 'out' | 'neutral' | undefined;
}) {
  const inner = (
    <>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ''}`}>{value}</div>
      {sub ? <div className="stat-sub muted">{sub}</div> : null}
    </>
  );
  return to ? (
    <Link to={to} className="card stat">
      {inner}
    </Link>
  ) : (
    <div className="card stat">{inner}</div>
  );
}

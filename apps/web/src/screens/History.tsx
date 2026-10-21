import type { Document, DocumentType } from '@cannopy/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useAccounts, useContacts, useDocument, useDocuments, useItems } from '../data/hooks';
import { repo } from '../data/repo';
import { localDb } from '../db/local';
import { Button } from '../ui/fields';
import { formatDate, formatQuantity, useLabel, useLanguage, useMoney } from '../ui/format';
import { Row } from '../ui/List';
import { Confirm } from '../ui/Picker';
import { Card, EmptyState, Screen, Section } from '../ui/Screen';
import { useToast } from '../ui/Toast';
import { documentTitle, documentTone, editPath } from './documents';

/** Day book (journey 11, "fix a mistake"): every record, newest first, tap to open, edit or delete. */
const FILTERS: { key: string; types: DocumentType[] | null }[] = [
  { key: 'all', types: null },
  { key: 'sales', types: ['sale', 'payment_in'] },
  { key: 'spending', types: ['expense', 'purchase', 'payment_out'] },
  {
    key: 'other',
    types: ['owner_in', 'owner_out', 'transfer', 'stock_adjustment', 'opening_balance'],
  },
];

export function History() {
  const { t } = useTranslation();
  const docs = useDocuments();
  const contacts = useContacts();
  const money = useMoney();
  const pick = useLabel();
  const language = useLanguage();
  const [filter, setFilter] = useState('all');
  const pending =
    useLiveQuery(() => localDb.outbox.where('entity').equals('document').toArray(), []) ?? [];
  const pendingIds = useMemo(() => new Set(pending.map((p) => p.entityId)), [pending]);

  const shown = useMemo(() => {
    const types = FILTERS.find((f) => f.key === filter)?.types;
    return docs.filter((d) => !types || types.includes(d.type)).slice(0, 200);
  }, [docs, filter]);
  const byDate = useMemo(() => {
    const groups: { date: string; docs: Document[] }[] = [];
    for (const d of shown) {
      const g = groups.at(-1);
      if (g && g.date === d.date) g.docs.push(d);
      else groups.push({ date: d.date, docs: [d] });
    }
    return groups;
  }, [shown]);
  const contactName = (id: string | null) => {
    const c = id ? contacts.find((x) => x.id === id) : undefined;
    return c ? pick(c.name) : '';
  };

  return (
    <Screen title={t('nav.history')}>
      <div className="choices">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip choice ${filter === f.key ? 'selected' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {t(`history.filter.${f.key}`)}
          </button>
        ))}
      </div>
      {byDate.length === 0 ? (
        <EmptyState title={t('history.empty')} />
      ) : (
        byDate.map((g) => (
          <Section key={g.date} title={formatDate(g.date, language)}>
            <Card className="flush">
              {g.docs.map((d) => (
                <Row
                  key={d.id}
                  to={`/documents/${d.id}`}
                  title={documentTitle(d, t)}
                  subtitle={
                    [contactName(d.contactId), d.note].filter(Boolean).join(' · ') || undefined
                  }
                  right={money(d.total)}
                  rightSub={
                    pendingIds.has(d.id)
                      ? t('history.not_synced')
                      : d.status === 'open' || d.status === 'partly_paid'
                        ? t(`status.${d.status}`)
                        : undefined
                  }
                  tone={documentTone(d)}
                />
              ))}
            </Card>
          </Section>
        ))
      )}
    </Screen>
  );
}

export function DocumentDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const doc = useDocument(id);
  const docs = useDocuments();
  const accounts = useAccounts();
  const items = useItems();
  const contacts = useContacts();
  const money = useMoney();
  const pick = useLabel();
  const language = useLanguage();
  const [confirm, setConfirm] = useState(false);
  if (!doc) return null;

  const account = (aid: string | null) => {
    const a = aid ? accounts.find((x) => x.id === aid) : undefined;
    return a ? a.provider || pick(a.name) : '';
  };
  const contact = doc.contactId ? contacts.find((c) => c.id === doc.contactId) : undefined;
  const settledBy = docs.filter((d) => d.allocations.some((a) => a.documentId === doc.id));
  const edit = editPath(doc);
  const paidByOthers = settledBy.reduce(
    (s, d) => s + (d.allocations.find((a) => a.documentId === doc.id)?.amount ?? 0),
    0,
  );

  const remove = async () => {
    setConfirm(false);
    if (settledBy.length > 0) return toast(t('history.has_payments'), 'warn');
    await repo.deleteDocument(doc.id);
    toast(t('history.deleted'));
    navigate(-1);
  };

  return (
    <Screen
      title={documentTitle(doc, t)}
      subtitle={formatDate(doc.date, language)}
      back
      actions={
        edit && doc.status !== 'void' ? (
          <Link to={edit} className="button secondary small">
            {t('common.edit')}
          </Link>
        ) : undefined
      }
    >
      <Card className="stat">
        <div className="stat-label">{t('common.total')}</div>
        <div className={`stat-value ${documentTone(doc)}`}>{money(doc.total)}</div>
        {doc.feeAmount > 0 ? (
          <div className="muted small">
            {t('form.fee')}: {money(doc.feeAmount)}
          </div>
        ) : null}
        {doc.status === 'void' ? <div className="banner warn">{t('status.void')}</div> : null}
      </Card>

      <Card className="flush">
        {contact ? (
          <Row
            title={t('form.contact')}
            right={pick(contact.name)}
            to={`/contacts/${contact.id}`}
          />
        ) : null}
        {doc.moneyAccountId ? (
          <Row
            title={doc.type === 'transfer' ? t('transfer.from') : t('form.paid_with')}
            right={account(doc.moneyAccountId)}
          />
        ) : null}
        {doc.toMoneyAccountId ? (
          <Row title={t('transfer.to')} right={account(doc.toMoneyAccountId)} />
        ) : null}
        {!doc.moneyAccountId &&
        (doc.type === 'sale' || doc.type === 'expense' || doc.type === 'purchase') ? (
          <Row
            title={t('status.label')}
            right={t(`status.${doc.status}`)}
            rightSub={
              paidByOthers > 0
                ? t('history.paid_so_far', { amount: money(paidByOthers) })
                : undefined
            }
          />
        ) : null}
        {doc.note ? <Row title={t('form.note')} subtitle={doc.note} /> : null}
      </Card>

      {doc.lines.length > 0 ? (
        <Section title={t('history.lines')}>
          <Card className="flush">
            {doc.lines.map((l) => {
              const item = l.itemId ? items.find((i) => i.id === l.itemId) : undefined;
              return (
                <Row
                  key={l.id}
                  title={
                    item
                      ? pick(item.name)
                      : l.accountId
                        ? account(l.accountId)
                        : l.description || t('sell.add_amount')
                  }
                  subtitle={
                    item
                      ? `${formatQuantity(l.quantityMilli)} ${pick(item.unit)} × ${money(l.unitPrice)}`
                      : l.description || undefined
                  }
                  right={money(l.amount + l.taxAmount)}
                />
              );
            })}
          </Card>
        </Section>
      ) : null}

      {doc.allocations.length > 0 ? (
        <Section title={t('payment.split_title')}>
          <Card className="flush">
            {doc.allocations.map((a) => {
              const target = docs.find((d) => d.id === a.documentId);
              return (
                <Row
                  key={a.documentId}
                  title={target ? documentTitle(target, t) : t('doc.opening_balance')}
                  right={money(a.amount)}
                  to={target ? `/documents/${target.id}` : undefined}
                />
              );
            })}
          </Card>
        </Section>
      ) : null}

      {settledBy.length > 0 ? (
        <Section title={t('history.settled_by')}>
          <Card className="flush">
            {settledBy.map((d) => (
              <Row
                key={d.id}
                to={`/documents/${d.id}`}
                title={documentTitle(d, t)}
                subtitle={formatDate(d.date, language)}
                right={money(d.allocations.find((a) => a.documentId === doc.id)?.amount ?? 0)}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {doc.status !== 'void' ? (
        <Section>
          <Button kind="danger" onClick={() => setConfirm(true)}>
            {t('common.delete')}
          </Button>
          <Confirm
            open={confirm}
            title={t('history.delete_title')}
            text={t('history.delete_hint')}
            confirmLabel={t('common.delete')}
            danger
            onConfirm={() => void remove()}
            onClose={() => setConfirm(false)}
          />
        </Section>
      ) : null}
    </Screen>
  );
}

import { SYSTEM_ACCOUNT_CODES as C, type Contact, dayBefore, labelFromInput } from '@cannopy/core';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useAccounts, useContact, useContacts, useDocuments, useOpenBalances } from '../data/hooks';
import { newLine, repo } from '../data/repo';
import { useSession } from '../data/session';
import { AmountField, Button, TextField, Toggle } from '../ui/fields';
import { formatDate, today, useLabel, useLanguage, useMoney } from '../ui/format';
import { Row } from '../ui/List';
import { Confirm } from '../ui/Picker';
import { Card, EmptyState, Screen, Section } from '../ui/Screen';
import { useToast } from '../ui/Toast';
import { documentTitle, documentTone } from './documents';

/** Customers and suppliers: the notebook of who owes what, working offline. */
export function Contacts() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'suppliers' ? 'suppliers' : 'customers';
  const contacts = useContacts();
  const open = useOpenBalances();
  const pick = useLabel();
  const money = useMoney();
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const balance = new Map(
      (tab === 'customers' ? open.receivable : open.payable).map((r) => [r.contactId, r.balance]),
    );
    return contacts
      .filter((c) => (tab === 'customers' ? c.isCustomer : c.isSupplier))
      .filter((c) => !q || `${c.name.en} ${c.name.my} ${c.phone ?? ''}`.toLowerCase().includes(q))
      .map((c) => ({ c, balance: balance.get(c.id) ?? 0 }))
      .sort((a, b) => b.balance - a.balance || pick(a.c.name).localeCompare(pick(b.c.name)));
  }, [contacts, open, tab, query, pick]);

  return (
    <Screen
      title={t('nav.contacts')}
      actions={
        <Link
          to={`/contacts/new?kind=${tab === 'customers' ? 'customer' : 'supplier'}`}
          className="button primary small"
        >
          + {t('common.add')}
        </Link>
      }
    >
      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'customers'}
          className={tab === 'customers' ? 'on' : ''}
          onClick={() => setParams({ tab: 'customers' })}
        >
          {t('contacts.customers')} · {money(open.owedToMe, false)}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'suppliers'}
          className={tab === 'suppliers' ? 'on' : ''}
          onClick={() => setParams({ tab: 'suppliers' })}
        >
          {t('contacts.suppliers')} · {money(open.iOwe, false)}
        </button>
      </div>
      {contacts.length > 6 ? (
        <input
          className="input search"
          placeholder={t('common.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      ) : null}
      {shown.length === 0 ? (
        <EmptyState
          title={t(tab === 'customers' ? 'contacts.empty_customers' : 'contacts.empty_suppliers')}
          hint={t('contacts.empty_hint')}
        />
      ) : (
        <Card className="flush">
          {shown.map(({ c, balance }) => (
            <Row
              key={c.id}
              to={`/contacts/${c.id}`}
              title={pick(c.name)}
              subtitle={c.phone ?? undefined}
              right={balance > 0 ? money(balance) : undefined}
              rightSub={
                balance > 0
                  ? t(tab === 'customers' ? 'contacts.owes_you' : 'contacts.you_owe')
                  : undefined
              }
              tone={balance > 0 ? (tab === 'customers' ? 'in' : 'out') : 'neutral'}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}

export function ContactDetail() {
  const { id } = useParams();
  const { t } = useTranslation();
  const contact = useContact(id);
  const docs = useDocuments();
  const open = useOpenBalances();
  const pick = useLabel();
  const money = useMoney();
  const language = useLanguage();
  if (!contact) return null;

  const owesMe = open.receivable.find((r) => r.contactId === contact.id)?.balance ?? 0;
  const iOwe = open.payable.find((r) => r.contactId === contact.id)?.balance ?? 0;
  const openDocs = open.open.filter((o) => o.contactId === contact.id && o.balance > 0);
  const history = docs.filter((d) => d.contactId === contact.id).slice(0, 30);
  const days = (date: string) =>
    Math.max(0, Math.round((Date.parse(today()) - Date.parse(date)) / 86_400_000));

  return (
    <Screen
      title={pick(contact.name)}
      subtitle={contact.phone ?? undefined}
      back="/contacts"
      actions={
        <Link to={`/contacts/${contact.id}/edit`} className="button secondary small">
          {t('common.edit')}
        </Link>
      }
    >
      <div className="grid2">
        {contact.isCustomer || owesMe > 0 ? (
          <Card className="stat">
            <div className="stat-label">{t('contacts.owes_you')}</div>
            <div className="stat-value in">{money(owesMe)}</div>
            <Link to={`/get-paid?contact=${contact.id}`} className="button primary small">
              {t('actions.get_paid')}
            </Link>
          </Card>
        ) : null}
        {contact.isSupplier || iOwe > 0 ? (
          <Card className="stat">
            <div className="stat-label">{t('contacts.you_owe')}</div>
            <div className="stat-value out">{money(iOwe)}</div>
            <Link to={`/pay?contact=${contact.id}`} className="button primary small">
              {t('actions.pay')}
            </Link>
          </Card>
        ) : null}
      </div>
      {contact.phone && owesMe > 0 ? (
        <a
          className="button secondary"
          href={`sms:${contact.phone}?body=${encodeURIComponent(t('contacts.reminder_text', { amount: money(owesMe) }))}`}
        >
          {t('contacts.send_reminder')}
        </a>
      ) : null}

      {openDocs.length > 0 ? (
        <Section title={t('contacts.open_docs')}>
          <Card className="flush">
            {openDocs.map((o) => {
              const d = docs.find((x) => x.id === o.documentId);
              return (
                <Row
                  key={o.documentId}
                  to={d ? `/documents/${d.id}` : undefined}
                  title={d ? documentTitle(d, t) : t('doc.opening_balance')}
                  subtitle={`${formatDate(o.date, language)} · ${t('contacts.days_ago', { count: days(o.date) })}`}
                  right={money(o.balance)}
                  rightSub={
                    o.paid > 0 ? t('contacts.of_total', { total: money(o.total) }) : undefined
                  }
                />
              );
            })}
          </Card>
        </Section>
      ) : null}

      {history.length > 0 ? (
        <Section title={t('contacts.history')}>
          <Card className="flush">
            {history.map((d) => (
              <Row
                key={d.id}
                to={`/documents/${d.id}`}
                title={documentTitle(d, t)}
                subtitle={formatDate(d.date, language)}
                right={money(d.total)}
                tone={documentTone(d)}
              />
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}

export function ContactEdit() {
  const { id } = useParams();
  const contact = useContact(id === 'new' ? undefined : id);
  if (id !== 'new' && !contact) return null;
  return <ContactForm key={contact?.id ?? 'new'} existing={contact} />;
}

function ContactForm({ existing }: { existing?: Contact | undefined }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { business, user } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const language = useLanguage();
  const pick = useLabel();
  const accounts = useAccounts();
  const startAsSupplier = params.get('kind') === 'supplier';

  const [name, setName] = useState(existing ? pick(existing.name) : '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [isCustomer, setIsCustomer] = useState(existing?.isCustomer ?? !startAsSupplier);
  const [isSupplier, setIsSupplier] = useState(existing?.isSupplier ?? startAsSupplier);
  const [note, setNote] = useState(existing?.note ?? '');
  const [owesMe, setOwesMe] = useState<number | null>(null);
  const [iOwe, setIOwe] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return setError(t('contacts.need_name'));
    if (!isCustomer && !isSupplier) return setError(t('contacts.need_role'));
    setError(null);
    const contact: Contact = {
      ...(existing ?? repo.newContact(business.id)),
      name: existing
        ? { ...existing.name, [language]: name.trim() }
        : labelFromInput(name.trim(), language),
      phone: phone.trim() || null,
      isCustomer,
      isSupplier,
      note,
    };
    await repo.saveContact(contact);
    if (!existing) {
      const codeId = (code: string) => accounts.find((a) => a.code === code)?.id ?? null;
      for (const [amount, code] of [
        [owesMe, C.RECEIVABLE],
        [iOwe, C.PAYABLE],
      ] as const) {
        if (!amount || amount <= 0) continue;
        const doc = await repo.newDocument(
          business.id,
          user.id,
          'opening_balance',
          dayBefore(today()),
        );
        doc.contactId = contact.id;
        doc.lines = [newLine({ accountId: codeId(code), amount })];
        doc.total = amount;
        doc.note = t('setup.opening_note');
        await repo.saveDocument(doc);
      }
    }
    toast(t('contacts.saved'));
    if (existing) navigate(-1);
    else navigate(`/contacts/${contact.id}`, { replace: true });
  };

  const remove = async () => {
    if (!existing) return;
    await repo.deleteContact(existing.id);
    toast(t('contacts.deleted'));
    navigate('/contacts', { replace: true });
  };

  return (
    <Screen
      title={
        existing
          ? t('common.edit')
          : isSupplier && !isCustomer
            ? t('contacts.new_supplier')
            : t('contacts.new_customer')
      }
      back
      footer={
        <Button full onClick={() => void submit()}>
          {t('common.save')}
        </Button>
      }
    >
      <Section>
        <TextField
          label={t('contacts.name')}
          value={name}
          onChange={setName}
          autoFocus={!existing}
        />
        <TextField label={t('contacts.phone')} value={phone} onChange={setPhone} type="tel" />
        <Toggle label={t('contacts.is_customer')} checked={isCustomer} onChange={setIsCustomer} />
        <Toggle label={t('contacts.is_supplier')} checked={isSupplier} onChange={setIsSupplier} />
        <TextField label={t('form.note')} value={note} onChange={setNote} multiline />
        {!existing ? (
          <Card>
            <h2 className="card-title">{t('contacts.opening_title')}</h2>
            <p className="muted small">{t('contacts.opening_hint')}</p>
            {isCustomer ? (
              <AmountField
                label={t('contacts.already_owes_me')}
                value={owesMe}
                onChange={setOwesMe}
                presets={false}
              />
            ) : null}
            {isSupplier ? (
              <AmountField
                label={t('contacts.i_already_owe')}
                value={iOwe}
                onChange={setIOwe}
                presets={false}
              />
            ) : null}
          </Card>
        ) : null}
        {error ? <div className="banner warn">{error}</div> : null}
      </Section>
      {existing ? (
        <Section>
          <Button kind="danger" onClick={() => setConfirmDelete(true)}>
            {t('contacts.delete')}
          </Button>
          <Confirm
            open={confirmDelete}
            title={t('contacts.delete')}
            text={t('contacts.delete_hint')}
            confirmLabel={t('common.delete')}
            danger
            onConfirm={() => void remove()}
            onClose={() => setConfirmDelete(false)}
          />
        </Section>
      ) : null}
    </Screen>
  );
}

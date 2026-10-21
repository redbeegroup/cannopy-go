import { formatPhone, type Invite, type Member, normalizePhone } from '@cannopy/core';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { ApiError, api, isNetworkError } from '../data/api';
import { useSession } from '../data/session';
import { Button, TextField } from '../ui/fields';
import { formatDate, useLanguage } from '../ui/format';
import { Row } from '../ui/List';
import { Confirm } from '../ui/Picker';
import { Card, Screen, Section } from '../ui/Screen';
import { useToast } from '../ui/Toast';

/**
 * Who can open this business. An owner invites a phone number; when that
 * number signs in, the invite is waiting. Members see the same books and
 * record the same way; only owners manage people and the accounting mode.
 * These screens talk to the server directly: membership is not part of the
 * offline working copy.
 */
export function People() {
  const { t } = useTranslation();
  const { business, user, role } = useSession();
  const language = useLanguage();
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ members: Member[]; invites: Invite[] }>(
        `/businesses/${business.id}/members`,
      );
      setMembers(r.members);
      setInvites(r.invites);
      setError(null);
    } catch (err) {
      setError(isNetworkError(err) ? t('people.need_internet') : t('people.failed'));
    } finally {
      setLoaded(true);
    }
  }, [business.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (invite: Invite) => {
    try {
      await api(`/businesses/${business.id}/invites/${invite.id}`, { method: 'DELETE' });
      toast(t('people.invite_removed'));
      await load();
    } catch (err) {
      toast(isNetworkError(err) ? t('people.need_internet') : t('people.failed'), 'warn');
    }
  };

  const remove = async (member: Member) => {
    setRemoving(null);
    try {
      await api(`/businesses/${business.id}/members/${member.userId}`, { method: 'DELETE' });
      toast(t('people.member_removed', { name: member.name || formatPhone(member.phone) }));
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'last_owner')
        toast(t('people.last_owner'), 'warn');
      else toast(isNetworkError(err) ? t('people.need_internet') : t('people.failed'), 'warn');
    }
  };

  return (
    <Screen
      title={t('people.title')}
      back="/settings"
      actions={
        role === 'owner' ? (
          <Link to="/settings/people/invite" className="button primary small">
            + {t('people.invite')}
          </Link>
        ) : undefined
      }
    >
      <p className="muted small">{t('people.intro')}</p>
      {error ? <div className="banner warn">{error}</div> : null}
      {!loaded && !error ? <p className="muted">{t('choose.loading')}</p> : null}

      {members.length > 0 ? (
        <Section title={t('people.members')}>
          <Card className="flush">
            {members.map((m) => (
              <Row
                key={m.userId}
                title={`${m.name || formatPhone(m.phone)}${m.userId === user.id ? ` (${t('people.you')})` : ''}`}
                subtitle={`${formatPhone(m.phone)} · ${t(`role.${m.role}`)} · ${t('people.since', { date: formatDate(m.joinedAt.slice(0, 10), language) })}`}
                right={
                  role === 'owner' && m.userId !== user.id ? (
                    <Button small kind="ghost" onClick={() => setRemoving(m)}>
                      {t('common.remove')}
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {invites.length > 0 ? (
        <Section title={t('people.waiting')}>
          <p className="muted small">{t('people.waiting_hint')}</p>
          <Card className="flush">
            {invites.map((inv) => (
              <Row
                key={inv.id}
                title={inv.name || formatPhone(inv.phone)}
                subtitle={`${formatPhone(inv.phone)} · ${t(`role.${inv.role}`)}`}
                right={
                  role === 'owner' ? (
                    <Button small kind="ghost" onClick={() => void revoke(inv)}>
                      {t('common.remove')}
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {role !== 'owner' ? <p className="muted small">{t('people.member_note')}</p> : null}

      <Confirm
        open={removing !== null}
        title={t('people.remove_title')}
        text={
          removing
            ? t('people.remove_confirm', { name: removing.name || formatPhone(removing.phone) })
            : undefined
        }
        confirmLabel={t('common.remove')}
        danger
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        onClose={() => setRemoving(null)}
      />
    </Screen>
  );
}

export function InvitePerson() {
  const { t } = useTranslation();
  const { business } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const normalized = normalizePhone(phone);
    if (!normalized) return setError(t('signin.bad_phone'));
    setBusy(true);
    setError(null);
    try {
      await api(`/businesses/${business.id}/invites`, {
        body: { phone: normalized, name: name.trim(), role: 'member' },
      });
      toast(t('people.invited', { phone: formatPhone(normalized) }));
      navigate('/settings/people', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'already_member') {
        setError(t('people.already_member'));
      } else {
        setError(isNetworkError(err) ? t('people.need_internet') : t('people.failed'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={t('people.invite')}
      back="/settings/people"
      footer={
        <Button full onClick={() => void submit()} disabled={busy || phone.trim() === ''}>
          {busy ? t('common.saving') : t('people.send_invite')}
        </Button>
      }
    >
      <Section>
        <p className="muted">{t('people.invite_intro')}</p>
        <TextField
          label={t('signin.phone')}
          value={phone}
          onChange={setPhone}
          type="tel"
          placeholder="09 123 456 789"
          autoFocus
        />
        <TextField
          label={t('people.their_name')}
          value={name}
          onChange={setName}
          hint={t('people.their_name_hint')}
        />
        {error ? <div className="banner warn">{error}</div> : null}
        <p className="muted small">{t('people.invite_note')}</p>
      </Section>
    </Screen>
  );
}

import type { Business, Me, MemberRole } from '@cannopy/core';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { api, isAuthError, isNetworkError } from '../data/api';
import { useSessionState } from '../data/session';
import { syncManager } from '../sync/manager';
import { Button } from '../ui/fields';
import { useLabel } from '../ui/format';
import { Row } from '../ui/List';
import { Card, Section } from '../ui/Screen';

/**
 * After sign-in: open one of the businesses this phone number belongs to,
 * join one it was invited to, or start a new one. A phone that already has
 * the business's books keeps them; a different business replaces them.
 */
export function ChooseBusiness() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const pick = useLabel();
  const { auth, session, openBusiness, signOut } = useSessionState();
  const [me, setMe] = useState<Me | null>((location.state as { me?: Me } | null)?.me ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (me || !auth) return;
    let cancelled = false;
    api<Me>('/me')
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch((err) => {
        if (cancelled) return;
        if (isAuthError(err)) navigate('/sign-in', { replace: true });
        else setError(isNetworkError(err) ? t('signin.need_internet') : t('choose.failed'));
      });
    return () => {
      cancelled = true;
    };
  }, [me, auth, navigate, t]);

  if (!auth) return null;

  const open = async (business: Business, role: MemberRole) => {
    setBusy(business.id);
    setError(null);
    try {
      const fresh = session?.business.id !== business.id;
      await openBusiness(business, role);
      // A phone that has never held these books pulls them now, so Home is not empty.
      if (fresh) await syncManager.client.pullAll(business.id);
      navigate('/', { replace: true });
    } catch (err) {
      setError(isNetworkError(err) ? t('signin.need_internet') : t('choose.failed'));
    } finally {
      setBusy(null);
    }
  };

  const join = async (inviteId: string) => {
    setBusy(inviteId);
    setError(null);
    try {
      const joined = await api<{ business: Business; role: MemberRole }>(
        `/invites/${inviteId}/accept`,
        { method: 'POST', body: {} },
      );
      await open(joined.business, joined.role);
    } catch (err) {
      setError(isNetworkError(err) ? t('signin.need_internet') : t('choose.failed'));
      setBusy(null);
    }
  };

  return (
    <div className="screen setup">
      <div className="screen-body">
        <div className="setup-step">
          <div className="brand">
            <img src="/icons/icon.svg" alt="" width="56" height="56" />
            <h1>{t('choose.title')}</h1>
          </div>
          <p className="muted">{t('choose.signed_in_as', { name: auth.user.name })}</p>

          {!me && !error ? <p className="muted">{t('choose.loading')}</p> : null}

          {me && me.invites.length > 0 ? (
            <Section title={t('choose.invited')}>
              <Card className="flush">
                {me.invites.map((inv) => (
                  <Row
                    key={inv.id}
                    title={pick(inv.business.name)}
                    subtitle={t('choose.invited_by', { name: inv.invitedByName })}
                    right={
                      <Button small onClick={() => void join(inv.id)} disabled={busy !== null}>
                        {busy === inv.id ? t('choose.joining') : t('choose.join')}
                      </Button>
                    }
                  />
                ))}
              </Card>
            </Section>
          ) : null}

          {me && me.businesses.length > 0 ? (
            <Section title={t('choose.yours')}>
              <Card className="flush">
                {me.businesses.map(({ business, role }) => (
                  <Row
                    key={business.id}
                    title={pick(business.name)}
                    subtitle={`${t(`business_type.${business.type}`)} · ${t(`role.${role}`)}`}
                    right={
                      <Button
                        small
                        kind={session?.business.id === business.id ? 'primary' : 'secondary'}
                        onClick={() => void open(business, role)}
                        disabled={busy !== null}
                      >
                        {busy === business.id ? t('choose.opening') : t('choose.open')}
                      </Button>
                    }
                  />
                ))}
              </Card>
            </Section>
          ) : null}

          {me && me.businesses.length === 0 && me.invites.length === 0 ? (
            <p className="muted">{t('choose.none')}</p>
          ) : null}

          {error ? <div className="banner warn">{error}</div> : null}

          <div className="stack">
            <Button
              kind={me && me.businesses.length === 0 ? 'primary' : 'secondary'}
              full
              onClick={() => navigate('/setup')}
            >
              {t('choose.new')}
            </Button>
            <Button
              kind="ghost"
              full
              onClick={() => void signOut().then(() => navigate('/sign-in', { replace: true }))}
            >
              {t('settings.sign_out')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

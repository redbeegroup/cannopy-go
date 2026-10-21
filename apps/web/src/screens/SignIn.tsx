import { formatPhone, normalizePhone, type SignInResult, type User } from '@cannopy/core';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiError, api, isNetworkError } from '../data/api';
import { useSessionState } from '../data/session';
import { syncManager } from '../sync/manager';
import { Button, TextField } from '../ui/fields';
import { useLanguage } from '../ui/format';

/**
 * Sign in with a phone number and a one-time code. Three short steps on a
 * fresh phone (language, number, code) and a fourth, the person's name, only
 * the first time a number signs in. The same screen serves "sign in again"
 * when the server stops accepting this device's token: the books stay on the
 * phone and only the token is replaced.
 */
type Step = 'language' | 'phone' | 'code' | 'name';

export function SignIn() {
  const { t, i18n } = useTranslation();
  const language = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const again = params.get('again') === '1';
  const { auth, session, setAuth } = useSessionState();
  const [step, setStep] = useState<Step>(again || auth ? 'phone' : 'language');
  const [phoneText, setPhoneText] = useState(() =>
    auth?.user.phone ? formatPhone(auth.user.phone) : '',
  );
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [result, setResult] = useState<SignInResult | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const fail = (err: unknown, fallback: string) => {
    if (isNetworkError(err)) return setError(t('signin.need_internet'));
    if (err instanceof ApiError) {
      if (err.code === 'wrong_code') return setError(t('signin.wrong_code'));
      if (err.code === 'code_expired') return setError(t('signin.code_expired'));
      if (err.code === 'too_many_codes') return setError(t('signin.too_many'));
    }
    setError(fallback);
  };

  const requestCode = async () => {
    const normalized = normalizePhone(phoneText);
    if (!normalized) return setError(t('signin.bad_phone'));
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devCode?: string }>('/auth/request-code', {
        body: { phone: normalized, language },
        token: null,
      });
      setPhone(normalized);
      setDevCode(r.devCode ?? null);
      setCode('');
      setCooldown(30);
      setStep('code');
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      fail(err, t('signin.failed'));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!phone || !/^\d{6}$/.test(code.trim())) return setError(t('signin.enter_code'));
    setBusy(true);
    setError(null);
    try {
      const deviceId = await syncManager.client.deviceId();
      const r = await api<SignInResult>('/auth/verify-code', {
        body: { phone, code: code.trim(), deviceId, deviceName: deviceName(), language },
        token: null,
      });
      setResult(r);
      if (!r.user.name) {
        setStep('name');
        return;
      }
      await finish(r, r.user.name);
    } catch (err) {
      fail(err, t('signin.failed'));
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    if (!result) return;
    if (!name.trim()) return setError(t('signin.need_name'));
    setBusy(true);
    setError(null);
    try {
      await api('/me', {
        method: 'PUT',
        body: { name: name.trim(), language },
        token: result.token,
      });
      await finish(result, name.trim());
    } catch (err) {
      fail(err, t('common.save_failed'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (r: SignInResult, finalName: string) => {
    const now = new Date().toISOString();
    const user: User = {
      id: r.user.id,
      phone: r.user.phone,
      name: finalName,
      email: null,
      language,
      createdAt: now,
      updatedAt: now,
    };
    await setAuth({ token: r.token, user });
    // Signing in again on a phone that already holds this business: keep the books.
    const keep = session && r.businesses.some((b) => b.business.id === session.business.id);
    if (keep) {
      syncManager.start(session.business.id);
      navigate('/', { replace: true });
      return;
    }
    navigate('/choose', { replace: true, state: { me: r } });
  };

  return (
    <div className="screen setup">
      <div className="screen-body">
        {step === 'language' ? (
          <div className="setup-step">
            <div className="brand">
              <img src="/icons/icon.svg" alt="" width="72" height="72" />
              <h1>Cannopy GO</h1>
            </div>
            <p className="lead">{t('setup.pick_language')}</p>
            <div className="stack">
              <button
                type="button"
                className="big-button"
                onClick={() => {
                  void i18n.changeLanguage('my');
                  setStep('phone');
                }}
              >
                မြန်မာ
              </button>
              <button
                type="button"
                className="big-button secondary"
                onClick={() => {
                  void i18n.changeLanguage('en');
                  setStep('phone');
                }}
              >
                English
              </button>
            </div>
          </div>
        ) : null}

        {step === 'phone' ? (
          <div className="setup-step">
            <h1>{again ? t('signin.again_title') : t('signin.title')}</h1>
            <p className="muted">{again ? t('signin.again_hint') : t('signin.intro')}</p>
            <TextField
              label={t('signin.phone')}
              value={phoneText}
              onChange={setPhoneText}
              type="tel"
              placeholder="09 123 456 789"
              hint={t('signin.phone_hint')}
              autoFocus
            />
            {error ? <div className="banner warn">{error}</div> : null}
          </div>
        ) : null}

        {step === 'code' ? (
          <div className="setup-step">
            <h1>{t('signin.code_title')}</h1>
            <p className="muted">{t('signin.code_sent', { phone: formatPhone(phone ?? '') })}</p>
            <div className="field">
              <span className="field-label">{t('signin.code')}</span>
              <input
                ref={codeRef}
                className="input code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void verify();
                }}
              />
            </div>
            {devCode ? (
              <div className="banner info">{t('signin.dev_code', { code: devCode })}</div>
            ) : null}
            {error ? <div className="banner warn">{error}</div> : null}
            <div className="row-between">
              <Button kind="ghost" small onClick={() => setStep('phone')}>
                {t('signin.change_phone')}
              </Button>
              <Button
                kind="ghost"
                small
                disabled={cooldown > 0 || busy}
                onClick={() => void requestCode()}
              >
                {cooldown > 0 ? t('signin.resend_in', { seconds: cooldown }) : t('signin.resend')}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'name' ? (
          <div className="setup-step">
            <h1>{t('signin.name_title')}</h1>
            <p className="muted">{t('signin.name_hint')}</p>
            <TextField label={t('setup.owner_name')} value={name} onChange={setName} autoFocus />
            {error ? <div className="banner warn">{error}</div> : null}
          </div>
        ) : null}
      </div>

      {step !== 'language' ? (
        <div className="screen-footer two">
          {step === 'phone' && (again || auth) ? (
            <Button kind="secondary" onClick={() => navigate(-1)}>
              {t('common.back')}
            </Button>
          ) : step === 'phone' ? (
            <Button kind="secondary" onClick={() => setStep('language')}>
              {t('common.back')}
            </Button>
          ) : (
            <span />
          )}
          {step === 'phone' ? (
            <Button onClick={() => void requestCode()} disabled={busy || phoneText.trim() === ''}>
              {busy ? t('signin.sending') : t('signin.send_code')}
            </Button>
          ) : step === 'code' ? (
            <Button onClick={() => void verify()} disabled={busy || code.length < 6}>
              {busy ? t('signin.checking') : t('signin.verify')}
            </Button>
          ) : (
            <Button onClick={() => void saveName()} disabled={busy}>
              {t('common.next')}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** A short label for the Settings list on other devices: "Android phone", "iPhone", "Browser". */
function deviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/ipad/i.test(ua)) return 'iPad';
  if (/macintosh/i.test(ua)) return 'Mac browser';
  if (/windows/i.test(ua)) return 'Windows browser';
  return 'Browser';
}

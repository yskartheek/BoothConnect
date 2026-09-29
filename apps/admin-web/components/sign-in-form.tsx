'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useId, useState } from 'react';

import { ApiRequestError } from '@/lib/api';
import { authPost, safeNext } from '@/lib/auth-client';
import { t } from '@/lib/i18n';

import { errorMessage } from './states';

/** Phone, then the 6-digit code (#70). Non-admins are sent to the denied page. */
export function SignInForm({ devHint = false }: { devHint?: boolean }) {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phoneId = useId();
  const codeId = useId();
  const hintId = useId();

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await authPost('/auth/request', { phone: phone.trim() });
      setStep('code');
    });
  };

  const verify = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      try {
        await authPost('/auth/verify', { phone: phone.trim(), code: code.trim() });
      } catch (caught) {
        if (caught instanceof ApiRequestError && caught.code === 'NOT_ADMIN') {
          router.replace('/denied');
          return;
        }
        throw caught;
      }
      router.replace(`/sign-in/mfa${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`);
    });
  };

  return step === 'phone' ? (
    <form className="form" onSubmit={sendCode} noValidate>
      <label htmlFor={phoneId}>{t('signIn.phone')}</label>
      <input
        id={phoneId}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        aria-describedby={hintId}
      />
      <p id={hintId} className="form-hint">
        {t('signIn.phoneHint')}
      </p>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <button type="submit" className="button" disabled={busy || !phone.trim()}>
        {t('signIn.sendCode')}
      </button>
    </form>
  ) : (
    <form className="form" onSubmit={verify} noValidate>
      <p role="status">{t('signIn.codeSent', { phone: phone.trim() })}</p>
      <label htmlFor={codeId}>{t('signIn.code')}</label>
      <input
        id={codeId}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
      />
      {devHint ? <p className="form-hint">{t('signIn.devHint')}</p> : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <button type="submit" className="button" disabled={busy || code.length !== 6}>
        {t('signIn.submit')}
      </button>
      <button
        type="button"
        className="button button-quiet"
        onClick={() => {
          setStep('phone');
          setCode('');
          setError(null);
        }}
      >
        {t('signIn.otherNumber')}
      </button>
    </form>
  );
}

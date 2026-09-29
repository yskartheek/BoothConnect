'use client';

import { newIdempotencyKey, type Schemas } from '@boothconnect/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { t } from '@/lib/i18n';

import { errorMessage } from '../states';
import { emptyRoleChoice, grantBody, roleChoiceProblem, RoleFields } from './role-fields';

const E164 = /^\+[1-9]\d{7,14}$/;

/** A failed change: the API's reason for a 422 as it is, otherwise the message for its code. */
export function changeError(error: unknown): string {
  if (error instanceof ApiRequestError && error.status === 422) return error.message;
  return errorMessage(error);
}

/**
 * Adds a user with their first role (POST /v1/users). A phone already used
 * in the organization gets the role on that user (`created: false`); one
 * used elsewhere can't be used (409).
 */
export function AddUser({
  onAdded,
  onCancel,
}: {
  onAdded: (result: Schemas['UserCreated']) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const id = useId();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [language, setLanguage] = useState('en');
  const [role, setRole] = useState(emptyRoleChoice);
  const [problem, setProblem] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: () =>
      unwrap(
        apiClient().POST('/v1/users', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: {
            name: name.trim(),
            phone: phone.trim(),
            preferredLanguage: language,
            ...grantBody(role),
          },
        }),
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onAdded(result);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = !E164.test(phone.trim()) ? t('users.phoneInvalid') : roleChoiceProblem(role);
    setProblem(found);
    if (!found) add.mutate();
  };

  return (
    <section className="glass section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('users.addTitle')}</h2>
      <form className="form" onSubmit={submit} noValidate>
        <label htmlFor={`${id}-name`}>{t('users.name')}</label>
        <input
          id={`${id}-name`}
          value={name}
          maxLength={200}
          required
          onChange={(event) => setName(event.target.value)}
        />
        <label htmlFor={`${id}-phone`}>{t('users.phone')}</label>
        <input
          id={`${id}-phone`}
          type="tel"
          value={phone}
          placeholder="+91"
          required
          aria-describedby={`${id}-phone-hint`}
          onChange={(event) => setPhone(event.target.value)}
        />
        <span id={`${id}-phone-hint`} className="form-hint">
          {t('users.phoneHint')}
        </span>
        <label htmlFor={`${id}-language`}>{t('users.language')}</label>
        <select
          id={`${id}-language`}
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          <option value="en">{t('users.languageEn')}</option>
          <option value="te">{t('users.languageTe')}</option>
        </select>
        <RoleFields value={role} onChange={setRole} />
        {problem ? (
          <p role="alert" className="form-error">
            {problem}
          </p>
        ) : add.isError ? (
          <p role="alert" className="form-error">
            {add.error instanceof ApiRequestError && add.error.status === 409
              ? t('users.phoneUnavailable')
              : changeError(add.error)}
          </p>
        ) : null}
        <div className="form-actions">
          <button type="submit" className="button" disabled={add.isPending || !name.trim()}>
            {t('users.addSave')}
          </button>
          <button type="button" className="button button-quiet" onClick={onCancel}>
            {t('users.cancel')}
          </button>
        </div>
      </form>
    </section>
  );
}

'use client';

import { newIdempotencyKey } from '@boothconnect/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog } from 'radix-ui';
import { type FormEvent, useId, useState } from 'react';

import { ApiRequestError, apiClient, unwrap } from '@/lib/api';
import { t } from '@/lib/i18n';

import { ErrorState, LoadingState } from '../states';
import { changeError } from './add-user';
import { placeLabel, useAdminAreas } from '../area-picker';
import { emptyRoleChoice, grantBody, roleChoiceProblem, RoleFields } from './role-fields';
import { formatDate, ROLE, type RoleAssignment, STATUS, statusOf, type UserSummary } from './roles';

/** One user of the area: their details, role history there, and role changes (#176). */
export function UserDetail({ userId, onClose }: { userId: string; onClose: () => void }) {
  const id = useId();
  const user = useQuery({
    queryKey: ['users', 'detail', userId],
    queryFn: () => unwrap(apiClient().GET('/v1/users/{id}', { params: { path: { id: userId } } })),
  });

  return (
    <section className="glass section" aria-labelledby={`${id}-title`}>
      {user.isPending ? (
        <LoadingState />
      ) : user.isError ? (
        user.error instanceof ApiRequestError && user.error.status === 404 ? (
          <p role="alert">{t('users.notInArea')}</p>
        ) : (
          <ErrorState error={user.error} onRetry={() => void user.refetch()} />
        )
      ) : (
        <>
          <h2 id={`${id}-title`}>{user.data.name}</h2>
          <dl className="details">
            <dt>{t('users.phone')}</dt>
            <dd>{user.data.phone}</dd>
            <dt>{t('users.language')}</dt>
            <dd>
              {user.data.preferredLanguage === 'te' ? t('users.languageTe') : t('users.languageEn')}
            </dd>
          </dl>
          <History user={user.data} />
          <GiveRole userId={user.data.id} />
        </>
      )}
      <div className="form-actions">
        <button type="button" className="button button-quiet" onClick={onClose}>
          {t('users.close')}
        </button>
      </div>
    </section>
  );
}

function History({ user }: { user: UserSummary }) {
  const me = useAdminAreas();
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">
          {t('users.historyCaption', { name: user.name })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t('users.role')}</th>
            <th scope="col">{t('users.place')}</th>
            <th scope="col">{t('users.colFrom')}</th>
            <th scope="col">{t('users.colUntil')}</th>
            <th scope="col">{t('users.colStatus')}</th>
            <th scope="col">{t('users.colGrantedBy')}</th>
            <th scope="col">
              <span className="visually-hidden">{t('users.colActions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {user.assignments.map((assignment) => {
            const status = statusOf(assignment);
            // The API refuses an admin ending their own admin role.
            const own = assignment.role === 'admin' && assignment.userId === me.data?.userId;
            return (
              <tr key={assignment.id}>
                <td>{t(ROLE[assignment.role])}</td>
                <td>{placeLabel(assignment.node)}</td>
                <td>{formatDate(assignment.validFrom)}</td>
                <td>
                  {assignment.validUntil ? formatDate(assignment.validUntil) : t('users.openEnded')}
                </td>
                <td>
                  <span className={`badge badge-${status}`}>{t(STATUS[status])}</span>
                </td>
                <td>{assignment.grantedBy?.name ?? t('users.serverSetup')}</td>
                <td>
                  {status !== 'ended' && !own && me.isSuccess ? (
                    <EndRole user={user} assignment={assignment} />
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "End role", after a confirmation (DELETE /v1/role-assignments/:id). */
function EndRole({ user, assignment }: { user: UserSummary; assignment: RoleAssignment }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const role = t(ROLE[assignment.role]);
  const place = placeLabel(assignment.node);
  const end = useMutation({
    mutationFn: () =>
      unwrap(
        apiClient().DELETE('/v1/role-assignments/{id}', {
          params: {
            path: { id: assignment.id },
            header: { 'Idempotency-Key': newIdempotencyKey() },
          },
        }),
      ),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) end.reset();
      }}
    >
      <AlertDialog.Trigger asChild>
        <button
          type="button"
          className="button button-quiet button-small"
          aria-label={t('users.endRoleLabel', { role, place })}
        >
          {t('users.endRole')}
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog glass">
          <AlertDialog.Title>{t('users.endTitle')}</AlertDialog.Title>
          <AlertDialog.Description>
            {t('users.endMessage', { name: user.name, role, place })}
          </AlertDialog.Description>
          {end.isError ? (
            <p role="alert" className="form-error">
              {changeError(end.error)}
            </p>
          ) : null}
          <div className="form-actions">
            <AlertDialog.Cancel asChild>
              <button type="button" className="button button-quiet">
                {t('users.cancel')}
              </button>
            </AlertDialog.Cancel>
            {/* Not AlertDialog.Action: that would close before the request is answered. */}
            <button
              type="button"
              className="button button-danger"
              disabled={end.isPending}
              onClick={() => end.mutate()}
            >
              {t('users.endRole')}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** Gives the user another role in the area (POST /v1/role-assignments). */
function GiveRole({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const id = useId();
  const [choice, setChoice] = useState(emptyRoleChoice);
  const [problem, setProblem] = useState<string | null>(null);
  const [given, setGiven] = useState(false);
  const grant = useMutation({
    mutationFn: () =>
      unwrap(
        apiClient().POST('/v1/role-assignments', {
          params: { header: { 'Idempotency-Key': newIdempotencyKey() } },
          body: { userId, ...grantBody(choice) },
        }),
      ),
    onMutate: () => setGiven(false),
    onSuccess: async () => {
      setChoice(emptyRoleChoice());
      setGiven(true);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = roleChoiceProblem(choice);
    setProblem(found);
    if (!found) grant.mutate();
  };

  return (
    <form className="form" onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t('users.giveTitle')}</h3>
      <RoleFields value={choice} onChange={setChoice} />
      {problem ? (
        <p role="alert" className="form-error">
          {problem}
        </p>
      ) : grant.isError ? (
        <p role="alert" className="form-error">
          {changeError(grant.error)}
        </p>
      ) : given ? (
        <p role="status" className="form-success">
          {t('users.given')}
        </p>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="button" disabled={grant.isPending}>
          {t('users.give')}
        </button>
      </div>
    </form>
  );
}

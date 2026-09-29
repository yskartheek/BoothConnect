'use client';

import { useId } from 'react';

import { t } from '@/lib/i18n';

import { AreaPicker, type AreaNode } from './area-picker';
import { GRANTABLE_ROLES, type GrantableRole, ROLE, startOfDay } from './roles';

/** What the role fields hold: the role, the place (a path in the area), and optional dates. */
export interface RoleChoice {
  role: GrantableRole;
  path: AreaNode[];
  from: string;
  until: string;
}

export const emptyRoleChoice = (): RoleChoice => ({
  role: 'volunteer',
  path: [],
  from: '',
  until: '',
});

/**
 * Why the choice can't be sent yet, or null. The API checks the same rules
 * (and says so in a 422); this only saves a round trip.
 */
export function roleChoiceProblem(choice: RoleChoice): string | null {
  const node = choice.path.at(-1);
  if (!node) return t('users.pickPlace');
  if (choice.role === 'volunteer' && node.type !== 'polling_station') {
    return t('users.volunteerHint');
  }
  if (choice.from && choice.until && choice.until <= choice.from) return t('users.datesOrder');
  return null;
}

/** The body fields of POST /v1/users and POST /v1/role-assignments. */
export function grantBody(choice: RoleChoice) {
  const validFrom = startOfDay(choice.from);
  const validUntil = startOfDay(choice.until);
  return {
    role: choice.role,
    geographyNodeId: choice.path.at(-1)!.id,
    ...(validFrom ? { validFrom } : {}),
    ...(validUntil ? { validUntil } : {}),
  };
}

/** Role, place and optional start and end dates. */
export function RoleFields({
  value,
  onChange,
}: {
  value: RoleChoice;
  onChange: (value: RoleChoice) => void;
}) {
  const id = useId();
  const set = (patch: Partial<RoleChoice>) => onChange({ ...value, ...patch });
  return (
    <>
      <label htmlFor={`${id}-role`}>{t('users.role')}</label>
      <select
        id={`${id}-role`}
        value={value.role}
        aria-describedby={`${id}-role-hint`}
        onChange={(event) => set({ role: event.target.value as GrantableRole })}
      >
        {GRANTABLE_ROLES.map((role) => (
          <option key={role} value={role}>
            {t(ROLE[role])}
          </option>
        ))}
      </select>
      <span id={`${id}-role-hint`} className="form-hint">
        {value.role === 'volunteer' ? t('users.volunteerHint') : t('users.placeHint')}
      </span>
      <AreaPicker
        legend={t('users.place')}
        path={value.path}
        emptyLabel={t('users.choose')}
        onChange={(path) => set({ path })}
      />
      <label htmlFor={`${id}-from`}>{t('users.from')}</label>
      <input
        id={`${id}-from`}
        type="date"
        value={value.from}
        aria-describedby={`${id}-dates-hint`}
        onChange={(event) => set({ from: event.target.value })}
      />
      <label htmlFor={`${id}-until`}>{t('users.until')}</label>
      <input
        id={`${id}-until`}
        type="date"
        value={value.until}
        aria-describedby={`${id}-dates-hint`}
        onChange={(event) => set({ until: event.target.value })}
      />
      <span id={`${id}-dates-hint`} className="form-hint">
        {t('users.datesHint')}
      </span>
    </>
  );
}

'use client';

import { Popover } from 'radix-ui';

import { t } from '@/lib/i18n';

import { AppearanceControls } from './appearance-controls';

/** The "Appearance" button in the top bar, opening the theme and transparency controls. */
export function AppearanceMenu() {
  return (
    <Popover.Root>
      <Popover.Trigger className="button button-quiet">{t('appearance.legend')}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" align="end" sideOffset={8}>
          <AppearanceControls />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * No serious or critical accessibility problems on the page as it is now
 * (WCAG 2.1 A and AA rules). #77 runs this on every Milestone 1 page.
 */
export async function expectAccessible(page: Page) {
  // Next streams the <title> of a dynamic page after its body: let it arrive.
  await expect(page).toHaveTitle(/\S/);
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
  expect(serious).toEqual([]);
}

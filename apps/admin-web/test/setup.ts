import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy…/waitFor give up after 1 s by default. On a busy CI runner the
// first render of a page (module loading, React Query) can take longer.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
});

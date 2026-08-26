import { describe, it } from 'vitest';

// #795: commandUtils' static, user-facing guard messages (requireGame's
// "No game loaded" text, NO_EMPLOYEES_MSG, and parseStaffedFlag's invalid-value
// message) now route through t() — see src/core/i18n/I18n.ts. Real test cases
// land in the tests phase; this file is the skeleton-phase scaffold only.
describe('commandUtils', () => {
  it.todo('covers requireGame, NO_EMPLOYEES_MSG, and parseStaffedFlag through t()');
});

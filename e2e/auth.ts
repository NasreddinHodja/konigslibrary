/// The admin the browser tests set up on their own server (see
/// playwright.config.ts) and log in as.
export const ADMIN = { username: 'e2e', password: 'e2e-password' };

/// Preset as the server's setup token, so the tests can set it up.
export const SETUP_TOKEN = 'e2e-setup-token-0123456789abcdef';

/// The logged-in browser state every test starts from.
export const STORAGE_STATE = 'test-results/auth.json';

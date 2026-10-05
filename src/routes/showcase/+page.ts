import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

/// The redesign's showcase (docs/design/system.org): a dev tool, not part of
/// any build.
export function load() {
  if (!dev) error(404);
}

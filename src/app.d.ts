// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    interface Error {
      message: string;
    }
    // interface Locals {}
    // interface PageData {}
    interface PageState {
      /// The entry pushed while a manga is open; back from it closes one layer.
      kl?: 'reader';
      /// Reached by a link or `goto` in the app, so back returns into it.
      fromApp?: boolean;
    }
    // interface Platform {}
  }
}

export {};

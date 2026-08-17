// Not a Server Action file -- "use server" modules may only export async
// functions, so this constant (shared between the connect action and the
// callback route) has to live outside actions.ts.
export const OAUTH_STATE_COOKIE = "google_oauth_state";

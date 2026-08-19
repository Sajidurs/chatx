import "server-only";

// The canonical IANA list, used both to populate the onboarding dropdown and
// to validate a submitted value server-side -- Node's Intl has shipped this
// since v18, so no third-party timezone-data package is needed.
export const TIMEZONES: string[] = Intl.supportedValuesOf("timeZone");

export const DEFAULT_TIMEZONE = "UTC";

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Converts a datetime string that may or may not carry a UTC offset into a
 * real UTC instant. If it already has one (Claude occasionally adds "Z"
 * despite being told not to), that offset is trusted as-is. Otherwise it's
 * treated as a bare local wall-clock time IN `timeZone` -- this is the piece
 * that keeps our own `bookings.start_time`/`end_time` (timestamptz columns)
 * in sync with what actually gets written to Google Calendar: Google is
 * given the bare local string plus a `timeZone` field and resolves it
 * correctly on its own, but a bare string handed straight to Postgres would
 * be parsed in the *server's* session timezone, not the business's --
 * exactly the original bug, just moved one layer down.
 *
 * Uses the standard two-pass Intl trick (also how date-fns-tz/Luxon resolve
 * a zoned wall-clock time) since Node has no stable Temporal API yet.
 */
export function resolveToUtcIso(raw: string, timeZone: string): string {
  if (HAS_OFFSET.test(raw)) return new Date(raw).toISOString();

  const asIfUtc = new Date(raw.endsWith("Z") ? raw : `${raw}Z`);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(asIfUtc).map((p) => [p.type, p.value]));
  const shownAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  const offsetMs = shownAsUtc - asIfUtc.getTime();
  return new Date(asIfUtc.getTime() - offsetMs).toISOString();
}

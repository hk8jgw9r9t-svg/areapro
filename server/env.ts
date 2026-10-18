// Serverseitige Konfiguration – ausschließlich Umgebungsvariablen, nie im Frontend-Bundle.
import 'server-only';

export const env = {
  appUrl: process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',

  calendlyToken: process.env.CALENDLY_PAT ?? '',
  calendlyEventTypeUri: process.env.CALENDLY_EVENT_TYPE_URI ?? '',
  calendlyEventTypeName: process.env.CALENDLY_EVENT_TYPE_NAME ?? 'Beratungstermin HEIM & HAUS',
  calendlyBookingMode: (process.env.CALENDLY_BOOKING_MODE ?? 'auto') as 'auto' | 'api' | 'embed' | 'link',
  calendlySigningKey: process.env.CALENDLY_WEBHOOK_SIGNING_KEY ?? '',
  calendlyFallbackEmail: process.env.CALENDLY_FALLBACK_INVITEE_EMAIL ?? '',
  calendlyTimezone: process.env.CALENDLY_TIMEZONE ?? 'Europe/Berlin',

  googleClientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '',
  googlePrivateKey: (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  googleSpreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? '',
};

export const configured = {
  supabase: Boolean(env.supabaseUrl && env.supabaseAnonKey),
  supabaseAdmin: Boolean(env.supabaseUrl && env.supabaseServiceKey),
  calendly: Boolean(env.calendlyToken),
  google: Boolean(env.googleClientEmail && env.googlePrivateKey && env.googleSpreadsheetId),
};

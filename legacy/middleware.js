// Optional password gate.
// Delete this file if you do not want one.
//
// Set these two environment variables in Vercel (Project → Settings → Environment Variables):
//   SITE_USER      e.g. balloonista
//   SITE_PASSWORD  something long
// If SITE_PASSWORD is not set, the site is left open.

export const config = { matcher: '/((?!_next|favicon).*)' };

export default function middleware(request) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return; // no password configured — let everyone through

  const user = process.env.SITE_USER || 'balloonista';
  const header = request.headers.get('authorization') || '';

  if (header.startsWith('Basic ')) {
    let decoded = '';
    try {
      decoded = atob(header.slice(6));
    } catch (e) {
      decoded = '';
    }
    const i = decoded.indexOf(':');
    if (i !== -1) {
      const u = decoded.slice(0, i);
      const p = decoded.slice(i + 1);
      if (u === user && p === password) return; // authorised
    }
  }

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Balloonista Lead Desk", charset="UTF-8"',
    },
  });
}

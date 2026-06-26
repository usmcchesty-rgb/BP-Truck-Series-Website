import { next, rewrite } from '@vercel/functions';

const BOT_PATTERN =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|WhatsApp|Slackbot|Discordbot|TelegramBot|Pinterest/i;

function rewriteToApi(request, pathname, searchParams) {
  const dest = new URL(request.url);
  dest.pathname = pathname;
  dest.search = searchParams.toString() ? `?${searchParams.toString()}` : '';
  return rewrite(dest);
}

export default function middleware(request) {
  try {
    const userAgent = request.headers.get('user-agent') || '';
    if (!BOT_PATTERN.test(userAgent)) {
      return next();
    }

    const url = new URL(request.url);
    const newsMatch = url.pathname.match(/^\/news\/([^/]+)\/?$/);
    if (newsMatch?.[1]) {
      const slug = decodeURIComponent(newsMatch[1]);
      const params = new URLSearchParams({
        slug,
        format: 'html',
      });
      return rewriteToApi(request, '/api/news', params);
    }

    const driverMatch = url.pathname.match(/^\/drivers\/([^/]+)\/?$/);
    if (driverMatch?.[1]) {
      const driverId = decodeURIComponent(driverMatch[1]);
      const params = new URLSearchParams({
        driver_id: driverId,
        format: 'html',
      });
      return rewriteToApi(request, '/api/drivers', params);
    }

    return next();
  } catch {
    return next();
  }
}

export const config = {
  matcher: ['/news/:slug', '/drivers/:driverId'],
};

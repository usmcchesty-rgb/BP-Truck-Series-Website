const BOT_PATTERN =
  /facebookexternalhit|Facebot|Twitterbot|LinkedInBot|WhatsApp|Slackbot|Discordbot|TelegramBot|Pinterest/i;

export default function middleware(request) {
  const userAgent = request.headers.get('user-agent') || '';
  if (!BOT_PATTERN.test(userAgent)) {
    return;
  }

  const url = new URL(request.url);
  const newsMatch = url.pathname.match(/^\/news\/([^/]+)\/?$/);
  if (newsMatch?.[1]) {
    const slug = decodeURIComponent(newsMatch[1]);
    return Response.rewrite(
      new URL(`/api/news?slug=${encodeURIComponent(slug)}&format=html`, request.url)
    );
  }

  const driverMatch = url.pathname.match(/^\/drivers\/([^/]+)\/?$/);
  if (driverMatch?.[1]) {
    const driverId = decodeURIComponent(driverMatch[1]);
    return Response.rewrite(
      new URL(`/api/drivers?driver_id=${encodeURIComponent(driverId)}&format=html`, request.url)
    );
  }
}

export const config = {
  matcher: ['/news/:slug', '/drivers/:driverId'],
};

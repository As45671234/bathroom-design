/*
 * Прокси для Gemini API на Cloudflare Workers.
 *
 * Зачем: Google отвечает 400 FAILED_PRECONDITION "User location is not
 * supported" на запросы с IP нашего хостинга (AS39318, PS.KZ). Сама страна
 * Казахстан при этом обслуживается — тот же ключ прекрасно работает с
 * домашнего интернета. То есть блокируется не страна, а диапазон дата-центра.
 * Воркер просто пересылает запрос к Google со своего адреса.
 *
 * Как выложить (5 минут, бесплатно, карта не нужна):
 *   1. dash.cloudflare.com → зарегистрироваться → Workers & Pages → Create → Worker
 *   2. Задать имя, Deploy, затем "Edit code"
 *   3. Вставить этот файл целиком вместо содержимого, Deploy
 *   4. Settings → Variables → Add variable: PROXY_SECRET = придуманная строка
 *   5. Скопировать адрес воркера вида https://<имя>.<аккаунт>.workers.dev
 *
 * Дальше на сервере в backend/.env:
 *   GEMINI_BASE_URL=https://<имя>.<аккаунт>.workers.dev
 *   GEMINI_PROXY_SECRET=<та же строка, что в PROXY_SECRET>
 *
 * Лимит бесплатного тарифа — 100 000 запросов в сутки, для визуального поиска
 * это с огромным запасом.
 */

const UPSTREAM = "https://generativelanguage.googleapis.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Без этой проверки воркер стал бы открытым прокси к Gemini для всех, кто
    // угадает адрес: наш ключ они бы не увидели, но квоту чужими запросами
    // выжечь смогли бы.
    if (env.PROXY_SECRET && request.headers.get("x-proxy-secret") !== env.PROXY_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    // Путь и query (в них лежит ?key=...) передаём как есть — меняется только хост.
    const target = UPSTREAM + url.pathname + url.search;

    const headers = new Headers(request.headers);
    headers.delete("x-proxy-secret");
    headers.delete("host");

    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers
    });
  }
};

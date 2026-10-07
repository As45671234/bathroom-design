# nginx: включить серверный рендер SEO

Без этой правки весь код из `backend/src/services/seoRender.js` неактивен:
nginx по-прежнему отдаёт `frontend/dist/index.html` напрямую с диска, и
краулер видит ту же пустую страницу, что и раньше.

Конфиг на сервере: `/etc/nginx/sites-available/bathroomdesign`.

## Что меняется

Было (SPA-фоллбэк отдаёт файл с диска):

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

Стало (несуществующий путь уходит в Node, который собирает HTML):

```nginx
# Статика по-прежнему отдаётся nginx напрямую — в Node уходят только
# навигационные запросы, у которых нет файла на диске.
location / {
    try_files $uri @ssr;
}

location @ssr {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Важно: в блоке `location /` **не должно остаться** `index index.html;` и
`$uri/` в `try_files` — иначе запрос `/` снова найдёт файл на диске и
пройдёт мимо Node.

Блок `location = /index.html { add_header Cache-Control "no-cache"; }`
(добавлен 2026-10-01) можно оставить: он касается прямого обращения к
`/index.html`, а не к `/`.

## Редирект www → апекс

Сейчас `https://www.bathroomdesign.kz/` отдаёт 200 — то есть весь сайт
доступен на двух хостах. Canonical это частично гасит, но честный 301
лучше. В серверном блоке, который слушает 443 и покрывает оба домена,
добавить в самое начало:

```nginx
if ($host = www.bathroomdesign.kz) {
    return 301 https://bathroomdesign.kz$request_uri;
}
```

## Применение

```bash
sudo cp /etc/nginx/sites-available/bathroomdesign \
        /etc/nginx/sites-available/bathroomdesign.bak-$(date +%F)
sudo nano /etc/nginx/sites-available/bathroomdesign   # внести правки выше
sudo nginx -t && sudo systemctl reload nginx
```

## Проверка

```bash
# 1. Разные страницы — разные title (раньше были одинаковые)
curl -s https://bathroomdesign.kz/ | grep -o '<title>[^<]*</title>'
curl -s https://bathroomdesign.kz/catalog/smesiteli | grep -o '<title>[^<]*</title>'
curl -s https://bathroomdesign.kz/brand/allen-brau | grep -o '<title>[^<]*</title>'

# 2. В #root есть текст, а не пустой div
curl -s https://bathroomdesign.kz/brand/allen-brau | grep -o '<div id="root">.\{0,80\}'

# 3. Несуществующий URL отдаёт 404, а не 200
curl -s -o /dev/null -w '%{http_code}\n' https://bathroomdesign.kz/net-takoy-stranicy

# 4. Ассеты по-прежнему идут с диска и кэшируются намертво
curl -sI https://bathroomdesign.kz/assets/$(curl -s https://bathroomdesign.kz/ \
  | grep -o 'assets/index-[^"]*\.js' | head -1 | cut -d/ -f2) | grep -i cache-control

# 5. www редиректится
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' https://www.bathroomdesign.kz/
```

Ожидаем: три разных title, непустой `#root`, `404`, `immutable` на бандле,
`301` на www.

## Откат

```bash
sudo cp /etc/nginx/sites-available/bathroomdesign.bak-<дата> \
        /etc/nginx/sites-available/bathroomdesign
sudo nginx -t && sudo systemctl reload nginx
```

Код в Node при этом можно не трогать: без правки nginx он просто не
получает HTML-запросы.

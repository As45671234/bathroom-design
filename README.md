# Bathroom Design — каталог сайт

Техническая архитектура взята с проекта arcmet (Node/Express + MongoDB backend,
React + Vite frontend), адаптирована под каталог сантехники/мебели для ванной.
Дизайн — временный, будет полностью переделан позже; сейчас важна рабочая база
(каталог, корзина, заказы, админка, импорт из Excel).

## Стек

- **backend**: Node.js, Express, MongoDB (Mongoose), JWT-авторизация админки,
  загрузка изображений (sharp → webp), массовый импорт товаров из Excel
  (.xlsx, с извлечением встроенных картинок).
- **frontend**: React 19, TypeScript, Vite, react-router-dom, Tailwind (через CDN).

## Быстрый старт

### 1. MongoDB

Локальный MongoDB уже установлен и работает как служба Windows (`MongoDB`,
слушает `localhost:27017`). Если сервис остановлен — запустите:

```powershell
Start-Service MongoDB
```

### 2. Backend

```bash
cd backend
npm install
npm run dev   # http://localhost:3001
```

Настройки — в `backend/.env`:

- `MONGODB_URI` — по умолчанию `mongodb://localhost:27017/bathroom-design`.
- `ADMIN_PASSWORD`, `JWT_SECRET`, `ADMIN_PURGE_PASSWORD` — **обязательно
  замените** значения-заглушки перед реальным использованием/деплоем.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000, проксирует /api на backend
```

Админка: `http://localhost:3000/admin` (пароль — `ADMIN_PASSWORD` из backend/.env).

## Модель данных (упрощено относительно arcmet)

- **Product**: `category_id/category_title`, `name`, `brand` (производитель,
  напр. Grohe), `collection` (серия/коллекция), `sku`, `image(s)`,
  `prices: { retail, oldPrice, wholesale, note }`, `attrs` (свободные
  характеристики: цвет, материал, размер и т.д.), `inStock/active`.
- **CategoryMeta**: карточка категории (заголовок, картинка, видео, SEO-поля).
- **Order / Lead**: заявки с сайта (корзина/консультация).
- **SiteSettings**: контакты, способы оплаты (Kaspi/Halyk/наличные), слайды
  главной страницы — редактируются через админку ("конструктор" главной).

## Импорт товаров из Excel

В админке: выбираете категорию → загружаете `.xlsx`. Названия колонок
распознаются по ключевым словам (артикул, наименование, цена, бренд,
коллекция, цвет, материал, размер и т.д.), остальные непустые колонки
автоматически становятся произвольными характеристиками товара. Картинки,
вставленные в ячейки Excel, извлекаются автоматически.

## Что осталось на потом

- Дизайн — временный, будет переделываться.
- Домен `bathroomdesign.kz` — заглушка в `index.html`/`sitemap.xml`, заменить
  на реальный при деплое.
- Перед продакшеном — сменить пароли/секреты в `backend/.env`.

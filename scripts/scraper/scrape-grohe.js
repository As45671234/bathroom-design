// Scrapes GROHE's site (grohe.com) into one .xlsx, same column layout as
// scrape.js (Номенклатура, Артикул, Бренд, Коллекция, Подкатегория, Цвет,
// Характеристики, Описание, Картинка 1..N) so it drops straight into the
// same admin importer.
//
// Unlike allenbrau.ru, GROHE's site blocks a plain HTTP fetch (403) - a real
// browser gets through fine, which is why this uses Playwright throughout,
// including for the listing pages.
//
// Usage:
//   node scrape-grohe.js "<listing URL>" [moreUrls...] [--headless] [--out=name]
//
// Example (GROHE Essence collection, toilet zone only):
//   node scrape-grohe.js "https://www.grohe.com/ru-KZ/category/bathroom/toilet/regular_toilet?filters=facetid_eyJ0eXBlIjoiZXEiLCJuYW1lIjoiY29sbGVjdGlvbl9uYW1lIiwidmFsdWUiOiJFc3NlbmNlIn0="
//
// Each listing URL is a GROHE category page, optionally with a
// "?filters=facetid_..." collection filter already applied (copy it
// straight from the browser address bar after picking the collection on
// grohe.com). Pass several URLs to combine multiple categories into one
// output file.

const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.grohe.com';
const OUT_DIR = path.join(__dirname, 'out');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const REQUEST_DELAY_MS = 300;
const RETRIES_PER_PRODUCT = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function dismissCookieBanner(page) {
  const rejectBtn = page.locator('button:has-text("Отклонить все")').first();
  if (await rejectBtn.count().catch(() => 0)) {
    await rejectBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

// Repeatedly clicks "Загрузить ещё" until every product on the listing is
// loaded, then collects every /product/ link on the page.
async function collectListingLinks(page, url, log) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1000);
  await dismissCookieBanner(page);

  for (let i = 0; i < 40; i++) {
    const moreBtn = page.locator('button:has-text("Загрузить ещё")').first();
    if (!(await moreBtn.count().catch(() => 0))) break;
    const visible = await moreBtn.isVisible().catch(() => false);
    if (!visible) break;
    await moreBtn.scrollIntoViewIfNeeded().catch(() => {});
    await moreBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
  }

  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/product/"]')).map((a) => a.getAttribute('href'))
  );
  const unique = Array.from(new Set(links));
  log(`  ${url} -> ${unique.length} товаров`);
  return unique;
}

// The site proxies every image through Next.js's /_next/image?url=<encoded>
// resizer - unwrap that to the original CDN URL instead of hotlinking the
// resizer (which is tied to this deployment and not guaranteed stable).
function unwrapNextImageUrl(src) {
  if (!src) return '';
  const abs = src.startsWith('http') ? src : BASE + src;
  try {
    const u = new URL(abs);
    const inner = u.searchParams.get('url');
    return inner ? decodeURIComponent(inner) : abs;
  } catch (e) {
    return abs;
  }
}

function shortenDescription(text, maxLen = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const firstSentence = clean.match(/^.{1,400}?[.!?](?:\s|$)/);
  const candidate = firstSentence ? firstSentence[0].trim() : clean;
  if (candidate.length <= maxLen) return candidate;
  return candidate.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(800);
  await dismissCookieBanner(page);

  // The detailed spec table only renders once the "Спецификация" tab is
  // actually selected.
  const specTab = page.locator('button:has-text("Спецификация"), a:has-text("Спецификация")').first();
  if (await specTab.count().catch(() => 0)) {
    await specTab.scrollIntoViewIfNeeded().catch(() => {});
    await specTab.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
  }

  const data = await page.evaluate(() => {
    const prefix = document.querySelector('[data-testid="pdp-title-prefix"]')?.textContent?.trim() || '';
    const body = document.querySelector('[data-testid="pdp-title-body"]')?.textContent?.trim() || '';
    const [brand, collection] = prefix.split('|').map((s) => s.trim());

    const articleBtn = document.querySelector('button[aria-label="Копировать артикул товара"]');
    const articleSpan = articleBtn ? articleBtn.parentElement : null;
    const article = articleSpan
      ? Array.from(articleSpan.childNodes).find((n) => n.nodeType === 3)?.textContent?.trim() || ''
      : '';

    const characteristics = Array.from(document.querySelectorAll('table tr'))
      .map((tr) => Array.from(tr.children).map((c) => c.textContent.trim()))
      .filter((cells) => cells.length === 2 && cells[0] && cells[1]);

    const description = document.querySelector('[data-testid="accordion-root"] p')?.textContent?.trim() || '';

    const images = Array.from(document.querySelectorAll('[data-testid="pdp-product-gallery"] img'))
      .map((img) => img.getAttribute('src'))
      .filter(Boolean);

    let breadcrumbSubcategory = '';
    const ldScripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of ldScripts) {
      try {
        const j = JSON.parse(s.textContent);
        if (j['@type'] === 'BreadcrumbList' && Array.isArray(j.itemListElement)) {
          const items = j.itemListElement;
          const leaf = items[items.length - 2] || items[items.length - 1];
          if (leaf) breadcrumbSubcategory = leaf.name || '';
        }
      } catch (e) {}
    }

    return {
      name: [brand, collection, body].filter(Boolean).join(' '),
      brand: brand || '',
      collection: collection || '',
      subcategory: breadcrumbSubcategory,
      article,
      characteristics,
      description,
      images: Array.from(new Set(images))
    };
  });

  data.images = data.images.map(unwrapNextImageUrl).filter(Boolean);
  return data;
}

function buildRow(product) {
  const characteristicsText = product.characteristics.map(([k, v]) => `${k}: ${v}`).join('\n');
  return {
    'Номенклатура': product.name,
    'Артикул': product.article,
    'Бренд': product.brand || 'GROHE',
    'Коллекция': product.collection,
    'Подкатегория': product.subcategory,
    'Цвет': '',
    'Характеристики': characteristicsText,
    'Описание': shortenDescription(product.description),
    images: product.images
  };
}

async function writeXlsx(rows, filePath) {
  const maxImages = rows.reduce((m, r) => Math.max(m, r.images.length), 1);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Товары');

  const headers = ['Номенклатура', 'Артикул', 'Бренд', 'Коллекция', 'Подкатегория', 'Цвет', 'Характеристики', 'Описание'];
  for (let i = 1; i <= maxImages; i++) headers.push(`Картинка ${i}`);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };

  for (const row of rows) {
    const values = [
      row['Номенклатура'], row['Артикул'], row['Бренд'], row['Коллекция'], row['Подкатегория'], row['Цвет'],
      row['Характеристики'], row['Описание']
    ];
    for (let i = 0; i < maxImages; i++) values.push(row.images[i] || '');
    ws.addRow(values);
  }

  ws.columns.forEach((col, idx) => { col.width = idx === 6 ? 60 : idx === 7 ? 40 : 24; });
  ws.getColumn(7).alignment = { wrapText: true };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await wb.xlsx.writeFile(filePath);
}

async function main() {
  const args = process.argv.slice(2);
  const headless = args.includes('--headless');
  const outArg = args.find((a) => a.startsWith('--out='));
  const outName = outArg ? outArg.slice('--out='.length) : 'grohe';
  const urls = args.filter((a) => !a.startsWith('--'));

  if (!urls.length) {
    console.error('Использование: node scrape-grohe.js "<url листинга>" [ещё url...] [--out=имя] [--headless]');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const checkpointPath = path.join(OUT_DIR, `${outName}.json`);
  const xlsxPath = path.join(OUT_DIR, `${outName}.xlsx`);

  let scraped = {};
  if (fs.existsSync(checkpointPath)) {
    scraped = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    console.log(`Резюме: уже есть ${Object.keys(scraped).length} товаров в чекпоинте ${outName}.json`);
  }

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 30 });
  const page = await browser.newPage({ userAgent: UA });

  const allLinks = new Set();
  for (const url of urls) {
    const links = await collectListingLinks(page, url, (m) => console.log(m));
    links.forEach((l) => allLinks.add(l));
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`Всего уникальных товаров: ${allLinks.size}`);

  const failed = [];
  let done = 0;
  for (const href of allLinks) {
    const url = href.startsWith('http') ? href : BASE + href;
    done++;
    if (scraped[url]) continue;

    let attempt = 0;
    let ok = false;
    while (attempt <= RETRIES_PER_PRODUCT && !ok) {
      try {
        const data = await extractProduct(page, url);
        scraped[url] = { ...data, url };
        ok = true;
      } catch (e) {
        attempt++;
        if (attempt > RETRIES_PER_PRODUCT) {
          console.log(`  ! не удалось: ${url} (${e.message})`);
          failed.push(url);
        } else {
          await sleep(500);
        }
      }
    }

    console.log(`  ${done}/${allLinks.size} обработано`);
    fs.writeFileSync(checkpointPath, JSON.stringify(scraped, null, 2));
    await sleep(REQUEST_DELAY_MS);
  }

  const rows = Object.values(scraped).map((p) => buildRow(p));
  await writeXlsx(rows, xlsxPath);
  console.log(`Готово: ${rows.length} товаров -> ${xlsxPath}`);
  if (failed.length) console.log(`Не удалось получить ${failed.length} товаров`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

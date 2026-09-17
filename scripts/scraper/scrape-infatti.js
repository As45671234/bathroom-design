// Scrapes infatti.kz into one .xlsx, same column layout as the other
// scrapers (Номенклатура, Артикул, Бренд, Коллекция, Подкатегория, Цвет,
// Характеристики, Описание, Картинка 1..N).
//
// infatti.kz is plain server-rendered HTML with a real brand-filter query
// param, e.g. https://infatti.kz/vanny?brands[]=7 for Villeroy&Boch on the
// "Ванны" listing - find the right brand id by opening the listing page and
// checking the brand checkbox's value="N" in devtools, or just pass the
// pre-filtered URL copied straight from the browser address bar.
//
// Usage:
//   node scrape-infatti.js "<listing URL>" [moreUrls...] [--headless] [--out=name]
//
// Example (Villeroy&Boch bathtubs):
//   node scrape-infatti.js "https://infatti.kz/vanny?brands[]=7" --out=infatti-villeroyboch-vanny

const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const BASE = 'https://infatti.kz';
const OUT_DIR = path.join(__dirname, 'out');

const REQUEST_DELAY_MS = 250;
const MAX_LIST_PAGES = 40;
const STAGNANT_PAGES_TO_STOP = 2;
const RETRIES_PER_PRODUCT = 2;

// Characteristic rows that are stock/warehouse info, not real product specs.
const SKIP_CHAR_KEYS = /^склад/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withPage(url, page) {
  const u = new URL(url, BASE);
  if (page > 1) u.searchParams.set('page', String(page));
  return u.toString();
}

function isProductHref(href, sectionPath) {
  if (!href) return false;
  const [pathOnly] = href.split('?');
  // Restrict to the section we're actually scraping - the page also links
  // to the site's full mega-menu (other categories entirely), which are
  // 3+ segments deep too and would otherwise be picked up as "products".
  if (!pathOnly.startsWith(sectionPath + '/')) return false;
  const parts = pathOnly.replace(/^\/+|\/+$/g, '').split('/');
  return parts.length >= 3;
}

async function collectListingLinks(page, baseUrl, sectionPath, log) {
  const all = new Set();
  let stagnant = 0;

  for (let p = 1; p <= MAX_LIST_PAGES; p++) {
    const url = withPage(baseUrl, p);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    } catch (e) {
      log(`  page ${p}: failed to load (${e.message}), stopping`);
      break;
    }

    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'))
    );
    const productHrefs = hrefs.filter((h) => isProductHref(h, sectionPath));

    const before = all.size;
    productHrefs.forEach((h) => all.add(h));
    const added = all.size - before;
    log(`  page ${p}: +${added} new (total ${all.size})`);

    if (added === 0) stagnant++; else stagnant = 0;
    if (stagnant >= STAGNANT_PAGES_TO_STOP) break;

    await sleep(REQUEST_DELAY_MS);
  }

  return Array.from(all);
}

// The top nav lists every subcategory under a section (e.g. every bathtub
// type under /vanny) - use it to translate a product URL's subcategory slug
// into the same human title the site itself uses, without needing a
// separate breadcrumb lookup per product.
async function buildSubcategoryTitleMap(page, sectionPath) {
  const map = {};
  const links = await page.evaluate((prefix) =>
    Array.from(document.querySelectorAll(`a[href^="${prefix}/"]`)).map((a) => ({
      href: a.getAttribute('href'),
      text: a.textContent.trim()
    })),
  sectionPath);

  for (const { href, text } of links) {
    const parts = href.split('?')[0].replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length === 2 && text) map[parts[1]] = text;
  }
  return map;
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

  const data = await page.evaluate(() => {
    const name = document.querySelector('h1')?.textContent?.trim() || '';
    const article = document.querySelector('[itemprop="sku"]')?.getAttribute('content')?.trim() || '';
    const brand = document.querySelector('[itemprop="brand"]')?.textContent?.trim() || '';

    const characteristics = Array.from(document.querySelectorAll('.tableRow__th'))
      .map((th) => {
        const row = th.parentElement;
        const val = row.querySelector('.tableRow__td');
        const key = th.textContent.replace(/:\s*$/, '').trim();
        const value = val ? val.textContent.trim() : '';
        return [key, value];
      })
      .filter(([k, v]) => k && v);

    // The site mistakenly puts itemprop="description" on the "Коллекция"
    // spec row too, so a plain [itemprop="description"] selector grabs the
    // wrong one - .tabSingle__text is the real description tab specifically.
    const description = document.querySelector('.tabSingle__text')?.textContent?.trim() || '';

    const images = Array.from(document.querySelectorAll('a[data-fancybox="gallery"]'))
      .map((a) => a.getAttribute('href'))
      .filter(Boolean);

    return { name, article, brand, characteristics, description, images: Array.from(new Set(images)) };
  });

  data.images = data.images.map((src) => (src.startsWith('http') ? src : BASE + src));

  const urlPath = new URL(url).pathname.replace(/^\/+|\/+$/g, '').split('/');
  data.subcategorySlug = urlPath.length >= 2 ? urlPath[1] : '';

  return data;
}

function buildRow(product, subcategoryTitleMap) {
  const dedup = new Map();
  for (const [rawKey, value] of product.characteristics) {
    if (SKIP_CHAR_KEYS.test(rawKey)) continue;
    const normKey = rawKey.trim().toLowerCase();
    if (!dedup.has(normKey)) dedup.set(normKey, [rawKey, value]);
  }
  const pairs = Array.from(dedup.values());
  const find = (key) => {
    const hit = pairs.find(([k]) => k.trim().toLowerCase() === key);
    return hit ? hit[1].trim() : '';
  };

  const collection = find('коллекция');
  const color = find('цвет');
  const characteristicsText = pairs.map(([k, v]) => `${k}: ${v}`).join('\n');
  const subcategory = subcategoryTitleMap[product.subcategorySlug] || '';

  return {
    'Номенклатура': product.name,
    'Артикул': product.article,
    'Бренд': product.brand,
    'Коллекция': collection,
    'Подкатегория': subcategory,
    'Цвет': color,
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
  const outName = outArg ? outArg.slice('--out='.length) : 'infatti';
  const urls = args.filter((a) => !a.startsWith('--'));

  if (!urls.length) {
    console.error('Использование: node scrape-infatti.js "<url листинга с фильтром бренда>" [--out=имя] [--headless]');
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
  const page = await browser.newPage();

  const allLinks = new Set();
  const subcategoryTitleMap = {};
  for (const url of urls) {
    const sectionPath = '/' + new URL(url, BASE).pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
    const links = await collectListingLinks(page, url, sectionPath, (m) => console.log(m));
    links.forEach((l) => allLinks.add(l));
    // The page is now on a listing page for this section, so its nav menu
    // (which lists every subcategory under it) is in the DOM to read from.
    Object.assign(subcategoryTitleMap, await buildSubcategoryTitleMap(page, sectionPath));
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

  const rows = Object.values(scraped).map((p) => buildRow(p, subcategoryTitleMap));
  await writeXlsx(rows, xlsxPath);
  console.log(`Готово: ${rows.length} товаров -> ${xlsxPath}`);
  if (failed.length) console.log(`Не удалось получить ${failed.length} товаров`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

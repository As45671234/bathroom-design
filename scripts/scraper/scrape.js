// Scrapes the Allen Brau catalog (allenbrau.ru) into one .xlsx file per
// top-level category, in the column layout the admin panel's Excel importer
// (backend/src/services/excelImport.js) already understands: Номенклатура,
// Артикул, Бренд, Коллекция, Подкатегория, Цвет, Характеристики, Описание,
// Картинка 1..N.
//
// "Подкатегория" is read straight off each product's own breadcrumb on the
// site (e.g. "Смесители для раковины", not just "Смесители") - the importer
// doesn't do anything with this column yet, it's there so the value is
// captured and ready for whenever the subcategory-matching import logic and
// the site's category UI are built.
//
// Usage:
//   npm install
//   npx playwright install chromium
//   node scrape.js                     # all categories
//   node scrape.js smesiteli vanny     # only these category slugs
//   node scrape.js --headless          # no visible browser window
//   node scrape.js --resume            # skip products already in the checkpoint
//
// Output goes to ./out/<category>.xlsx, with a ./out/<category>.json
// checkpoint written after every product (safe to Ctrl+C and --resume later).

const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const BASE = 'https://allenbrau.ru';
const OUT_DIR = path.join(__dirname, 'out');

const DEFAULT_CATEGORIES = [
  'smesiteli',
  'dushevye-sistemy-i-dushi',
  'vanny',
  'mebel-dlya-vannoy',
  'keramika',
  'installyatsii',
  'dushevye-poddony-i-ograzhdeniya',
  'polotentsesushiteli',
  'dushevye-lotki-i-trapy',
  'aksessuary'
];

const REQUEST_DELAY_MS = 250;
const MAX_LIST_PAGES = 80;
const STAGNANT_PAGES_TO_STOP = 3;
const RETRIES_PER_PRODUCT = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProductHref(href) {
  if (!href || !href.startsWith('/catalog/')) return false;
  const parts = href.replace(/^\/+|\/+$/g, '').split('/');
  return parts.length >= 4 && parts[0] === 'catalog';
}

// The long marketing paragraph on the page is too long for a card blurb;
// take the first sentence (or a hard cut) as the short description.
function shortenDescription(text, maxLen = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const firstSentence = clean.match(/^.{1,400}?[.!?](?:\s|$)/);
  const candidate = firstSentence ? firstSentence[0].trim() : clean;
  if (candidate.length <= maxLen) return candidate;
  return candidate.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

async function collectCategoryLinks(page, categorySlug, log) {
  const all = new Set();
  let stagnant = 0;

  for (let p = 1; p <= MAX_LIST_PAGES; p++) {
    const url = p === 1
      ? `${BASE}/catalog/${categorySlug}/`
      : `${BASE}/catalog/${categorySlug}/?page=${p}`;

    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    } catch (e) {
      log(`  page ${p}: failed to load (${e.message}), stopping pagination`);
      break;
    }

    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'))
    );
    const productHrefs = hrefs.filter(isProductHref);

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

async function extractProduct(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  // The characteristics list is sometimes truncated behind its own
  // "Показать еще" toggle; expand it so we get every spec row.
  const expandBtn = page.locator('[data-expand-wrapper] >> text=Показать еще').first();
  if (await expandBtn.count().catch(() => 0)) {
    await expandBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(250);
  }

  const data = await page.evaluate(() => {
    const name = document.querySelector('h1')?.textContent?.trim() || '';

    const subtitle = document.querySelector('.product-hero__subtitle')?.textContent?.trim() || '';
    const articleMatch = subtitle.match(/Артикул:\s*(\S.*)/i);
    const article = articleMatch ? articleMatch[1].trim() : '';

    const characteristics = Array.from(document.querySelectorAll('.product-thumbs__list li'))
      .map((li) => {
        const k = li.querySelector('.product-thumbs__name')?.textContent?.trim() || '';
        const v = li.querySelector('.product-thumbs__value')?.textContent?.trim() || '';
        return [k, v];
      })
      .filter(([k, v]) => k && v);

    const description = document.querySelector('.product-seo__text-block p')?.textContent?.trim() || '';

    const images = Array.from(document.querySelectorAll('.product-slider__swiper-slide img'))
      .map((img) => img.getAttribute('src') || img.getAttribute('data-src'))
      .filter(Boolean);

    // The breadcrumb's last link before the current-page text is the most
    // specific category this product lives in on the site (e.g. "Смесители
    // для раковины", not just "Смесители") - much more precise than the
    // top-level listing page we happened to find the product link on.
    const crumbLinks = Array.from(document.querySelectorAll('.breadcrumbs__link'))
      .map((a) => ({ href: a.getAttribute('href') || '', text: a.textContent.trim() }))
      .filter((c) => c.href.startsWith('/catalog/') && c.href !== '/catalog/');
    const leaf = crumbLinks[crumbLinks.length - 1] || null;

    return { name, article, characteristics, description, images: Array.from(new Set(images)), leafCrumb: leaf };
  });

  data.images = data.images.map((src) => (src.startsWith('http') ? src : BASE + src));

  const leaf = data.leafCrumb;
  data.categorySlug = leaf ? leaf.href.replace(/^\/+|\/+$/g, '').split('/').pop() : '';
  data.categoryTitle = leaf ? leaf.text : '';
  delete data.leafCrumb;

  return data;
}

function buildRow(product) {
  const pairs = product.characteristics;
  const find = (key) => {
    const hit = pairs.find(([k]) => k.trim().toLowerCase() === key);
    return hit ? hit[1].trim() : '';
  };

  const collection = find('коллекция');
  const color = find('название цвета') || find('цвет');
  const characteristicsText = pairs.map(([k, v]) => `${k}: ${v}`).join('\n');

  return {
    'Номенклатура': product.name,
    'Артикул': product.article,
    'Бренд': 'Allen Brau',
    'Коллекция': collection,
    'Подкатегория': product.categoryTitle || '',
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

  const headers = [
    'Номенклатура', 'Артикул', 'Бренд', 'Коллекция', 'Подкатегория', 'Цвет',
    'Характеристики', 'Описание'
  ];
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

  ws.columns.forEach((col, idx) => {
    col.width = idx === 6 ? 60 : idx === 7 ? 40 : 24;
  });
  ws.getColumn(7).alignment = { wrapText: true };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await wb.xlsx.writeFile(filePath);
}

async function main() {
  const args = process.argv.slice(2);
  const headless = args.includes('--headless');
  const resume = args.includes('--resume');
  const categories = args.filter((a) => !a.startsWith('--'));
  const targetCategories = categories.length ? categories : DEFAULT_CATEGORIES;

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 30 });
  const page = await browser.newPage();

  for (const categorySlug of targetCategories) {
    console.log(`\n=== Категория: ${categorySlug} ===`);
    const checkpointPath = path.join(OUT_DIR, `${categorySlug}.json`);
    const xlsxPath = path.join(OUT_DIR, `${categorySlug}.xlsx`);

    let scraped = {};
    if (resume && fs.existsSync(checkpointPath)) {
      scraped = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
      console.log(`Резюме: уже есть ${Object.keys(scraped).length} товаров в чекпоинте`);
    }

    console.log('Собираю ссылки на товары...');
    const links = await collectCategoryLinks(page, categorySlug, (m) => console.log(m));
    console.log(`Найдено ${links.length} товаров в категории "${categorySlug}"`);

    const failed = [];
    let done = 0;
    for (const href of links) {
      const url = href.startsWith('http') ? href : BASE + href;
      if (scraped[url]) { done++; continue; }

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

      done++;
      if (done % 10 === 0 || done === links.length) {
        console.log(`  ${done}/${links.length} обработано`);
        fs.writeFileSync(checkpointPath, JSON.stringify(scraped, null, 2));
      }
      await sleep(REQUEST_DELAY_MS);
    }

    fs.writeFileSync(checkpointPath, JSON.stringify(scraped, null, 2));

    const rows = Object.values(scraped).map((p) => buildRow(p));
    await writeXlsx(rows, xlsxPath);
    console.log(`Готово: ${rows.length} товаров -> ${xlsxPath}`);
    if (failed.length) console.log(`Не удалось получить ${failed.length} товаров (см. лог выше)`);
  }

  await browser.close();
  console.log('\nВсё готово. Файлы .xlsx лежат в scripts/scraper/out/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

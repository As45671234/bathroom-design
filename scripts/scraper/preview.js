// Turns the current *.json checkpoint into an .xlsx you can open right now,
// even while scrape.js is still running in another terminal.
//
// Usage: node preview.js smesiteli
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

function shortenDescription(text, maxLen = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const firstSentence = clean.match(/^.{1,400}?[.!?](?:\s|$)/);
  const candidate = firstSentence ? firstSentence[0].trim() : clean;
  if (candidate.length <= maxLen) return candidate;
  return candidate.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

function buildRow(product) {
  const pairs = product.characteristics || [];
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
    images: product.images || []
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
  ws.columns.forEach((col, idx) => { col.width = idx === 6 ? 60 : idx === 7 ? 40 : 24; });
  ws.getColumn(7).alignment = { wrapText: true };

  await wb.xlsx.writeFile(filePath);
}

async function main() {
  const categorySlug = process.argv[2];
  if (!categorySlug) {
    console.error('Использование: node preview.js <категория>  (напр. node preview.js smesiteli)');
    process.exit(1);
  }

  const checkpointPath = path.join(OUT_DIR, `${categorySlug}.json`);
  if (!fs.existsSync(checkpointPath)) {
    console.error(`Нет чекпоинта ${checkpointPath} — скрапер ещё не дошёл до первых 10 товаров этой категории`);
    process.exit(1);
  }

  const raw = fs.readFileSync(checkpointPath, 'utf8');
  const scraped = JSON.parse(raw);
  const rows = Object.values(scraped).map((p) => buildRow(p));

  const previewPath = path.join(OUT_DIR, `${categorySlug}.preview.xlsx`);
  await writeXlsx(rows, previewPath);
  console.log(`Снимок на текущий момент: ${rows.length} товаров -> ${previewPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

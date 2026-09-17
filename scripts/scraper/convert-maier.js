// Converts the supplier reference sheet "описание товара Maier.xlsx" (a
// manually laid out spec sheet, not a scraped site) into our standard import
// format - one .xlsx per inferred category bucket, with the real shared
// product photo + dimension drawing extracted from the embedded images.
//
// Source layout (5 sheets, each holding several unrelated product TYPES, not
// one category per sheet - a sheet is just how the supplier paginated the
// document):
//   Every row where columns C ("Референс") and D ("Цвет") are BOTH empty and
//   column A has text is a section header naming one product model/type
//   (e.g. "Однорычажный Смеситель для раковины"). Row 0 of each sheet is
//   also such a header, even though its C/D cells literally contain the
//   labels "Референс"/"Цвет" - those two are never treated as real data.
//   Every row below a header until the next one is a color variant: C =
//   Референс (article/SKU), D = Цвет (color). There is no per-row photo -
//   1-2 images (a lifestyle photo + a dimensioned line drawing) are shared
//   by every color variant of that one section, anchored in columns B/C
//   somewhere inside the section's row range.
//
// There's no "Коллекция" concept in this file (unlike Bugnatese), no price,
// and no description text, so those columns are left blank.
//
// Section names are bucketed into 5 output files by keyword, since they
// don't map 1:1 onto site categories (many are shower accessories/spare
// parts - handles, brackets, hoses, heads, connectors, spouts - not mixers):
//   maier-rakovina   - sink mixers
//   maier-bide       - bidet mixers
//   maier-vstroennye - built-in thermostatic valves & diverters (shower/bath)
//   maier-gig-dush   - built-in hygienic shower set
//   maier-aksessuary - handles, brackets, hoses, heads, connectors, spouts
//
// Usage:
//   node convert-maier.js "описание товара Maier.xlsx"

const XLSX = require(require('path').join(__dirname, '..', '..', 'backend', 'node_modules', 'xlsx'));
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const FILE_DIR = path.join(__dirname, '..', 'file');
const OUT_DIR = path.join(__dirname, 'out');

function cell(row, idx) {
  return String(row[idx] || '').trim();
}

function classify(sectionName) {
  const s = sectionName.toLowerCase();
  if (/биде/.test(s)) return 'maier-bide';
  if (/раковин/.test(s)) return 'maier-rakovina';
  if (/дивертер|термостат/.test(s)) return 'maier-vstroennye';
  if (/гигиеническ/.test(s)) return 'maier-gig-dush';
  return 'maier-aksessuary';
}

// Same "Смесители" umbrella category as the other bucket files, with
// "Подкатегория" carrying the actual fixture-type distinction - except
// accessories, which belong under the site's existing "Аксессуары"
// category and get their own finer-grained subcategory by keyword.
const BUCKET_SUBCATEGORY = {
  'maier-rakovina': 'Смесители для раковины',
  'maier-bide': 'Смесители для биде',
  'maier-vstroennye': 'Встраиваемые термостаты и диверторы',
  'maier-gig-dush': 'Смесители с гигиеническим душем и биде'
};

function classifyAccessory(sectionName) {
  const s = sectionName.toLowerCase();
  if (/ручка/.test(s)) return 'Ручки для смесителей';
  if (/кронштейн/.test(s)) return 'Кронштейны и держатели';
  if (/соединитель/.test(s)) return 'Соединители';
  if (/лейка|распылител/.test(s)) return 'Лейки и распылители';
  if (/излив/.test(s)) return 'Изливы';
  if (/шланг/.test(s)) return 'Шланги';
  return 'Прочие аксессуары';
}

function subcategoryFor(bucket, sectionName) {
  if (bucket === 'maier-aksessuary') return classifyAccessory(sectionName);
  return BUCKET_SUBCATEGORY[bucket] || '';
}

async function loadImages(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const bySheet = new Map();
  wb.worksheets.forEach((ws) => {
    const images = ws.getImages().map((img) => {
      const tl = img.range && img.range.tl;
      const media = wb.model.media.find((m) => m.index === img.imageId);
      return { row: tl && tl.nativeRow, col: tl && tl.nativeCol, media };
    }).filter((x) => x.media && x.row !== undefined);
    bySheet.set(ws.name, images);
  });
  return bySheet;
}

async function writeXlsxWithImages(rows, filePath) {
  const maxImages = rows.reduce((m, r) => Math.max(m, r.images.length), 1);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Товары');

  const headers = ['Номенклатура', 'Артикул', 'Бренд', 'Коллекция', 'Подкатегория', 'Цвет', 'Характеристики', 'Описание'];
  for (let i = 1; i <= maxImages; i++) headers.push(`Картинка ${i}`);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };

  let imgCounter = 0;
  for (const row of rows) {
    const values = [row.name, row.sku, row.brand, row.collection, row.subcategory, row.color, '', ''];
    for (let i = 0; i < maxImages; i++) values.push('');
    const excelRow = ws.addRow(values);

    row.images.forEach((media, i) => {
      const ext = (media.extension || 'png').toLowerCase();
      const imgId = wb.addImage({ buffer: media.buffer, extension: ext === 'jpg' ? 'jpeg' : ext });
      imgCounter++;
      const colIdx = 8 + i;
      ws.addImage(imgId, {
        tl: { col: colIdx, row: excelRow.number - 1 },
        ext: { width: 90, height: 90 }
      });
    });
  }

  ws.columns.forEach((col, idx) => { col.width = idx === 6 ? 60 : idx === 7 ? 40 : 24; });
  for (let i = 8; i < headers.length; i++) ws.getColumn(i + 1).width = 14;
  for (let r = 2; r <= rows.length + 1; r++) ws.getRow(r).height = 70;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await wb.xlsx.writeFile(filePath);
  console.log(`  embedded ${imgCounter} images`);
}

async function main() {
  const filename = process.argv[2] || 'описание товара Maier.xlsx';
  const filePath = path.join(FILE_DIR, filename);

  const wb = XLSX.readFile(filePath);
  const imagesBySheet = await loadImages(filePath);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const buckets = new Map(); // bucketName -> rows[]

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const images = imagesBySheet.get(sheetName) || [];

    const sectionStarts = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (i === 0 && cell(row, 0)) { sectionStarts.push(0); continue; }
      if (i > 0 && !cell(row, 2) && !cell(row, 3) && cell(row, 0)) sectionStarts.push(i);
    }

    for (let s = 0; s < sectionStarts.length; s++) {
      const start = sectionStarts[s];
      const end = (s + 1 < sectionStarts.length ? sectionStarts[s + 1] : rawRows.length) - 1;
      const sectionName = cell(rawRows[start], 0);
      if (!sectionName) continue;

      const sharedMedia = images
        .filter((im) => (im.col === 1 || im.col === 2) && im.row >= start && im.row <= end)
        .map((im) => im.media);

      const bucket = classify(sectionName);
      const list = buckets.get(bucket) || [];

      for (let r = start + 1; r <= end; r++) {
        const dataRow = rawRows[r];
        const sku = cell(dataRow, 2);
        if (!sku) continue;
        list.push({
          name: sectionName,
          sku,
          brand: 'Maier',
          collection: '',
          subcategory: subcategoryFor(bucket, sectionName),
          color: cell(dataRow, 3),
          images: sharedMedia
        });
      }

      buckets.set(bucket, list);
    }
  }

  for (const [bucket, rows] of buckets) {
    const outPath = path.join(OUT_DIR, `${bucket}.xlsx`);
    await writeXlsxWithImages(rows, outPath);
    console.log(`${bucket} -> ${rows.length} товаров -> ${outPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

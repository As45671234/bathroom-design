// Converts the supplier reference sheet "Bugnatese 1.xlsx" (a manually laid
// out price list, not a scraped site) into our standard import format - one
// .xlsx per sheet/category, with the real per-row product photos extracted
// from the embedded images rather than re-fetched from anywhere.
//
// Source layout (each of the 3 sheets is its own category):
//   Col A = "Коллекция / Модель" - a group header row (e.g. "SIMPLE",
//           "K-LINE") with every other column blank; applies to every row
//           below it until the next group header.
//   Col C = "Код" (article/SKU)
//   Col D = "Наименование/Артикул" (product/model description)
//   Col E = "Цвет" (color)
//   Col G = "Цена" - skipped entirely, no price column is written out.
//   Col F (between Цвет and Цена) holds one embedded photo per data row -
//           the correct finish/color shown for that exact row.
//   Col A also holds 1-3 embedded images (lifestyle photo + technical
//           dimension drawings) shared across an entire model block (a run
//           of consecutive rows with the same "Наименование/Артикул" text).
//
// Usage:
//   node convert-bugnatese.js "Bugnatese 1.xlsx"
//
// Reads from ..\file\<filename>, writes to .\out\bugnatese-<slug>.xlsx

const XLSX = require(require('path').join(__dirname, '..', '..', 'backend', 'node_modules', 'xlsx'));
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const FILE_DIR = path.join(__dirname, '..', 'file');
const OUT_DIR = path.join(__dirname, 'out');

const SHEET_SLUGS = {
  'Смесители на раковину': 'smesiteli-rakovina',
  'Гиг. душ, смеситель биде': 'gig-dush-bide',
  'ванна и душ ': 'vanna-dush'
};

// The site has one umbrella "Смесители" category (chosen once at import
// time) - "Подкатегория" is what actually distinguishes ванна/раковина/биде
// within it, same convention already used for "Полотенцесушители
// электрические" vs "Комплектующие для полотенцесушителей".
const SHEET_SUBCATEGORIES = {
  'Смесители на раковину': 'Смесители для раковины',
  'Гиг. душ, смеситель биде': 'Смесители с гигиеническим душем и биде',
  'ванна и душ ': 'Смесители для ванны и душа'
};

function cell(row, idx) {
  return String(row[idx] || '').trim();
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

function bufferToDataUrl(media) {
  const ext = (media.extension || 'png').toLowerCase();
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${media.buffer.toString('base64')}`;
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
      const colIdx = 8 + i; // 0-indexed: after the 8 text columns
      ws.addImage(imgId, {
        tl: { col: colIdx, row: excelRow.number - 1 },
        ext: { width: 90, height: 90 }
      });
    });
  }

  ws.columns.forEach((col, idx) => { col.width = idx === 6 ? 60 : idx === 7 ? 40 : 24; });
  for (let i = 8; i < headers.length; i++) ws.getColumn(i + 1).width = 14;
  ws.getRow(1).eachCell((c) => { c.alignment = { vertical: 'middle' }; });
  for (let r = 2; r <= rows.length + 1; r++) ws.getRow(r).height = 70;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await wb.xlsx.writeFile(filePath);
  console.log(`  embedded ${imgCounter} images`);
}

async function main() {
  const filename = process.argv[2] || 'Bugnatese 1.xlsx';
  const filePath = path.join(FILE_DIR, filename);

  const wb = XLSX.readFile(filePath);
  const imagesBySheet = await loadImages(filePath);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const sheetName of wb.SheetNames) {
    const slug = SHEET_SLUGS[sheetName] || sheetName.trim().toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-');
    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const images = imagesBySheet.get(sheetName) || [];

    let currentCollection = '';
    // A handful of blocks (e.g. the K-LINE variant of the built-in hygienic
    // shower set) leave "Наименование/Артикул" blank in the source sheet -
    // same product, just not re-typed for that collection. Carry the last
    // seen name forward rather than emitting a nameless (and therefore
    // import-dropped) product.
    let lastKnownName = '';
    const outRows = [];

    // Group consecutive data rows (non-empty "Код") that share the same
    // "Наименование/Артикул" text into a block, so shared col-A images can
    // be attached to every color variant in that block.
    // Row 0 is the sheet's own column-label row ("Код", "Наименование/Артикул",
    // "Цвет"...) - it has non-empty "code"/"name" cells (the labels
    // themselves) and must never be treated as product data.
    let i = 1;
    while (i < rawRows.length) {
      const row = rawRows[i];
      const code = cell(row, 2);
      const name = cell(row, 3);

      if (!code && !name && cell(row, 0)) {
        // Blank separator carries no signal, but a col-A-only row with text
        // and no code/name is a "Коллекция / Модель" group header.
        currentCollection = cell(row, 0);
        i++;
        continue;
      }
      if (!code) { i++; continue; }

      const blockStart = i;
      let blockEnd = i;
      while (blockEnd + 1 < rawRows.length && cell(rawRows[blockEnd + 1], 2) && cell(rawRows[blockEnd + 1], 3) === cell(row, 3)) {
        blockEnd++;
      }

      const sharedMedia = images
        .filter((im) => im.col === 0 && im.row >= blockStart && im.row <= blockEnd)
        .map((im) => im.media);

      const blockName = cell(row, 3) || lastKnownName;
      if (cell(row, 3)) lastKnownName = cell(row, 3);

      for (let r = blockStart; r <= blockEnd; r++) {
        const dataRow = rawRows[r];
        const rowCode = cell(dataRow, 2);
        if (!rowCode) continue;
        const perRowMedia = images.filter((im) => im.col === 5 && im.row === r).map((im) => im.media);
        const imageList = [...perRowMedia, ...sharedMedia];

        outRows.push({
          name: blockName,
          sku: rowCode,
          brand: 'Bugnatese',
          collection: currentCollection,
          subcategory: SHEET_SUBCATEGORIES[sheetName] || '',
          color: cell(dataRow, 4),
          images: imageList
        });
      }

      i = blockEnd + 1;
    }

    const outPath = path.join(OUT_DIR, `bugnatese-${slug}.xlsx`);
    await writeXlsxWithImages(outRows, outPath);
    console.log(`${sheetName} -> ${outRows.length} товаров -> ${outPath}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

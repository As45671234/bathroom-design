
const XLSX = require("xlsx");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

async function convertToWebP(buf) {
  try {
    const sharp = require("sharp");
    const webpBuf = await sharp(buf)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 75, effort: 2 })
      .toBuffer();
    return { buf: webpBuf, ext: ".webp" };
  } catch (e) {
    return { buf, ext: null };
  }
}


function pickText(xml, tag) {
  const reTag = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = String(xml || "").match(reTag);
  return m ? m[1] : "";
}

function getAttr(s, attr) {
  const reAttr = new RegExp(`${attr}="([^"]+)"`, "i");
  const m = String(s || "").match(reAttr);
  return m ? m[1] : "";
}

function parseIntSafe(v) {
  const n = parseInt(String(v || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function cellRefToRowCol(cellRef) {
  const m = String(cellRef || "").toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  const letters = m[1];
  const row = parseIntSafe(m[2]);
  if (row === null) return null;

  let col = 0;
  for (const ch of letters) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }

  return { row, col };
}

// Embedded images can live in a few different places depending on how the
// workbook was produced (classic floating drawings, rich-value "IMAGE()"
// cells, or ExcelJS media). We try all three extraction strategies and merge
// the results, keyed by "sheet|row" and "sheet|row|col".
async function extractImagesXlsx(buffer) {
  const map = new Map();
  let JSZip;
  try { JSZip = require("jszip"); } catch (e) { return map; }

  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch (e) { return map; }

  const workbookXml = zip.file("xl/workbook.xml") ? await zip.file("xl/workbook.xml").async("string") : "";
  const wbRelsXml = zip.file("xl/_rels/workbook.xml.rels") ? await zip.file("xl/_rels/workbook.xml.rels").async("string") : "";

  const wbRelMap = {};
  const relRe = /<Relationship\b[^>]*>/gi;
  let rm;
  while ((rm = relRe.exec(wbRelsXml))) {
    const tag = rm[0];
    const id = getAttr(tag, "Id");
    const target = getAttr(tag, "Target");
    if (id && target) wbRelMap[id] = target.replace(/^\/+/, "");
  }

  const sheetRe = /<sheet\b[^>]*>/gi;
  let sm;
  const sheets = [];
  while ((sm = sheetRe.exec(workbookXml))) {
    const tag = sm[0];
    const name = getAttr(tag, "name") || "Sheet";
    const rid = getAttr(tag, "r:id") || getAttr(tag, "id");
    if (!rid) continue;
    const target = wbRelMap[rid];
    if (!target) continue;
    const sheetPath = target.startsWith("xl/") ? target : "xl/" + target;
    sheets.push({ name: String(name).trim() || "Sheet", sheetPath });
  }

  const drawingRelsCache = new Map();

  async function getDrawingRelMap(drawingPath) {
    if (drawingRelsCache.has(drawingPath)) return drawingRelsCache.get(drawingPath);

    const base = drawingPath.split("/").pop() || "";
    const relsPath = "xl/drawings/_rels/" + base + ".rels";
    const xml = zip.file(relsPath) ? await zip.file(relsPath).async("string") : "";
    const map2 = {};
    let m2;
    relRe.lastIndex = 0;
    while ((m2 = relRe.exec(xml))) {
      const tag = m2[0];
      const id = getAttr(tag, "Id");
      const target = getAttr(tag, "Target");
      if (id && target) map2[id] = target;
    }
    drawingRelsCache.set(drawingPath, map2);
    return map2;
  }

  async function getSheetDrawingPath(sheetPath) {
    const sheetXml = zip.file(sheetPath) ? await zip.file(sheetPath).async("string") : "";
    if (!sheetXml) return null;

    const dTag = sheetXml.match(/<drawing\b[^>]*\/>/i) || sheetXml.match(/<drawing\b[^>]*>[\s\S]*?<\/drawing>/i);
    if (!dTag) return null;
    const rid = getAttr(dTag[0], "r:id");
    if (!rid) return null;

    const base = sheetPath.split("/").pop() || "";
    const relsPath = "xl/worksheets/_rels/" + base + ".rels";
    const relXml = zip.file(relsPath) ? await zip.file(relsPath).async("string") : "";
    if (!relXml) return null;

    let m3;
    relRe.lastIndex = 0;
    while ((m3 = relRe.exec(relXml))) {
      const tag = m3[0];
      const id = getAttr(tag, "Id");
      const target = getAttr(tag, "Target");
      if (id === rid && target) {
        const clean = target.replace(/^\/+/, "");
        const full = clean.startsWith("xl/") ? clean : "xl/worksheets/" + clean;
        const parts = full.split("/");
        const norm = [];
        for (const p of parts) {
          if (p === "..") norm.pop();
          else if (p === ".") continue;
          else norm.push(p);
        }
        return norm.join("/");
      }
    }
    return null;
  }

  async function parseDrawing(sheetName, drawingPath) {
    const drawingXml = zip.file(drawingPath) ? await zip.file(drawingPath).async("string") : "";
    if (!drawingXml) return;

    const dRelMap = await getDrawingRelMap(drawingPath);

    const anchorRe = /<xdr:(twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:\1>/gi;
    let am;
    while ((am = anchorRe.exec(drawingXml))) {
      const block = am[0];

      const fromXml = pickText(block, "xdr:from");
      const toXml = pickText(block, "xdr:to");
      const fromRow = parseIntSafe(pickText(fromXml, "xdr:row"));
      const fromCol = parseIntSafe(pickText(fromXml, "xdr:col"));
      const toRow = parseIntSafe(pickText(toXml, "xdr:row"));

      if (fromRow === null) continue;

      const row1 = fromRow + 1;
      const rowMid = (toRow !== null) ? Math.round((fromRow + toRow) / 2) + 1 : row1;
      const col1 = (fromCol !== null) ? (fromCol + 1) : null;

      const blip = block.match(/<a:blip\b[^>]*>/i);
      const embed = blip ? (getAttr(blip[0], "r:embed") || getAttr(blip[0], "embed")) : "";
      if (!embed) continue;

      const target = dRelMap[embed];
      if (!target) continue;

      let mediaPath = target.replace(/^\/+/, "");
      if (!mediaPath.startsWith("xl/")) {
        const parts = ("xl/drawings/" + mediaPath).split("/");
        const norm = [];
        for (const p of parts) {
          if (p === "..") norm.pop();
          else if (p === ".") continue;
          else norm.push(p);
        }
        mediaPath = norm.join("/");
      }

      const f = zip.file(mediaPath);
      if (!f) continue;

      const ext = (mediaPath.split(".").pop() || "png").toLowerCase();
      const safeExt = ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext) ? ext : "png";
      const buf = await f.async("nodebuffer");
      if (!buf || !buf.length) continue;

      const obj = { buf, ext: safeExt };

      for (const rr of Array.from(new Set([row1, rowMid]))) {
        const rowKey = `${sheetName}|${rr}`;
        if (!map.has(rowKey)) map.set(rowKey, obj);
        if (col1 !== null) {
          const cellKey = `${sheetName}|${rr}|${col1}`;
          if (!map.has(cellKey)) map.set(cellKey, obj);
        }
      }
    }
  }

  for (const sh of sheets) {
    const drawingPath = await getSheetDrawingPath(sh.sheetPath);
    if (!drawingPath) continue;
    await parseDrawing(sh.name, drawingPath);
  }

  return map;
}

async function extractRichValueImagesXlsx(buffer) {
  const map = new Map();
  let JSZip;
  try { JSZip = require("jszip"); } catch (e) { return map; }

  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch (e) { return map; }

  const richValueRelXml = zip.file("xl/richData/richValueRel.xml")
    ? await zip.file("xl/richData/richValueRel.xml").async("string")
    : "";
  const richValueRelRelsXml = zip.file("xl/richData/_rels/richValueRel.xml.rels")
    ? await zip.file("xl/richData/_rels/richValueRel.xml.rels").async("string")
    : "";
  const richValueXml = zip.file("xl/richData/rdrichvalue.xml")
    ? await zip.file("xl/richData/rdrichvalue.xml").async("string")
    : "";
  const metadataXml = zip.file("xl/metadata.xml")
    ? await zip.file("xl/metadata.xml").async("string")
    : "";
  const workbookXml = zip.file("xl/workbook.xml")
    ? await zip.file("xl/workbook.xml").async("string")
    : "";
  const wbRelsXml = zip.file("xl/_rels/workbook.xml.rels")
    ? await zip.file("xl/_rels/workbook.xml.rels").async("string")
    : "";

  if (!richValueRelXml || !richValueRelRelsXml || !richValueXml || !metadataXml || !workbookXml || !wbRelsXml) {
    return map;
  }

  const richRelOrder = [];
  const richRelTagRe = /<rel\b[^>]*r:id="([^"]+)"[^>]*\/>/gi;
  let relOrderMatch;
  while ((relOrderMatch = richRelTagRe.exec(richValueRelXml))) {
    richRelOrder.push(relOrderMatch[1]);
  }

  const relTargetMap = {};
  const relTagRe = /<Relationship\b[^>]*>/gi;
  let relMatch;
  while ((relMatch = relTagRe.exec(richValueRelRelsXml))) {
    const tag = relMatch[0];
    const id = getAttr(tag, "Id");
    const target = getAttr(tag, "Target");
    if (id && target) relTargetMap[id] = target;
  }

  const localImageObjects = [];
  const rvRe = /<rv\b[^>]*>[\s\S]*?<\/rv>/gi;
  let rvMatch;
  while ((rvMatch = rvRe.exec(richValueXml))) {
    const block = rvMatch[0];
    const values = Array.from(block.matchAll(/<v>([\s\S]*?)<\/v>/gi)).map((m) => String(m[1] || "").trim());
    const relIndex = parseIntSafe(values[0]);
    if (relIndex === null) {
      localImageObjects.push(null);
      continue;
    }

    const rid = richRelOrder[relIndex];
    const target = rid ? relTargetMap[rid] : "";
    if (!target) {
      localImageObjects.push(null);
      continue;
    }

    const parts = (`xl/richData/${target}`).split("/");
    const norm = [];
    for (const p of parts) {
      if (p === "..") norm.pop();
      else if (p === "." || !p) continue;
      else norm.push(p);
    }
    const mediaPath = norm.join("/");
    const file = zip.file(mediaPath);
    if (!file) {
      localImageObjects.push(null);
      continue;
    }

    const buf = await file.async("nodebuffer");
    const ext = String((mediaPath.split(".").pop() || "png")).toLowerCase();
    const safeExt = ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext) ? ext : "png";
    localImageObjects.push(buf && buf.length ? { buf, ext: safeExt } : null);
  }

  const vmToRichIndex = {};
  const valueMetadataMatch = metadataXml.match(/<valueMetadata\b[^>]*>([\s\S]*?)<\/valueMetadata>/i);
  if (valueMetadataMatch) {
    const bkBlocks = valueMetadataMatch[1].match(/<bk>[\s\S]*?<\/bk>/gi) || [];
    bkBlocks.forEach((bk, idx) => {
      const rc = bk.match(/<rc\b[^>]*v="(\d+)"[^>]*\/>/i);
      if (rc) vmToRichIndex[idx + 1] = parseIntSafe(rc[1]);
    });
  }

  const wbRelMap = {};
  let wbRelMatch;
  while ((wbRelMatch = relTagRe.exec(wbRelsXml))) {
    const tag = wbRelMatch[0];
    const id = getAttr(tag, "Id");
    const target = getAttr(tag, "Target");
    if (id && target) wbRelMap[id] = target.replace(/^\/+/, "");
  }

  const sheetRe = /<sheet\b[^>]*>/gi;
  let sheetMatch;
  const sheets = [];
  while ((sheetMatch = sheetRe.exec(workbookXml))) {
    const tag = sheetMatch[0];
    const name = getAttr(tag, "name") || "Sheet";
    const rid = getAttr(tag, "r:id") || getAttr(tag, "id");
    const target = rid ? wbRelMap[rid] : "";
    if (!target) continue;
    const sheetPath = target.startsWith("xl/") ? target : `xl/${target}`;
    sheets.push({ name: String(name).trim() || "Sheet", sheetPath });
  }

  for (const sh of sheets) {
    const sheetXml = zip.file(sh.sheetPath) ? await zip.file(sh.sheetPath).async("string") : "";
    if (!sheetXml) continue;

    const cellTags = sheetXml.match(/<c\b[^>]*>/gi) || [];
    for (const tag of cellTags) {
      const vm = parseIntSafe(getAttr(tag, "vm"));
      const cellRef = getAttr(tag, "r");
      if (vm === null || !cellRef) continue;

      const richIndex = vmToRichIndex[vm];
      if (richIndex === undefined || richIndex === null) continue;
      const imageObj = localImageObjects[richIndex];
      if (!imageObj) continue;

      const pos = cellRefToRowCol(cellRef);
      if (!pos) continue;

      const rowKey = `${sh.name}|${pos.row}`;
      const cellKey = `${sh.name}|${pos.row}|${pos.col}`;
      map.set(cellKey, imageObj);
      if (!map.has(rowKey)) map.set(rowKey, imageObj);
    }
  }

  return map;
}

async function extractImagesExcelJs(buffer) {
  const map = new Map();
  let ExcelJS;
  try { ExcelJS = require("exceljs"); } catch (e) { return map; }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (e) {
    return map;
  }

  const mediaList = Array.isArray(workbook.model?.media) ? workbook.model.media : [];
  const mediaById = new Map();
  for (const media of mediaList) {
    if (media?.index !== undefined) mediaById.set(Number(media.index), media);
    if (media?.id !== undefined) mediaById.set(Number(media.id), media);
  }

  for (const worksheet of workbook.worksheets || []) {
    const sheetName = String(worksheet?.name || "").trim();
    if (!sheetName || typeof worksheet.getImages !== "function") continue;

    const images = worksheet.getImages();
    for (const imageRef of images) {
      const range = imageRef?.range || {};
      const tl = range.tl || {};
      const br = range.br || {};

      const fromRow = Number.isFinite(tl.nativeRow) ? tl.nativeRow : null;
      const fromCol = Number.isFinite(tl.nativeCol) ? tl.nativeCol : null;
      const toRow = Number.isFinite(br.nativeRow) ? br.nativeRow : fromRow;
      const toCol = Number.isFinite(br.nativeCol) ? br.nativeCol : fromCol;
      if (fromRow === null || fromCol === null) continue;

      const row1 = fromRow + 1;
      const col1 = fromCol + 1;
      const rowMid = Number.isFinite(toRow) ? Math.round((fromRow + toRow) / 2) + 1 : row1;
      const colMid = Number.isFinite(toCol) ? Math.round((fromCol + toCol) / 2) + 1 : col1;

      const media = mediaById.get(Number(imageRef.imageId));
      if (!media) continue;

      let buf = null;
      if (Buffer.isBuffer(media.buffer)) buf = media.buffer;
      else if (typeof media.base64 === "string" && media.base64) buf = Buffer.from(media.base64, "base64");
      if (!buf || !buf.length) continue;

      const ext = String(media.extension || media.type || "png").replace(/^\./, "").toLowerCase();
      const safeExt = ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext) ? ext : "png";
      const obj = { buf, ext: safeExt };

      for (const [rr, cc] of [[row1, col1], [rowMid, colMid]]) {
        const rowKey = `${sheetName}|${rr}`;
        const cellKey = `${sheetName}|${rr}|${cc}`;
        if (!map.has(cellKey)) map.set(cellKey, obj);
        if (!map.has(rowKey)) map.set(rowKey, obj);
      }
    }
  }

  return map;
}
const { slugify, parseNumber, isRowEmpty, rowNonEmptyCount, buildProductKey } = require("../utils");

function normalizeHeader(h) {
  return String(h || "")
    .toLowerCase()
    .replace(/[._]+/g, " ")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildHeaderMap(headerRow) {
  const knownIndices = new Set();
  const map = { imageColumns: [], attrColumns: [] };

  const mark = (idx) => { knownIndices.add(idx); return idx; };

  for (let i = 0; i < headerRow.length; i++) {
    const rawHeader = String(headerRow[i] || "").trim();
    const h = normalizeHeader(rawHeader);
    if (!h) continue;

    // "Артикул" alone means SKU, but some supplier sheets label the product
    // name column "Наименование/Артикул" - when both words appear together,
    // it's the name column (checked next), not a bare SKU column.
    if ((h.includes("артикул") && !h.includes("наименование")) || h === "sku" || h === "код" || h.includes("код товара")) {
      map.sku = mark(i); continue;
    }
    if (
      h === "наименование" ||
      h.includes("наименование товара") ||
      h.includes("наименование") ||
      h.includes("название") ||
      h.includes("номенклатура") ||
      h === "name"
    ) { map.name = mark(i); continue; }
    if (h.includes("описание") || h === "description") { map.description = mark(i); continue; }
    if (/(^ед\s*изм$)|(^ед\s*изм\s*$)|(^единица\s*измерения$)|(^ед\s*изм\b)|^unit$/i.test(h)) { map.unit = mark(i); continue; }
    if (h.includes("количеств") || h === "остаток" || h === "stock" || h === "qty") { map.quantity = mark(i); continue; }

    if (h.includes("бренд") || h.includes("производител") || h === "brand" || h === "manufacturer") {
      map.brand = mark(i); continue;
    }

    // Subcategory column ("Подкатегория") - a distinct field from "Коллекция"
    // (design line, e.g. "Priority") - this is the product's type within the
    // category (e.g. "Смесители для раковины"). Checked before the collection
    // branch below so it isn't swallowed by it.
    if (h.includes("подкатегор") || h === "subcategory") {
      map.subcategory = mark(i); continue;
    }

    // Collection / product line column ("Коллекция", "Серия").
    if (h.includes("коллекци") || h.includes("сери") || h === "collection" || h === "line") {
      map.collection = mark(i); continue;
    }

    // Characteristics column - format "Ключ: Значение; Ключ2: Значение2"
    if (h.includes("характеристик") || h === "specs" || h === "attributes") {
      map.characteristics = mark(i); continue;
    }

    if (h.includes("размер") || h === "size" || h.includes("габарит")) { map.size = mark(i); continue; }
    if (h.includes("цвет") || h === "color" || h === "colour") { map.color = mark(i); continue; }
    if (h.includes("материал") || h === "material") { map.material = mark(i); continue; }

    if (h.includes("изображение") || h.includes("картинк") || h.includes("фото") || h.includes("image")) {
      const numMatch = h.match(/(\d+)/);
      if (numMatch) map.imageColumns.push(mark(i));
      else { map.image = mark(i); }
      continue;
    }

    // prices
    if (h.includes("старая цена") || h.includes("цена до скидки") || h.includes("скидочн")) { map.oldPrice = mark(i); continue; }
    if (h.includes("опт")) { map.wholesale = mark(i); continue; }
    if (h === "цена" || h.includes("розниц") || h === "price" || h.includes("цена ")) { map.retail = mark(i); continue; }
  }

  // Second pass: any non-empty header column not already claimed → generic attribute column
  for (let i = 0; i < headerRow.length; i++) {
    const rawHeader = String(headerRow[i] || "").trim();
    if (!rawHeader || knownIndices.has(i)) continue;
    const h = normalizeHeader(rawHeader);
    if (!h) continue;
    map.attrColumns.push({ index: i, label: rawHeader });
  }

  return map;
}

function looksLikeHeaderRow(row) {
  // Only short, header-shaped cells count towards the keyword scan below - a
  // long "Характеристики"/"Описание" cell can legitimately contain words
  // like "название" (as in "Название цвета") or "количество" without being
  // anywhere near an actual header row, and would otherwise cause this data
  // row to be misdetected as a new header, corrupting every row after it.
  const joined = row
    .map((c) => normalizeHeader(c))
    .filter((h) => h.length <= 40)
    .join(" | ");

  const hasName  = joined.includes("наименование") || joined.includes("название") || joined.includes("номенклатура");
  const hasSku   = joined.includes("артикул");
  const hasPrice = joined.includes("цена");
  const hasMeas  = joined.includes("ед изм");
  const hasQty   = joined.includes("количеств");

  const score = [hasName, hasSku, hasPrice, hasMeas, hasQty].filter(Boolean).length;

  // Require at least 2 matching keywords to avoid false positives on data rows
  // that happen to contain "цена" or "артикул" in their description/name
  return score >= 2;
}

function uniqueNonEmpty(list) {
  return Array.from(new Set((list || []).map((item) => String(item || "").trim()).filter(Boolean)));
}

async function saveEmbeddedImage({ imageObj, imagesDir, baseName }) {
  if (!imageObj || !imageObj.buf || !imagesDir) return "";
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const baseSlug = slugify(baseName || "image") || "image";
  const { buf: outBuf, ext: convertedExt } = await convertToWebP(imageObj.buf);
  // If sharp couldn't convert this image, keep its real extension instead of
  // mislabeling raw (non-webp) bytes as .webp. imageObj.ext (from the Excel
  // extractors) has no leading dot, unlike convertedExt.
  const ext = convertedExt || (imageObj.ext ? `.${imageObj.ext}` : ".jpg");

  let fileName = `${baseSlug}${ext}`;
  let outPath = path.join(imagesDir, fileName);
  let idx = 2;
  while (fs.existsSync(outPath)) {
    fileName = `${baseSlug}-${idx}${ext}`;
    outPath = path.join(imagesDir, fileName);
    idx++;
  }

  fs.writeFileSync(outPath, outBuf);
  return `/uploads/products/${fileName}`;
}

function resolveEmbeddedImage({ imagesByRow, sheetName, excelRow, columnIndex, strictColumn, usedKeys, sameRowOnly }) {
  const rowCandidates = sameRowOnly
    ? [excelRow]
    : [excelRow, excelRow + 1, excelRow - 1, excelRow + 2, excelRow - 2].filter((x) => x > 0);

  if (columnIndex !== undefined && columnIndex !== null) {
    const col1 = columnIndex + 1;
    const colCandidates = [col1, col1 - 1, col1 + 1, col1 - 2, col1 + 2].filter((x) => x > 0);

    for (const rr of rowCandidates) {
      for (const cc of colCandidates) {
        const cellKey = `${sheetName}|${rr}|${cc}`;
        if (!imagesByRow.has(cellKey)) continue;
        if (usedKeys && usedKeys.has(cellKey)) continue;
        if (usedKeys) usedKeys.add(cellKey);
        return imagesByRow.get(cellKey);
      }
    }

    if (strictColumn) return null;
  }

  for (const rr of rowCandidates) {
    const rowKey = `${sheetName}|${rr}`;
    if (!imagesByRow.has(rowKey)) continue;
    if (usedKeys && usedKeys.has(rowKey)) continue;
    if (usedKeys) usedKeys.add(rowKey);
    return imagesByRow.get(rowKey);
  }

  return null;
}

// Parses a product price-list workbook into flat product rows for a single
// target category (chosen in the admin UI). Column headers are matched by
// keyword (Russian/English) so different supplier price-list layouts work
// without per-file configuration; any unrecognized column becomes a generic
// attribute (e.g. "Материал корпуса", "Гарантия").
async function workbookToProducts({ buffer, filename, imagesDir, target, sheetNames }) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const products = [];
  const sheetFilter = Array.isArray(sheetNames) && sheetNames.length
    ? new Set(sheetNames.map((s) => String(s || "").trim()))
    : null;

  const isXlsx = filename && String(filename).toLowerCase().endsWith(".xlsx");
  let imagesByRow = new Map();

  const mergeImageMaps = (targetMap, sourceMap) => {
    if (!sourceMap || typeof sourceMap.forEach !== "function") return;
    sourceMap.forEach((value, key) => {
      if (!targetMap.has(key)) targetMap.set(key, value);
    });
  };

  if (isXlsx) {
    let richMap = new Map();
    let excelJsMap = new Map();
    let zipDrawingMap = new Map();

    try {
      richMap = await extractRichValueImagesXlsx(buffer);
    } catch (e) {
      richMap = new Map();
    }

    try {
      excelJsMap = await extractImagesExcelJs(buffer);
    } catch (e) {
      excelJsMap = new Map();
    }

    try {
      zipDrawingMap = await extractImagesXlsx(buffer);
    } catch (e) {
      zipDrawingMap = new Map();
    }

    // Some files are only partially handled by one parser. Merge all extracted keys.
    mergeImageMaps(imagesByRow, richMap);
    mergeImageMaps(imagesByRow, excelJsMap);
    mergeImageMaps(imagesByRow, zipDrawingMap);
  }


  const normalizeImageValue = (val) => {
    const s = String(val || "").trim();
    if (!s) return "";
    const low = s.toLowerCase();
    const isUrl = /^https?:\/\//i.test(s);
    const hasExt = /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(low);
    if (isUrl || hasExt) return s;
    return "";
  };

  const extractUrlFromImageFormula = (formula) => {
    const f = String(formula || "").trim();
    if (!f) return "";

    // Excel IMAGE("https://...", ...) and localized separators.
    const m = f.match(/IMAGE\s*\(\s*"([^"]+)"/i) || f.match(/IMAGE\s*\(\s*'([^']+)'/i);
    return m ? String(m[1] || "").trim() : "";
  };

  const extractImageUrlFromCell = (wsLocal, excelRow, columnIndex) => {
    if (columnIndex === undefined || columnIndex === null) return "";
    if (!wsLocal) return "";

    const cellRef = XLSX.utils.encode_cell({ r: Math.max(0, excelRow - 1), c: Math.max(0, columnIndex) });
    const cell = wsLocal[cellRef];
    if (!cell) return "";

    // 1) Formula IMAGE("url")
    const fromFormula = extractUrlFromImageFormula(cell.f);
    if (fromFormula) return normalizeImageValue(fromFormula);

    // 2) Hyperlink target
    const fromLink = String(cell?.l?.Target || "").trim();
    if (fromLink) return normalizeImageValue(fromLink);

    // 3) Direct cell value string
    return normalizeImageValue(cell.v);
  };


  for (const sheetName of wb.SheetNames) {
    const sn = String(sheetName || "").trim();
    if (!sn) continue;
    if (/^диаграм/i.test(sn) || /^chart/i.test(sn) || /^diagram/i.test(sn)) continue;
    if (sheetFilter && !sheetFilter.has(sn)) continue;
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "", cellText: false });

    let currentGroup = "";
    let headerMap = null;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (isRowEmpty(row)) continue;

      const nonEmpty = rowNonEmptyCount(row);

      // Single-cell rows before a header is found, or short/no-digit rows
      // after a header is found, are treated as group/collection labels.
      if (nonEmpty === 1) {
        const title = String(row.find((c) => String(c || "").trim()) || "").trim();
        if (!headerMap || (title.length < 80 && !/\d/.test(title))) {
          currentGroup = title;
          continue;
        }
        // Otherwise fall through and try to parse as product (name-only row)
      }

      if (looksLikeHeaderRow(row)) {
        headerMap = buildHeaderMap(row);
        continue;
      }

      if (!headerMap || headerMap.name === undefined) continue;

      const name = String(row[headerMap.name] || "").trim();
      if (!name) continue;

      const sku = headerMap.sku !== undefined ? String(row[headerMap.sku] || "").trim() : "";
      const description = headerMap.description !== undefined ? String(row[headerMap.description] || "").trim() : "";
      const unit = headerMap.unit !== undefined ? String(row[headerMap.unit] || "").trim() : "";
      const stockQty = headerMap.quantity !== undefined ? parseNumber(row[headerMap.quantity]) : undefined;
      const brand = headerMap.brand !== undefined ? String(row[headerMap.brand] || "").trim() : "";
      // Collection column overrides single-cell group rows
      const collectionFromCol = headerMap.collection !== undefined ? String(row[headerMap.collection] || "").trim() : "";
      const subcategory = headerMap.subcategory !== undefined ? String(row[headerMap.subcategory] || "").trim() : "";
      const excelRow = r + 1;

      const imageColumns = headerMap.imageColumns && headerMap.imageColumns.length
        ? headerMap.imageColumns
        : (headerMap.image !== undefined ? [headerMap.image] : []);
      const usedImageKeys = new Set();

      let images = uniqueNonEmpty(imageColumns.map((columnIndex) => normalizeImageValue(row[columnIndex])));

      // Extra fallback: image URLs in formula/hyperlink cells (e.g. IMAGE("https://..."))
      if (imageColumns.length) {
        for (const columnIndex of imageColumns) {
          const fromCell = extractImageUrlFromCell(ws, excelRow, columnIndex);
          if (fromCell) images.push(fromCell);
        }
      }

      for (const columnIndex of imageColumns) {
        const embedded = resolveEmbeddedImage({
          imagesByRow,
          sheetName: sn,
          excelRow,
          columnIndex,
          strictColumn: true,
          sameRowOnly: true,
          usedKeys: usedImageKeys
        });
        const saved = await saveEmbeddedImage({
          imageObj: embedded,
          imagesDir,
          baseName: `${sku || name}-${columnIndex + 1}`
        });
        if (saved) images.push(saved);
      }

      // Fallback: if no images found with strict matching, retry with row/col tolerance (±2)
      if (images.length === 0) {
        const fallbackCols = imageColumns.length > 0
          ? imageColumns
          : (headerMap.image !== undefined ? [headerMap.image] : [undefined]);
        for (let fi = 0; fi < fallbackCols.length; fi++) {
          const fbCol = fallbackCols[fi];
          const embedded = resolveEmbeddedImage({
            imagesByRow,
            sheetName: sn,
            excelRow,
            columnIndex: fbCol,
            strictColumn: false,
            sameRowOnly: false,
            usedKeys: usedImageKeys
          });
          const saved = await saveEmbeddedImage({
            imageObj: embedded,
            imagesDir,
            baseName: `${sku || name}-${fi + 1}`
          });
          if (saved) images.push(saved);
        }
      }

      images = uniqueNonEmpty(images);
      const image = images[0] || "";

      const size = headerMap.size !== undefined ? String(row[headerMap.size] || "").trim() : "";
      const color = headerMap.color !== undefined ? String(row[headerMap.color] || "").trim() : "";
      const material = headerMap.material !== undefined ? String(row[headerMap.material] || "").trim() : "";

      const attrs = {};
      if (size) attrs.size = size;
      if (color) attrs.color = color;
      if (material) attrs.material = material;

      // Parse "Характеристики" column: "Ключ: Значение; Ключ2: Значение2"
      if (headerMap.characteristics !== undefined) {
        const charStr = String(row[headerMap.characteristics] || "")
          .replace(/；|;/g, ";")  // normalize fullwidth semicolon
          .replace(/\r\n?/g, "\n")
          .trim();
        if (charStr) {
          // Support ";", newline, and carriage return as separators
          const pairs = charStr.split(/[;\n]+/);
          for (const pair of pairs) {
            const colonIdx = pair.indexOf(":");
            if (colonIdx < 1) continue;
            const key = pair.slice(0, colonIdx).trim();
            const val = pair.slice(colonIdx + 1).trim();
            if (key && val) attrs[key] = val;
          }
        }
      }

      // Generic attribute columns: any unclaimed column
      if (Array.isArray(headerMap.attrColumns)) {
        for (const { index, label } of headerMap.attrColumns) {
          const v = String(row[index] || "").trim();
          if (v && label) attrs[label] = v;
        }
      }

      const prices = {};
      const retail = headerMap.retail !== undefined ? parseNumber(row[headerMap.retail]) : undefined;
      const oldPrice = headerMap.oldPrice !== undefined ? parseNumber(row[headerMap.oldPrice]) : undefined;
      const wholesale = headerMap.wholesale !== undefined ? parseNumber(row[headerMap.wholesale]) : undefined;

      if (retail !== undefined) prices.retail = retail;
      if (oldPrice !== undefined) prices.oldPrice = oldPrice;
      if (wholesale !== undefined) prices.wholesale = wholesale;

      // note / "по запросу"
      const rowText = row.map((c) => String(c || "")).join(" ").toLowerCase();
      if (rowText.includes("по запросу")) prices.note = "Цена по запросу";

      const category_id = target.id;
      const category_title = target.title;
      const collection = collectionFromCol || currentGroup || "";
      const key = buildProductKey({
        categoryId: category_id,
        sku,
        brandOrGroup: collection,
        name,
        size
      });

      products.push({
        key,
        category_id,
        category_title,
        name,
        brand,
        collection,
        subcategory,
        unit: unit || "шт",
        sku,
        image,
        images,
        description,
        stockQty,
        prices,
        attrs,
        inStock: stockQty !== undefined ? stockQty > 0 : true,
        active: true
      });
    }
  }

  return products;
}

// A blank starter workbook using every header buildHeaderMap() recognizes -
// download this from the admin import screen to get the columns right on
// the first try instead of guessing from the importer's source.
async function buildImportTemplateWorkbook() {
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Товары");

  const headers = [
    "Номенклатура", "Артикул", "Бренд", "Коллекция", "Подкатегория", "Цвет",
    "Материал", "Характеристики", "Описание", "Ед. изм", "Цена розница",
    "Старая цена", "Остаток", "Картинка 1", "Картинка 2", "Картинка 3"
  ];
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };

  ws.addRow([
    "Смеситель для раковины Пример 1.23A45-00 хром",
    "1.23A45-00",
    "Пример Бренд",
    "Priority",
    "Смесители для раковины",
    "Хром",
    "Латунь",
    "Материал: Латунь\nУстановка: На раковину\nДлина излива, мм: 120",
    "Смеситель для раковины в комплекте с гибкой подводкой и керамическим картриджем.",
    "шт",
    "24990",
    "",
    "10",
    "https://example.com/images/1.jpg",
    "https://example.com/images/2.jpg",
    ""
  ]);

  ws.columns.forEach((col, idx) => {
    col.width = idx === 7 ? 50 : idx === 8 ? 40 : 22;
  });
  ws.getColumn(8).alignment = { wrapText: true };

  return wb.xlsx.writeBuffer();
}

module.exports = { workbookToProducts, buildImportTemplateWorkbook };

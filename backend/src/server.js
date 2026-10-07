
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { connectDb } = require("./config/db");

const publicRoutes = require("./routes/public");
const adminRoutes = require("./routes/admin");
const Product = require("./models/Product");
const { getRegistry } = require("./services/seoRegistry");
const { renderPage, templateExists, SITE_URL } = require("./services/seoRender");

const app = express();
const PORT = Number(process.env.PORT || 3001);
const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads"));

app.set("trust proxy", 1);

// CSP off on purpose. Until the SEO renderer landed, nginx served index.html
// straight off disk and helmet never saw an HTML response, so no CSP was ever
// in force. Now that HTML flows through Node, helmet's default
// `script-src 'self'` would start blocking the inline Yandex.Metrika snippet
// and the CDN font/icon stylesheets — a silent breakage shipped as a side
// effect of an SEO change. Adding a real policy is worth doing, but as its
// own task with its own testing.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan("dev"));
app.use(cors({
  origin: ["http://localhost:3000"],
  credentials: false
}));
app.use(express.json({ limit: "2mb" }));

// Serve uploaded product images / category videos. Filenames are
// timestamp+random-suffixed (never reused for changed content), so an
// aggressive immutable cache is safe.
const uploadsStaticOptions = { maxAge: "30d", immutable: true };
app.use("/uploads", express.static(uploadsRoot, uploadsStaticOptions));
app.use("/api/uploads", express.static(uploadsRoot, uploadsStaticOptions));

const leadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api", publicRoutes(leadLimiter));
app.use("/api/admin", adminRoutes);

app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(
    // /cart is per-session/empty-by-default and /visual-search is an upload
    // tool with no indexable content - both are pure crawl-budget waste, and
    // /admin obviously shouldn't be crawlable at all.
    "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /cart\nDisallow: /visual-search\n\n" +
      // sitemap-main first: it is the short list of landing pages, and a
      // crawler working top-down should see those before 1400 product URLs.
      `Sitemap: ${SITE_URL}/sitemap-main.xml\n` +
      `Sitemap: ${SITE_URL}/sitemap-products.xml\n` +
      `Sitemap: ${SITE_URL}/sitemap.xml`
  );
});

// Sitemaps are split into "landing" (home, catalog, categories, brands,
// static pages — a couple of dozen URLs) and "products" (~1400).
//
// Google reported 1423 of 1425 URLs as "Discovered – currently not indexed":
// it had never fetched them at all. That is a crawl-budget verdict, not a
// page-quality one — a young domain with no inbound links gets very few
// crawls, and a flat list of 1400 near-identical product URLs spends that
// budget on the least valuable pages. The landing sitemap is small enough to
// be processed in one go and holds exactly the pages that answer the queries
// this shop cares about ("Allen Brau сантехника Астана"), so it can be
// submitted separately and prioritised.
//
// /sitemap.xml stays a single flat list of everything for Yandex and for
// anything that followed the robots.txt reference.
async function buildSitemapUrls() {
  const { categories, brands } = await getRegistry();
  const today = new Date().toISOString().slice(0, 10);
  const baseUrl = SITE_URL;

  const landing = [
    { loc: `${baseUrl}/`, lastmod: today, changefreq: "weekly", priority: "1.0" },
    { loc: `${baseUrl}/catalog`, lastmod: today, changefreq: "daily", priority: "0.9" },
    { loc: `${baseUrl}/designers`, lastmod: today, changefreq: "monthly", priority: "0.7" },
    { loc: `${baseUrl}/brigades`, lastmod: today, changefreq: "monthly", priority: "0.7" },
    { loc: `${baseUrl}/warranty`, lastmod: today, changefreq: "monthly", priority: "0.5" },
    // Categories used to be listed as ?cat=<cyrillic id>, which percent-encodes
    // into unreadable URLs and is crawled worse than a path. They are now
    // /catalog/<latin-slug>; the registry owns that mapping.
    ...categories.map((c) => ({
      loc: `${baseUrl}/catalog/${c.slug}`,
      lastmod: today,
      changefreq: "weekly",
      priority: "0.8"
    })),
    ...brands.map((b) => ({
      loc: `${baseUrl}/brand/${b.slug}`,
      lastmod: today,
      changefreq: "weekly",
      priority: "0.7"
    }))
  ];

  // Product pages moved from the old catalog modal (?product=<id>) to a
  // real route (/product/:id) - CatalogPage.tsx now only does a client-side
  // JS redirect for old links found in the wild. Listing /product/:id
  // directly here matters a lot for Yandex specifically: unlike Googlebot,
  // Yandex's crawler is much less reliable at executing JS redirects, so a
  // sitemap full of ?product= links risked those pages never getting
  // indexed under their real URL.
  const products = await Product.find({ active: true, inStock: true }).select("_id updatedAt").lean();
  const productUrls = products.map((p) => ({
    loc: `${baseUrl}/product/${encodeURIComponent(String(p._id))}`,
    lastmod: p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : today,
    changefreq: "weekly",
    priority: "0.6"
  }));

  return { landing, products: productUrls };
}

const sitemapXml = (urls) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) =>
      `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
    ),
    "</urlset>"
  ].join("\n");

const serveSitemap = (pick) => async (req, res) => {
  try {
    const { landing, products } = await buildSitemapUrls();
    res.header("Content-Type", "application/xml");
    res.send(sitemapXml(pick({ landing, products })));
  } catch (e) {
    console.error("[sitemap]", e.message);
    res.status(500).send('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>');
  }
};

app.get("/sitemap.xml", serveSitemap(({ landing, products }) => [...landing, ...products]));
app.get("/sitemap-main.xml", serveSitemap(({ landing }) => landing));
app.get("/sitemap-products.xml", serveSitemap(({ products }) => products));

// ---------------------------------------------------------------- SPA + SEO
//
// nginx hands every non-asset GET here instead of serving dist/index.html off
// disk, so the HTML a crawler receives already carries the right title,
// description, JSON-LD and a plain-HTML summary of the page. The React bundle
// then boots over it exactly as before. Asset requests never reach Node —
// nginx still serves /assets/ straight from disk.
//
// express.static stays as a fallback so `node src/server.js` alone serves a
// working site locally, without needing nginx in front of it.
const distDir = path.resolve(
  process.env.FRONTEND_DIST || path.join(__dirname, "..", "..", "frontend", "dist")
);
app.use(express.static(distDir, { index: false, maxAge: "1y", immutable: true }));

app.get(/.*/, async (req, res, next) => {
  // Anything under /api that got this far is a genuine 404, not a page.
  if (req.path.startsWith("/api/")) return next();
  if (!req.accepts("html")) return next();
  if (!templateExists()) {
    return res.status(503).type("text/plain").send("Frontend build not found. Run: npm run build");
  }

  try {
    const { status, html } = await renderPage(req.path, req.query);
    // index.html must never be cached hard — it is what points at the current
    // hashed bundle (see the nginx no-cache block added 2026-10-01). The SEO
    // payload rides along with it, so the same rule applies here.
    res.status(status).set("Cache-Control", "no-cache").type("html").send(html);
  } catch (e) {
    // A failure here (Mongo hiccup, bad product doc) must cost SEO metadata,
    // never the page itself — fall back to the untouched build, which is
    // exactly what the site served before this layer existed.
    console.error("[seo-render]", req.path, e.message);
    res.status(200).set("Cache-Control", "no-cache").sendFile(path.join(distDir, "index.html"));
  }
});

app.use((err, req, res, next) => {
  if (!err) return next();

  const code = err.code || "";
  if (code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "file too large" });
  }

  const msg = err.message ? String(err.message) : "server error";
  return res.status(500).json({ error: msg });
});


connectDb(process.env.MONGODB_URI)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Backend started on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("DB connection error:", err);
    process.exit(1);
  });

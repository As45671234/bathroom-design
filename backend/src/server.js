
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
const CategoryMeta = require("./models/CategoryMeta");
const Product = require("./models/Product");

const app = express();
const PORT = Number(process.env.PORT || 3001);
const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, "..", "uploads"));

app.set("trust proxy", 1);

app.use(helmet());
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
    "User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: https://bathroomdesign.kz/sitemap.xml"
  );
});

app.get("/sitemap.xml", async (req, res) => {
  try {
    const metas = await CategoryMeta.find({}).lean();
    const products = await Product.find({ active: true, inStock: true }).select("_id").lean();
    const baseUrl = "https://bathroomdesign.kz";
    const today = new Date().toISOString().slice(0, 10);

    const urls = [
      { loc: `${baseUrl}/`, changefreq: "weekly", priority: "1.0" },
      { loc: `${baseUrl}/catalog`, changefreq: "daily", priority: "0.9" },
      ...metas.map((m) => ({
        loc: `${baseUrl}/catalog?cat=${encodeURIComponent(m.category_id)}`,
        changefreq: "weekly",
        priority: "0.8"
      })),
      ...products.map((p) => ({
        loc: `${baseUrl}/catalog?product=${encodeURIComponent(String(p._id))}`,
        changefreq: "weekly",
        priority: "0.6"
      }))
    ];

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map((u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      ),
      "</urlset>"
    ].join("\n");

    res.header("Content-Type", "application/xml");
    res.send(xml);
  } catch (e) {
    res.status(500).send("<?xml version=\"1.0\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"/>");
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

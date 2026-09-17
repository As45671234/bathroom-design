
const jwt = require("jsonwebtoken");

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "secret");
    if (!payload || payload.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
    req.admin = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

module.exports = { requireAdmin };

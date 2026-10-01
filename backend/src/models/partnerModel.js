const mongoose = require("mongoose");

/**
 * Designers and construction crews are the same shape of record — a partner we
 * recommend: photo, a line of positioning, contacts and a portfolio. They differ
 * only in wording on the public page, so they share one schema and differ by
 * collection (`Designer` → `designers`, `Brigade` → `brigades`). Keeping them in
 * separate collections rather than one with a `kind` discriminator keeps the
 * existing designers data and its queries untouched.
 */
function createPartnerModel(modelName) {
  const schema = new mongoose.Schema(
    {
      name: { type: String, required: true, trim: true },
      // Designers: "Ведущий дизайнер". Crews: "Монтаж сантехники под ключ".
      position: { type: String, default: "" },
      photo: { type: String, default: "" },
      bio: { type: String, default: "" },
      experienceYears: { type: Number },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
      instagramUrl: { type: String, default: "" },
      whatsappUrl: { type: String, default: "" },
      portfolio: { type: [String], default: [] },
      order: { type: Number, default: 0 },
      active: { type: Boolean, default: true }
    },
    { timestamps: true }
  );

  schema.set("toJSON", {
    virtuals: true,
    transform: (_, ret) => {
      ret.id = String(ret._id);
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  });

  return mongoose.model(modelName, schema);
}

module.exports = { createPartnerModel };


const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },

    category_id: { type: String, required: true, index: true },
    category_title: { type: String, required: true },

    name: { type: String, required: true },
    brand: { type: String, default: "" },
    collection: { type: String, default: "" },
    subcategory: { type: String, default: "" },

    unit: { type: String, default: "шт" },
    sku: { type: String, default: "" },
    image: { type: String, default: "" },
    images: { type: [String], default: [] },
    description: { type: String, default: "" },
    stockQty: { type: Number },

    prices: {
      retail: { type: Number },
      oldPrice: { type: Number },
      wholesale: { type: Number },
      note: { type: String }
    },

    attrs: { type: mongoose.Schema.Types.Mixed, default: {} },

    inStock: { type: Boolean, default: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

// Supports the main catalog query (public.js: find({active,inStock}).sort({category_title,name}))
// plus the same shape reused by admin listing and the sitemap generator.
ProductSchema.index({ active: 1, inStock: 1, category_title: 1, name: 1 });
ProductSchema.index({ sku: 1 });
ProductSchema.index({ brand: 1 });

ProductSchema.set("toJSON", {
  virtuals: true,
  transform: (_, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model("Product", ProductSchema);

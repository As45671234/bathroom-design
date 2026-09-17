const mongoose = require("mongoose");

const CategoryMetaSchema = new mongoose.Schema(
  {
    category_id: { type: String, required: true, unique: true, index: true },
    title: { type: String, default: "" },
    image: { type: String, default: "" },
    styleVariant: { type: Number, enum: [1, 2], default: 1 },
    videoUrl: { type: String, default: "" },
    seoTitle: { type: String, default: "" },
    seoDescription: { type: String, default: "" },
    seoKeywords: { type: String, default: "" }
  },
  { timestamps: true }
);

CategoryMetaSchema.set("toJSON", {
  virtuals: true,
  transform: (_, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model("CategoryMeta", CategoryMetaSchema);

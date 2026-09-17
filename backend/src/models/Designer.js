const mongoose = require("mongoose");

const DesignerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
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

DesignerSchema.set("toJSON", {
  virtuals: true,
  transform: (_, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model("Designer", DesignerSchema);

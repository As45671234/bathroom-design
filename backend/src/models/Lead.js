const mongoose = require("mongoose");

const LeadSchema = new mongoose.Schema(
  {
    // Name is optional (client may not want to provide it)
    name: { type: String, default: "" },
    // Phone is the only required contact; email is optional (see Order.js).
    phone: { type: String, required: true },
    email: { type: String, default: "" },
    message: { type: String, default: "" },

    status: { type: String, enum: ["new", "processing", "done"], default: "new", index: true }
  },
  { timestamps: true }
);

LeadSchema.index({ createdAt: -1 });

LeadSchema.set("toJSON", {
  virtuals: true,
  transform: (_, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model("Lead", LeadSchema);

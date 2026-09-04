import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  phone: { type: String, required: true, trim: true, unique: true, index: true },
  avatarFilename: { type: String, default: null },
  passwordHash: { type: String, required: true, select: false },
  roles: { type: [String], enum: ['buyer', 'seller', 'admin'], required: true },
  location: {
    city: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true }
  },
  emailVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active', index: true },
  termsAcceptedAt: { type: Date, required: true },
  ageConfirmedAt: { type: Date, default: null },
  marketingConsent: { type: Boolean, default: false },
  marketingConsentAt: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null }
}, { timestamps: true });

userSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  }
});

export const User = mongoose.model('User', userSchema);

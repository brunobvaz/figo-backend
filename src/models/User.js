import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  phone: { type: String, trim: true },
  avatarFilename: { type: String, default: null },
  passwordHash: { type: String, required: true, select: false },
  // Onboarding analytics only; never used for authorization.
  usageIntent: { type: String, enum: ['buy', 'sell', 'both'] },
  location: {
    municipalityCode: String,
    municipality: String,
    parishCode: String,
    parish: String,
    version: String,
    geo: { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
    // Retained for existing accounts and older clients.
    city: { type: String, trim: true },
    postalCode: { type: String, trim: true }
  },
  emailVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'deactivated', 'suspended', 'deletion_pending', 'deleted'], default: 'active', index: true },
  deactivatedAt: { type: Date, default: null },
  deletionRequestedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  termsAcceptedAt: { type: Date, required: true },
  ageConfirmedAt: { type: Date, default: null },
  marketingConsent: { type: Boolean, default: false },
  marketingConsentAt: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null }
}, { timestamps: true });

userSchema.index({ phone: 1 }, { name: 'phone_optional_unique', unique: true, partialFilterExpression: { phone: { $type: 'string' } } });

userSchema.set('toJSON', {
  transform(_doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    // Legacy documents may still contain the obsolete authorization field.
    delete ret.roles;
    return ret;
  }
});

export const User = mongoose.model('User', userSchema);

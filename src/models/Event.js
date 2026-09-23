import mongoose from 'mongoose';

export const eventTypes = ['Feira', 'Mercado', 'Evento'];
export const validEventDate = value => {
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
export const eventTimePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const addressSchema = new mongoose.Schema({
  municipalityCode: { type: String, required: true },
  parishCode: { type: String, required: true },
  municipality: { type: String, required: true },
  parish: { type: String, required: true },
  locality: { type: String, required: true },
  version: { type: String, required: true }
}, { _id: false });
const geoSchema = new mongoose.Schema({
  type: { type: String, enum: ['Point'], required: true },
  coordinates: {
    type: [Number], required: true,
    validate: values => values.length === 2 && values.every(Number.isFinite)
      && Math.abs(values[0]) <= 180 && Math.abs(values[1]) <= 90
  }
}, { _id: false });
const schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  type: { type: String, required: true, enum: eventTypes },
  // Local calendar day and wall-clock times, never converted to UTC timestamps.
  date: { type: String, required: true, validate: validEventDate },
  startTime: { type: String, required: true, match: eventTimePattern },
  endTime: { type: String, default: null, validate: value => value == null || eventTimePattern.test(value) },
  location: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
  // Optional for events created before parish-based geolocation was introduced.
  address: { type: addressSchema, default: null },
  geo: { type: geoSchema, default: undefined },
  locationSource: { type: String, enum: ['parish', null], default: null },
  distanceKm: { type: Number, default: null, min: 0, max: 20000 },
  free: { type: Boolean, default: false },
  image: { type: String, default: null, maxlength: 2048 },
  imageData: { type: Buffer, select: false },
  imageMimeType: { type: String, enum: ['image/webp', null], default: null },
  imageVersion: { type: String, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true }
}, { timestamps: true, collection: 'events', optimisticConcurrency: true });
schema.pre('validate', function () {
  if (this.endTime && this.startTime && this.endTime <= this.startTime)
    this.invalidate('endTime', 'A hora de fim deve ser posterior à hora de início.');
});
schema.index({ date: 1, startTime: 1, _id: 1 });
schema.index({ type: 1, date: 1 });
schema.index({ geo: '2dsphere' });
export const Event = mongoose.model('Event', schema);
export const eventLocationSummary = event => ({
  address: event.address ?? null,
  geo: event.geo ?? null,
  locationSource: event.locationSource ?? null
});
export function eventSummary(event) {
  return {
    id: event._id.toString(), title: event.title, description: event.description,
    type: event.type, date: event.date, startTime: event.startTime, endTime: event.endTime,
    location: event.location, distanceKm: event.distanceKm, free: event.free,
    ...eventLocationSummary(event),
    image: event.imageVersion ? `/api/v1/admin/events/${event._id}/image?v=${encodeURIComponent(event.imageVersion)}` : event.image ?? null,
    hasUploadedImage: Boolean(event.imageVersion), createdAt: event.createdAt, updatedAt: event.updatedAt
  };
}

import { Event, eventLocationSummary } from '../models/Event.js';
import { AppError } from '../utils/AppError.js';

const publicFields = 'title description type date startTime endTime location address geo locationSource distanceKm free image imageVersion';
const summary = event => ({
  id: event._id.toString(), title: event.title, description: event.description,
  type: event.type, date: event.date, startTime: event.startTime, endTime: event.endTime,
  location: event.location, distanceKm: event.distanceKm, free: event.free,
  ...eventLocationSummary(event),
  image: event.imageVersion ? `/api/v1/events/${event._id}/image?v=${encodeURIComponent(event.imageVersion)}` : event.image ?? null
});

export const publicEventService = {
  async list({ type, from, to, free, page, limit }) {
    const filter = {};
    if (type) filter.type = type;
    if (free !== undefined) filter.free = free;
    if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const [items, total] = await Promise.all([
      Event.find(filter).select(publicFields).sort({ date: 1, startTime: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Event.countDocuments(filter)
    ]);
    return { items: items.map(summary), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  },
  async detail(id) {
    const event = await Event.findById(id).select(publicFields).lean();
    if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', 'Este evento já não está disponível.');
    return summary(event);
  },
  async image(id, version) {
    const event = await Event.findById(id).select('+imageData imageMimeType imageVersion');
    if (!event?.imageData || (version && version !== event.imageVersion))
      throw new AppError(404, 'EVENT_IMAGE_NOT_FOUND', 'Esta fotografia já não está disponível.');
    return { data: Buffer.from(event.imageData), contentType: event.imageMimeType };
  }
};

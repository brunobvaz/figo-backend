import { Event, eventSummary } from '../models/Event.js';
import { AppError } from '../utils/AppError.js';
import { editorialImageFields } from './editorialImageService.js';
import { resolveEventLocation } from './eventLocationService.js';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const notFound = () => new AppError(404, 'EVENT_NOT_FOUND', 'O evento já não existe.');
function checkImage(input, file) {
  if (file && input.image) throw new AppError(422, 'AMBIGUOUS_EVENT_IMAGE', 'Seleciona uma fotografia ou indica um URL, não ambos.');
}
export const adminEventService = {
  async list({ search, type, from, to, free, page, limit }) {
    const filter = {};
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: 'i' };
      filter.$or = [{ title: regex }, { description: regex }, { location: regex }, { 'address.municipality': regex }, { 'address.parish': regex }];
    }
    if (type) filter.type = type;
    if (free !== undefined) filter.free = free;
    if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const [items, total] = await Promise.all([
      Event.find(filter).sort({ date: 1, startTime: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
      Event.countDocuments(filter)
    ]);
    return { items: items.map(eventSummary), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  },
  async get(id) {
    const event = await Event.findById(id).lean();
    if (!event) throw notFound();
    return eventSummary(event);
  },
  async image(id) {
    const event = await Event.findById(id).select('+imageData imageMimeType');
    if (!event?.imageData) throw new AppError(404, 'EVENT_IMAGE_NOT_FOUND', 'Este evento não tem uma fotografia carregada.');
    return { data: Buffer.from(event.imageData), contentType: event.imageMimeType };
  },
  async create(input, adminId, file) {
    checkImage(input, file);
    const fields = await resolveEventLocation(input);
    const imageFields = file ? await editorialImageFields(file, 'INVALID_EVENT_IMAGE') : {};
    return eventSummary(await Event.create({ ...fields, ...imageFields, createdBy: adminId, updatedBy: adminId }));
  },
  async update(id, input, adminId, file) {
    checkImage(input, file);
    const event = await Event.findById(id);
    if (!event) throw notFound();
    const merged = { startTime: event.startTime, endTime: event.endTime, ...input };
    if (merged.endTime && merged.endTime <= merged.startTime) {
      const message = 'A hora de fim deve ser posterior à hora de início.';
      throw new AppError(422, 'INVALID_EVENT_TIME_RANGE', message, [{ field: 'endTime', message }]);
    }
    const fields = await resolveEventLocation(input, event);
    const imageFields = file ? await editorialImageFields(file, 'INVALID_EVENT_IMAGE') : Object.hasOwn(input, 'image') ? { imageData: null, imageVersion: null, imageMimeType: null } : {};
    event.set({ ...fields, ...imageFields, updatedBy: adminId });
    try { await event.save(); }
    catch (error) {
      if (error.name === 'VersionError') throw new AppError(409, 'EVENT_CONFLICT', 'O evento foi alterado entretanto. Volta a abrir a edição e tenta novamente.');
      throw error;
    }
    return eventSummary(event);
  },
  async remove(id) {
    if (!await Event.findByIdAndDelete(id)) throw notFound();
    return null;
  }
};

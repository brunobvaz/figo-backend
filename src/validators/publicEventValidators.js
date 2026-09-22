import { z } from 'zod';
import { eventTypes, validEventDate } from '../models/Event.js';

const date = z.string().refine(validEventDate, 'Indica uma data válida no formato AAAA-MM-DD.');
const params = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Identificador de evento inválido.') });
export const listPublicEventsSchema = z.object({ query: z.object({
  type: z.enum(eventTypes).optional(),
  from: date.optional(),
  to: date.optional(),
  free: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict().refine(value => !value.from || !value.to || value.from <= value.to,
  { message: 'A data final deve ser igual ou posterior à data inicial.', path: ['to'] }) });
export const publicEventDetailSchema = z.object({ params });
export const publicEventImageSchema = z.object({ params, query: z.object({ v: z.uuid().optional() }).strict() });

import { z } from 'zod';
import { eventTypes, eventTimePattern, validEventDate } from '../models/Event.js';

const date = z.string().refine(validEventDate, 'Indica uma data válida no formato AAAA-MM-DD.');
const time = z.string().regex(eventTimePattern, 'Indica uma hora válida no formato HH:mm.');
const fields = {
  title: z.string().trim().min(2, 'O título deve ter pelo menos 2 caracteres.').max(120, 'O título pode ter até 120 caracteres.'),
  description: z.string().trim().max(2000, 'A descrição pode ter até 2000 caracteres.').optional(),
  type: z.enum(eventTypes, { error: 'Seleciona um tipo de evento válido.' }),
  date,
  startTime: time,
  endTime: time.nullable().optional(),
  location: z.string().trim().min(2, 'Indica a localidade do evento.').max(160, 'A localidade pode ter até 160 caracteres.'),
  municipalityCode: z.string({ error: 'Seleciona um concelho.' }).regex(/^\d{4}$/, 'Seleciona um concelho válido.'),
  parishCode: z.string({ error: 'Seleciona uma freguesia.' }).regex(/^\d{4}[A-Z0-9]{2}$/, 'Seleciona uma freguesia válida.'),
  distanceKm: z.number().min(0, 'A distância não pode ser negativa.').max(20000, 'A distância pode ter até 20000 km.').nullable().optional(),
  free: z.boolean().optional(),
  image: z.string().trim().max(2048).url('Indica um URL válido para a imagem.').refine(value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
    catch { return false; }
  }, 'A imagem deve usar um URL HTTPS sem credenciais.').nullable().optional()
};
const params = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Identificador de evento inválido.') });
const timeRange = value => !value.startTime || !value.endTime || value.endTime > value.startTime;
const timeError = { message: 'A hora de fim deve ser posterior à hora de início.', path: ['endTime'] };
export const createEventSchema = z.object({ body: z.object(fields).strict().refine(timeRange, timeError) });
export const updateEventSchema = z.object({ params, body: z.object(fields).partial().strict()
  .refine(value => Object.keys(value).length > 0, 'Indica pelo menos um campo para alterar.')
  .refine(timeRange, timeError)
  .superRefine((value, context) => {
    if (value.municipalityCode !== undefined && value.parishCode === undefined)
      context.addIssue({ code: 'custom', path: ['parishCode'], message: 'Seleciona a freguesia do concelho indicado.' });
    if (value.parishCode !== undefined && value.municipalityCode === undefined)
      context.addIssue({ code: 'custom', path: ['municipalityCode'], message: 'Indica também o concelho da freguesia.' });
  }) });
export const eventIdSchema = z.object({ params });
export const listEventsSchema = z.object({ query: z.object({
  search: z.string().trim().max(120).default(''),
  type: z.enum(eventTypes).optional(),
  from: date.optional(),
  to: date.optional(),
  free: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12)
}).strict().refine(value => !value.from || !value.to || value.from <= value.to, { message: 'A data final deve ser igual ou posterior à data inicial.', path: ['to'] }) });

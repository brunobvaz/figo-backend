import { z } from 'zod';

const coordinate = (min, max) => z.preprocess(v => v === null || (typeof v === 'string' && !v.trim()) ? undefined : v, z.coerce.number().finite().min(min).max(max));
const locationFields = { municipalityCode: z.string().regex(/^\d{4}$/), parishCode: z.string().regex(/^\d{4}[A-Z0-9]{2}$/), locality: z.string().trim().min(1).max(120), latitude: coordinate(-90, 90), longitude: coordinate(-180, 180), locationSource: z.literal('parish') };
const productFields = {
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(2000),
  price: z.coerce.number().positive().max(1_000_000),
  unit: z.enum(['€/kg', '€/unidade', '€/dúzia', '€/frasco', '€/caixa']),
  category: z.enum(['Frutas', 'Legumes', 'Ovos', 'Mel', 'Laticínios', 'Padaria', 'Bebidas', 'Conservas', 'Outros']),
  status: z.enum(['active', 'sold']).optional(),
  self_harvest: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).optional(),
  is_active: z.preprocess(v => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).optional(),
  seasonality: z.enum(['all_year', 'spring', 'summer', 'autumn', 'winter']).optional(),
  ...locationFields,
  image: z.string().url().nullable().optional()
};

export const createProductSchema = z.object({ body: z.object(productFields).strict() });
export const updateProductSchema = z.object({ body: z.object(productFields).partial().strict().refine(body => !Object.keys(locationFields).filter(key => key !== 'locality').some(key => key in body) || Object.keys(locationFields).every(key => key in body), 'Envia todos os campos da localização.').refine((body) => Object.keys(body).length > 0, 'Indica pelo menos um campo para alterar.') });
export const productIdSchema = z.object({ params: z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) }) });
export const listProductsSchema = z.object({ query: z.object({ availableOnly: z.enum(['true', 'false']).transform(value => value === 'true').optional(), unit: productFields.unit.optional(), minPrice: coordinate(0, 1_000_000).optional(), maxPrice: coordinate(0, 1_000_000).optional(), sort: z.enum(['recent', 'price_asc', 'price_desc', 'distance']).optional(), latitude: coordinate(-90, 90).optional(), longitude: coordinate(-180, 180).optional(), radiusKm: coordinate(0.1, 500).optional(), municipalityCode: z.string().regex(/^\d{4}$/).optional(), parishCode: z.string().regex(/^\d{4}[A-Z0-9]{2}$/).optional(), search: z.string().trim().max(100).optional(), category: z.string().trim().max(50).optional(), sellerId: z.string().regex(/^[a-f\d]{24}$/i).optional(), page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(50) }).refine(q => (q.latitude === undefined) === (q.longitude === undefined), 'Indica latitude e longitude em conjunto.').refine(q => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, 'O preço mínimo não pode ser superior ao máximo.').refine(q => q.sort !== 'distance' || q.latitude !== undefined, 'Ativa a proximidade para ordenar por distância.') });

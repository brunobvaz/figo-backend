import { z } from 'zod';
import { recipeDifficulties } from '../models/Recipe.js';

const image = z.string().trim().max(2048, 'O URL da imagem pode ter até 2048 caracteres.').url('Indica um URL válido para a imagem.').refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}, 'A imagem deve usar um URL HTTPS sem credenciais.').nullable().optional();
const category = z.string().trim().min(1, 'Indica uma categoria.').max(40, 'Cada categoria pode ter até 40 caracteres.');
const fields = {
  title: z.string().trim().min(2, 'O título deve ter pelo menos 2 caracteres.').max(120, 'O título pode ter até 120 caracteres.'),
  description: z.string().trim().min(10, 'A descrição deve ter pelo menos 10 caracteres.').max(2000, 'A descrição pode ter até 2000 caracteres.'),
  image,
  preparationMinutes: z.number().int('Indica um número inteiro de minutos.').min(1, 'O tempo deve ser de pelo menos 1 minuto.').max(1440, 'O tempo máximo é de 1440 minutos.'),
  difficulty: z.enum(recipeDifficulties, { error: 'Seleciona uma dificuldade válida.' }),
  categories: z.array(category).min(1, 'Indica pelo menos uma categoria.').max(10, 'Indica até 10 categorias.').refine(values => new Set(values.map(value => value.toLocaleLowerCase('pt-PT'))).size === values.length, 'Não repitas categorias.'),
  ingredients: z.array(z.string().trim().min(1, 'Os ingredientes não podem estar vazios.').max(160, 'Cada ingrediente pode ter até 160 caracteres.')).min(1, 'Indica pelo menos um ingrediente.').max(40, 'Indica até 40 ingredientes.'),
  seasonal: z.boolean().optional(),
  steps: z.array(z.string().trim().min(1, 'Os passos não podem estar vazios.').max(500, 'Cada passo pode ter até 500 caracteres.')).max(20, 'Indica até 20 passos.').optional()
};
const params = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, 'Identificador de receita inválido.') });
export const createRecipeSchema = z.object({ body: z.object(fields).strict() });
export const updateRecipeSchema = z.object({ params, body: z.object(fields).partial().strict().refine(value => Object.keys(value).length > 0, 'Indica pelo menos um campo para alterar.') });
export const recipeIdSchema = z.object({ params });
export const listRecipesSchema = z.object({ query: z.object({
  search: z.string().trim().max(120).default(''),
  category: category.optional(),
  difficulty: z.enum(recipeDifficulties).optional(),
  seasonal: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  quick: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12)
}).strict() });

import { Recipe, recipeSummary } from '../models/Recipe.js';
import { AppError } from '../utils/AppError.js';
import { recipeImageFields } from './recipeImageService.js';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const notFound = () => new AppError(404, 'RECIPE_NOT_FOUND', 'A receita já não existe.');

export const adminRecipeService = {
  async list({ search, category, difficulty, seasonal, quick, page, limit }) {
    const filter = {};
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: 'i' };
      filter.$or = [{ title: regex }, { description: regex }, { ingredients: regex }];
    }
    if (category) filter.categories = category;
    if (difficulty) filter.difficulty = difficulty;
    if (seasonal !== undefined) filter.seasonal = seasonal;
    if (quick) filter.preparationMinutes = { $lte: 30 };
    const [items, total, categories] = await Promise.all([
      Recipe.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Recipe.countDocuments(filter),
      Recipe.distinct('categories')
    ]);
    return { items: items.map(recipeSummary), pagination: { page, limit, total, pages: Math.ceil(total / limit) }, categories: categories.sort((a, b) => a.localeCompare(b, 'pt')) };
  },
  async get(id) {
    const recipe = await Recipe.findById(id).lean();
    if (!recipe) throw notFound();
    return recipeSummary(recipe);
  },
  async image(id) {
    const recipe = await Recipe.findById(id).select('+imageData imageMimeType');
    if (!recipe?.imageData) throw new AppError(404, 'RECIPE_IMAGE_NOT_FOUND', 'Esta receita não tem uma fotografia carregada.');
    return { data: Buffer.from(recipe.imageData), contentType: recipe.imageMimeType };
  },
  async create(input, adminId, file) {
    if (file && input.image) throw new AppError(422, 'AMBIGUOUS_RECIPE_IMAGE', 'Seleciona uma fotografia ou indica um URL, não ambos.');
    const imageFields = file ? await recipeImageFields(file) : {};
    return recipeSummary(await Recipe.create({ ...input, ...imageFields, createdBy: adminId, updatedBy: adminId }));
  },
  async update(id, input, adminId, file) {
    if (file && input.image) throw new AppError(422, 'AMBIGUOUS_RECIPE_IMAGE', 'Seleciona uma fotografia ou indica um URL, não ambos.');
    const imageFields = file ? await recipeImageFields(file) : Object.hasOwn(input, 'image') ? { imageData: null, imageVersion: null, imageMimeType: null } : {};
    const recipe = await Recipe.findByIdAndUpdate(id, { $set: { ...input, ...imageFields, updatedBy: adminId } }, { new: true, runValidators: true }).lean();
    if (!recipe) throw notFound();
    return recipeSummary(recipe);
  },
  async remove(id) {
    const recipe = await Recipe.findByIdAndDelete(id);
    if (!recipe) throw notFound();
    return null;
  }
};

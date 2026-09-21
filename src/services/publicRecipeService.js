import { Recipe } from '../models/Recipe.js';
import { AppError } from '../utils/AppError.js';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const publicFields = 'title description image imageVersion preparationMinutes difficulty categories ingredients seasonal steps';
const summary = recipe => ({
  id: recipe._id.toString(), title: recipe.title, description: recipe.description,
  image: recipe.imageVersion ? `/api/v1/recipes/${recipe._id}/image?v=${encodeURIComponent(recipe.imageVersion)}` : recipe.image ?? null,
  preparationMinutes: recipe.preparationMinutes, difficulty: recipe.difficulty,
  categories: recipe.categories, ingredients: recipe.ingredients, seasonal: recipe.seasonal,
  steps: recipe.steps || []
});

export const publicRecipeService = {
  async detail(id) {
    const recipe = await Recipe.findById(id).select(publicFields).lean();
    if (!recipe) throw new AppError(404, 'RECIPE_NOT_FOUND', 'Esta receita já não está disponível.');
    return summary(recipe);
  },
  async list({ category, quick, page, limit }) {
    const filter = {};
    if (category) filter.categories = { $regex: `^${escapeRegex(category)}$`, $options: 'i' };
    if (quick) filter.preparationMinutes = { $lte: 30 };
    const [items, total] = await Promise.all([
      Recipe.find(filter).select(publicFields).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Recipe.countDocuments(filter)
    ]);
    return { items: items.map(summary), pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  },
  async image(id, version) {
    const recipe = await Recipe.findById(id).select('+imageData imageMimeType imageVersion');
    if (!recipe?.imageData || (version && version !== recipe.imageVersion))
      throw new AppError(404, 'RECIPE_IMAGE_NOT_FOUND', 'Esta fotografia já não está disponível.');
    return { data: Buffer.from(recipe.imageData), contentType: recipe.imageMimeType };
  }
};

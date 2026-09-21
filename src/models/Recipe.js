import mongoose from 'mongoose';

export const recipeDifficulties = ['Fácil', 'Média', 'Difícil'];
const textList = (maxItems, maxLength, required = false) => ({
  type: [{ type: String, trim: true, minlength: 1, maxlength: maxLength }],
  default: [],
  validate: values => values.length <= maxItems && (!required || values.length > 0)
});

const schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  description: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
  image: { type: String, default: null, maxlength: 2048 },
  imageData: { type: Buffer, select: false },
  imageMimeType: { type: String, enum: ['image/webp', null], default: null },
  imageVersion: { type: String, default: null },
  preparationMinutes: { type: Number, required: true, min: 1, max: 1440, validate: Number.isInteger },
  difficulty: { type: String, required: true, enum: recipeDifficulties },
  categories: textList(10, 40, true),
  ingredients: textList(40, 160, true),
  seasonal: { type: Boolean, default: false },
  steps: textList(20, 500),
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true }
}, { timestamps: true, collection: 'recipes' });

schema.index({ createdAt: -1, _id: -1 });
schema.index({ categories: 1 });
schema.index({ seasonal: 1, preparationMinutes: 1 });

export const Recipe = mongoose.model('Recipe', schema);

// Preserve the mobile mock's field names for the future integration.
export function recipeSummary(recipe) {
  return {
    id: recipe._id.toString(), title: recipe.title, description: recipe.description,
    image: recipe.imageVersion ? `/api/v1/admin/recipes/${recipe._id}/image?v=${encodeURIComponent(recipe.imageVersion)}` : recipe.image ?? null,
    hasUploadedImage: Boolean(recipe.imageVersion), preparationMinutes: recipe.preparationMinutes,
    difficulty: recipe.difficulty, categories: recipe.categories, ingredients: recipe.ingredients,
    seasonal: recipe.seasonal, steps: recipe.steps,
    createdAt: recipe.createdAt, updatedAt: recipe.updatedAt
  };
}

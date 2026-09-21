import { editorialImageFields } from './editorialImageService.js';

export const recipeImageFields = file => editorialImageFields(file, 'INVALID_RECIPE_IMAGE');

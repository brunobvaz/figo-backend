import { productService } from '../services/productService.js';

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
export const productController = {
  async list(req, res) { ok(res, await productService.list(req.validated.query)); },
  async getById(req, res) { ok(res, await productService.getById(req.params.id)); },
  async create(req, res) { ok(res, await productService.create(req.user.id, req.body, req.file), 201); },
  async update(req, res) { ok(res, await productService.update(req.user.id, req.params.id, req.body, req.file)); },
  async remove(req, res) { await productService.remove(req.user.id, req.params.id); res.status(204).send(); }
};

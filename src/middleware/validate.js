export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });
  if (!result.success) return next(result.error);
  req.validated = { ...(req.validated || {}), ...result.data };
  if (result.data.body) req.body = result.data.body;
  if (result.data.params) req.params = result.data.params;
  next();
};

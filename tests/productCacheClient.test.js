import { expect, it } from 'vitest';
import { mergeProductCache } from '../../mobile/src/utils/productCache.js';
it('não restaura anúncio ativo com uma resposta antiga após desativar', () => {
 const inactive = { id: 'a', is_active: false, updatedAt: '2026-09-13T12:00:01Z' };
 const stale = { id: 'a', is_active: true, updatedAt: '2026-09-13T12:00:00Z' };
 expect(mergeProductCache([inactive], [stale])).toEqual([inactive]);
 const active = { ...inactive, is_active: true, updatedAt: '2026-09-13T12:00:02Z' };
 expect(mergeProductCache([inactive], [active])).toEqual([active]);
 expect(mergeProductCache([], [inactive])).toEqual([inactive]);
});

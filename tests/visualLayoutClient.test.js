import { describe, expect, it } from 'vitest';
import { productGridLayout, CONTENT_MAX_WIDTH } from '../../mobile/src/theme/layout.js';

describe('grelhas de produtos adaptáveis', () => {
  it.each([288, 328, 358, 398, 568, 712, 992, CONTENT_MAX_WIDTH - 32])('cabe numa largura de %s sem ultrapassar o conteúdo', width => {
    for (const fontScale of [1, 1.3, 1.8, 2.5]) {
      const { columns, cardWidth } = productGridLayout(width, fontScale);
      expect(cardWidth).toBeGreaterThan(0);
      expect(columns).toBeGreaterThanOrEqual(1);
      expect(columns).toBeLessThanOrEqual(4);
      expect(cardWidth * columns + 16 * (columns - 1)).toBeCloseTo(width, 6);
    }
  });
  it('passa de duas colunas no telefone a três no tablet e quatro no ecrã largo', () => {
    expect(productGridLayout(358).columns).toBe(2);
    expect(productGridLayout(712).columns).toBe(3);
    expect(productGridLayout(1168).columns).toBe(4);
  });
  it('reduz colunas quando a letra aumenta para deixar espaço ao texto', () => {
    expect(productGridLayout(358, 1.8).columns).toBe(1);
    expect(productGridLayout(712, 1.8).columns).toBe(1);
    expect(productGridLayout(992, 1.8).columns).toBe(2);
  });
});

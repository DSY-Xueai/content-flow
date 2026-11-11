export type CategoryId = 'all' | 'ai-models' | 'ai-products' | 'industry' | 'paper' | 'tip' | 'opinion';

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  shortLabel: string;
}

export const categories: CategoryMeta[] = [
  { id: 'all', label: '全部分类', shortLabel: '全部' },
  { id: 'ai-models', label: '模型发布/更新', shortLabel: '模型' },
  { id: 'ai-products', label: '产品发布/更新', shortLabel: '产品' },
  { id: 'industry', label: '行业动态', shortLabel: '行业' },
  { id: 'paper', label: '论文研究', shortLabel: '论文' },
  { id: 'tip', label: '教程与技巧', shortLabel: '教程' },
  { id: 'opinion', label: '观点', shortLabel: '观点' }
];

export function getCategoryLabel(category?: string | null): string {
  return categories.find((item) => item.id === category)?.label ?? '未分类';
}

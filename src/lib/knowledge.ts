import type { KnowledgeBucket, Platform } from '../types';

export const KNOWLEDGE_AXES = ['基础与模拟', '数据结构', '图论与树', '动态规划', '数学', '字符串', '搜索与构造', '贪心与思维'] as const;
type KnowledgeAxis = typeof KNOWLEDGE_AXES[number];

export function knowledgeAxis(value: string): KnowledgeAxis | null {
  const tag = value.trim().toLowerCase();
  if (!tag) return null;
  if (['data structures', 'data structure', 'array', 'hash', 'stack', 'queue', 'heap', 'linked list', 'segment tree', 'fenwick', 'dsu', '数据结构'].some((item) => tag.includes(item))) return '数据结构';
  if (['graph', 'tree', 'shortest path', 'mst', 'topological', '图论', '树'].some((item) => tag.includes(item))) return '图论与树';
  if (['dynamic programming', 'dp', '动态规划'].some((item) => tag === item || tag.includes(item))) return '动态规划';
  if (['math', 'number theory', 'combinatorics', 'geometry', 'probability', '数学', '几何'].some((item) => tag.includes(item))) return '数学';
  if (['string', 'trie', '字符串'].some((item) => tag.includes(item))) return '字符串';
  if (['binary search', 'brute force', 'backtracking', 'dfs', 'bfs', 'constructive', 'search', '搜索', '构造'].some((item) => tag.includes(item))) return '搜索与构造';
  if (['greedy', 'two pointers', 'sliding window', 'divide and conquer', 'sort', '贪心', '思维'].some((item) => tag.includes(item))) return '贪心与思维';
  if (['implementation', 'simulation', 'basic', '基础', '模拟', '算法策略'].some((item) => tag.includes(item))) return '基础与模拟';
  return null;
}

export function knowledgeScore(count: number) {
  return Math.min(100, Math.round((1 - Math.exp(-count / 24)) * 100));
}

export function buildKnowledgeProfile(platform: Platform, problems: Array<{ solved?: boolean; tagAxes?: string[]; tags?: string[] }>): KnowledgeBucket[] {
  const counts = new Map<string, number>();
  for (const problem of problems.filter((item) => item.solved !== false)) {
    const axes = new Set([...(problem.tagAxes || []), ...(problem.tags || [])].map(knowledgeAxis).filter((axis): axis is KnowledgeAxis => axis !== null));
    for (const axis of axes) counts.set(axis, (counts.get(axis) || 0) + 1);
  }
  if (![...counts.values()].some((count) => count > 0)) return [];
  return KNOWLEDGE_AXES.map((axis) => ({ platform, axis, count: counts.get(axis) || 0, score: knowledgeScore(counts.get(axis) || 0) }));
}

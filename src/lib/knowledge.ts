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

export function evidenceScore(weights: number[]) {
  const evidence = [...weights].sort((left, right) => right - left)
    .reduce((sum, weight, index) => sum + weight / Math.pow(index + 1, 0.45), 0);
  return Math.min(100, Math.round((1 - Math.exp(-evidence / 5.5)) * 100));
}

export function knowledgeDifficultyWeight(platform: Platform, difficulty?: string | null, tier?: string | null) {
  const label = (tier || difficulty || '').trim().toLowerCase();
  if (platform === 'codeforces') {
    const rating = Number(label);
    return Number.isFinite(rating) && rating > 0 ? 0.65 + Math.min(1, Math.max(0, (rating - 800) / 1600)) * 0.8 : 0.85;
  }
  if (platform === 'leetcode') return label === 'hard' ? 1.35 : label === 'medium' ? 1 : label === 'easy' ? 0.72 : 0.85;
  if (platform === 'qoj') return label.includes('gold') || label.includes('金') ? 1.4 : label.includes('silver') || label.includes('银') ? 1.2 : label.includes('bronze') || label.includes('铜') ? 1 : label.includes('iron') || label.includes('铁') ? 0.78 : 0.85;
  return 0.85;
}

export function buildKnowledgeProfile(platform: Platform, problems: Array<{ solved?: boolean; tagAxes?: string[]; tags?: string[]; difficulty?: string | null; tier?: string | null }>): KnowledgeBucket[] {
  const evidence = new Map<string, number[]>();
  for (const problem of problems.filter((item) => item.solved !== false)) {
    const axes = new Set([...(problem.tagAxes || []), ...(problem.tags || [])].map(knowledgeAxis).filter((axis): axis is KnowledgeAxis => axis !== null));
    const weight = knowledgeDifficultyWeight(platform, problem.difficulty, problem.tier);
    for (const axis of axes) evidence.set(axis, [...(evidence.get(axis) || []), weight]);
  }
  if (![...evidence.values()].some((items) => items.length > 0)) return [];
  return KNOWLEDGE_AXES.map((axis) => ({ platform, axis, count: evidence.get(axis)?.length || 0, score: evidenceScore(evidence.get(axis) || []) }));
}

export function mergeKnowledgeBuckets(data: KnowledgeBucket[], platform?: Platform | null) {
  return KNOWLEDGE_AXES.map((axis) => {
    const items = data.filter((item) => item.axis === axis && (!platform || item.platform === platform));
    const count = items.reduce((sum, item) => sum + item.count, 0);
    const confidence = items.reduce((sum, item) => sum + Math.sqrt(item.count), 0);
    const score = confidence ? Math.round(items.reduce((sum, item) => sum + item.score * Math.sqrt(item.count), 0) / confidence) : 0;
    return { platform: platform || 'codeforces' as Platform, axis, count, score };
  });
}

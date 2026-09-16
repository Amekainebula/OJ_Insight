import { useEffect, useMemo, useState } from 'react';
import { PLATFORM_META } from '../lib/platforms';
import type { KnowledgeBucket, Platform } from '../types';

const PROFILE_PLATFORMS: Platform[] = ['codeforces', 'leetcode', 'qoj'];
const LABELS: Record<string, string> = { codeforces: 'Codeforces', leetcode: 'LeetCode', qoj: 'XCPC' };

function point(index: number, value: number, count: number, radius = 72) {
  const angle = Math.PI * 2 * index / count - Math.PI / 2;
  const scale = value / 100;
  return `${100 + Math.cos(angle) * radius * scale},${100 + Math.sin(angle) * radius * scale}`;
}

export default function KnowledgeRadar({ data, selectedPlatform }: { data: KnowledgeBucket[]; selectedPlatform?: Platform | null }) {
  const available = PROFILE_PLATFORMS.filter((platform) => data.some((item) => item.platform === platform && item.count > 0));
  const preferred = selectedPlatform && PROFILE_PLATFORMS.includes(selectedPlatform) ? selectedPlatform : null;
  const [active, setActive] = useState<Platform | null>(preferred || available[0] || null);
  useEffect(() => { if (preferred) setActive(preferred); else if (!active || !available.includes(active)) setActive(available[0] || null); }, [preferred, available.join('|')]);
  const rows = useMemo(() => data.filter((item) => item.platform === active), [data, active]);
  if (!active || !rows.some((item) => item.count > 0)) return null;
  const grid = [25, 50, 75, 100].map((value) => rows.map((_, index) => point(index, value, rows.length)).join(' '));
  const shape = rows.map((item, index) => point(index, item.score, rows.length)).join(' ');
  return <section className="panel knowledge-panel">
    <div className="panel-head"><div><small>KNOWLEDGE PROFILE · 生涯累计</small><h2>能力画像</h2><p>按已 AC 题目的标签归并为八个稳定维度；面积用于观察结构，不等同于绝对水平。</p></div></div>
    {!preferred && <div className="knowledge-tabs">{available.map((platform) => <button className={active === platform ? 'active' : ''} onClick={() => setActive(platform)} key={platform}><i style={{ background: PLATFORM_META[platform].accent }} />{LABELS[platform]}</button>)}</div>}
    <div className="knowledge-body">
      <svg viewBox="0 0 200 200" role="img" aria-label={`${LABELS[active]} 能力雷达图`}>
        {grid.map((points, index) => <polygon className="knowledge-grid" points={points} key={index} />)}
        {rows.map((_, index) => <line className="knowledge-axis" x1="100" y1="100" x2={point(index, 100, rows.length).split(',')[0]} y2={point(index, 100, rows.length).split(',')[1]} key={index} />)}
        <polygon className="knowledge-shape" points={shape} />
        {rows.map((item, index) => { const [cx, cy] = point(index, item.score, rows.length).split(','); return <circle cx={cx} cy={cy} r="3" key={item.axis}><title>{item.axis}：{item.count} 题</title></circle>; })}
      </svg>
      <div className="knowledge-legend">{rows.map((item) => <div key={item.axis}><span>{item.axis}</span><i><b style={{ width: `${item.score}%` }} /></i><strong>{item.count}<small>题</small></strong></div>)}</div>
    </div>
  </section>;
}

import { useState } from 'react';
import { Clipboard, Download } from 'lucide-react';
import { api } from '../services/api';
import { currentYear } from '../lib/date';
import { exportHeatmap, exportVisual } from '../services/export';
import { PLATFORM_META, PLATFORM_ORDER } from '../lib/platforms';
import { scopeRange, type AccountMap } from '../lib/ui';
import type { Metric, Platform } from '../types';

export default function ExportPage({ accounts, metric, timeZone }: { accounts: AccountMap; metric: Metric; timeZone: string }) {
  const [from, setFrom] = useState(currentYear(timeZone) - 2);
  const [to, setTo] = useState(currentYear(timeZone));
  const [until, setUntil] = useState(false);
  const [scope, setScope] = useState<'all' | Platform>('all');
  const [format, setFormat] = useState<'png' | 'svg'>('png');
  const [chart, setChart] = useState<'heatmap' | 'difficulty' | 'knowledge' | 'overview'>('heatmap');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const years = Array.from({ length: currentYear(timeZone) - 2009 }, (_, index) => 2010 + index);
  const run = async (action: 'save' | 'copy') => {
    setBusy(true);
    try {
      const range = until ? scopeRange('until', timeZone) : { start: `${from}-01-01`, end: `${to}-12-31` };
      const snap = await api.snapshot(scope === 'all' ? null : scope, range.start, range.end, metric, null, null, timeZone);
      const title = `OJ Insight · ${scope === 'all' ? '所有 OJ' : PLATFORM_META[scope].name} · ${until ? '至今（近一年）' : `${from}–${to}`}`;
      if (chart === 'heatmap') await exportHeatmap(title, snap.daily, until ? Number(range.start.slice(0, 4)) : from, until ? Number(range.end.slice(0, 4)) : to, format, range.start, range.end, action);
      else await exportVisual(title, snap, chart, format, action);
      setMessage(action === 'copy' ? '图片已复制到剪贴板' : '图片已导出');
    } catch (error) { setMessage(`操作失败：${String(error)}`); }
    finally { setBusy(false); window.setTimeout(() => setMessage(''), 3200); }
  };
  return <>
    <header className="topbar"><div><small>EXPORT</small><h1>导出</h1><p>活动砖、难度分布、能力画像与生涯总图均可保存或直接复制。</p></div></header>
    <div className="export-layout"><section className="panel export-form"><label>图表<select value={chart} onChange={(event) => setChart(event.target.value as typeof chart)}><option value="heatmap">活动砖</option><option value="difficulty">难度分布</option><option value="knowledge">能力画像</option><option value="overview">生涯总图</option></select></label><label>范围<div className="segmented"><button className={!until ? 'active' : ''} onClick={() => setUntil(false)}>年份区间</button><button className={until ? 'active' : ''} onClick={() => setUntil(true)}>至今</button></div></label>{!until && <label>年份<div className="range-row"><select value={from} onChange={(event) => setFrom(Number(event.target.value))}>{years.map((year) => <option key={year}>{year}</option>)}</select><span>—</span><select value={to} onChange={(event) => setTo(Number(event.target.value))}>{years.map((year) => <option key={year}>{year}</option>)}</select></div></label>}<label>平台<select value={scope} onChange={(event) => setScope(event.target.value as 'all' | Platform)}><option value="all">所有 OJ 合并</option>{PLATFORM_ORDER.map((platform) => <option key={platform} value={platform} disabled={!accounts[platform].length}>{PLATFORM_META[platform].name}</option>)}</select></label><label>保存格式<div className="segmented"><button className={format === 'png' ? 'active' : ''} onClick={() => setFormat('png')}>PNG</button><button className={format === 'svg' ? 'active' : ''} onClick={() => setFormat('svg')}>SVG</button></div></label><div className="export-actions"><button className="primary export-btn" onClick={() => void run('save')} disabled={busy || (!until && from > to)}><Download size={16} />{busy ? '生成中…' : '保存图片'}</button><button className="export-btn" onClick={() => void run('copy')} disabled={busy || (!until && from > to)}><Clipboard size={16} />复制图片</button></div>{message && <small className="export-message">{message}</small>}</section><section className="panel export-preview"><div className="mock-export"><div><strong>OJ Insight · {{ heatmap: '活动砖', difficulty: '难度分布', knowledge: '能力画像', overview: '生涯总图' }[chart]}</strong><small>{until ? '至今' : `${from} — ${to}`}</small></div><div className={`mock-grid mock-${chart}`}>{Array.from({ length: chart === 'heatmap' ? 160 : 32 }).map((_, index) => <i key={index} className={`level-${(index * 17 + index * index) % 5}`} />)}</div><span>{scope === 'all' ? '所有 OJ' : PLATFORM_META[scope].name}</span></div></section></div>
  </>;
}

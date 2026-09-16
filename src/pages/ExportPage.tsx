import { useState } from 'react';
import { Activity, BarChart3, Clipboard, Download, LayoutDashboard, Radar } from 'lucide-react';
import { api } from '../services/api';
import { currentYear } from '../lib/date';
import { exportHeatmap, exportVisual, type ExportSection } from '../services/export';
import { PLATFORM_META, PLATFORM_ORDER } from '../lib/platforms';
import { scopeRange, type AccountMap } from '../lib/ui';
import type { Metric, Platform } from '../types';

type ChartType = 'heatmap' | 'difficulty' | 'knowledge' | 'overview';
const CHARTS: Array<{ value: ChartType; label: string; note: string; Icon: typeof Activity }> = [
  { value: 'heatmap', label: '活动砖', note: '训练活跃度', Icon: Activity },
  { value: 'difficulty', label: '难度分布', note: '已解题目结构', Icon: BarChart3 },
  { value: 'knowledge', label: '能力画像', note: '八维知识结构', Icon: Radar },
  { value: 'overview', label: '生涯总图', note: '核心数据卡片', Icon: LayoutDashboard },
];

export default function ExportPage({ accounts, metric, timeZone }: { accounts: AccountMap; metric: Metric; timeZone: string }) {
  const [from, setFrom] = useState(currentYear(timeZone) - 2);
  const [to, setTo] = useState(currentYear(timeZone));
  const [until, setUntil] = useState(false);
  const [scope, setScope] = useState<'all' | Platform>('all');
  const [format, setFormat] = useState<'png' | 'svg'>('png');
  const [chart, setChart] = useState<ChartType>('heatmap');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const years = Array.from({ length: currentYear(timeZone) - 2009 }, (_, index) => 2010 + index);
  const run = async (action: 'save' | 'copy') => {
    setBusy(true);
    try {
      const range = until ? scopeRange('until', timeZone) : { start: `${from}-01-01`, end: `${to}-12-31` };
      const targets: Array<Platform | null> = scope === 'all' ? [null, ...PLATFORM_ORDER] : [scope];
      const sections: ExportSection[] = await Promise.all(targets.map(async (platform) => ({
        platform,
        label: platform ? PLATFORM_META[platform].name : '总览 · 所有 OJ',
        snapshot: await api.snapshot(platform, range.start, range.end, metric, null, null, timeZone),
      })));
      const title = `OJ Insight · ${scope === 'all' ? '所有 OJ' : PLATFORM_META[scope].name} · ${until ? '至今（近一年）' : `${from}–${to}`}`;
      const delivered = chart === 'heatmap'
        ? await exportHeatmap(title, sections, format, range.start, range.end, action)
        : await exportVisual(title, sections, chart, format, action, range.start, range.end);
      if (delivered) setMessage(action === 'copy' ? '图片已复制到剪贴板' : '图片已导出');
    } catch (error) { setMessage(`操作失败：${String(error)}`); }
    finally { setBusy(false); window.setTimeout(() => setMessage(''), 3200); }
  };
  return <>
    <header className="topbar"><div><small>EXPORT</small><h1>导出</h1><p>活动砖、难度分布、能力画像与生涯总图均可保存或直接复制。</p></div></header>
    <section className="export-type-picker" aria-label="选择导出图表">{CHARTS.map(({ value, label, note, Icon }) => <button key={value} className={chart === value ? 'active' : ''} onClick={() => setChart(value)}><Icon size={19} /><span><strong>{label}</strong><small>{note}</small></span></button>)}</section>
    <div className="export-layout"><section className="panel export-form"><label>范围<div className="segmented"><button className={!until ? 'active' : ''} onClick={() => setUntil(false)}>年份区间</button><button className={until ? 'active' : ''} onClick={() => setUntil(true)}>至今</button></div></label>{!until && <label>年份<div className="range-row"><select value={from} onChange={(event) => setFrom(Number(event.target.value))}>{years.map((year) => <option key={year}>{year}</option>)}</select><span>—</span><select value={to} onChange={(event) => setTo(Number(event.target.value))}>{years.map((year) => <option key={year}>{year}</option>)}</select></div></label>}<label>平台<select value={scope} onChange={(event) => setScope(event.target.value as 'all' | Platform)}><option value="all">总览 + 所有 OJ</option>{PLATFORM_ORDER.map((platform) => <option key={platform} value={platform} disabled={!accounts[platform].length}>{PLATFORM_META[platform].name}</option>)}</select></label><label>保存格式<div className="segmented"><button className={format === 'png' ? 'active' : ''} onClick={() => setFormat('png')}>PNG</button><button className={format === 'svg' ? 'active' : ''} onClick={() => setFormat('svg')}>SVG</button></div></label><div className="export-actions"><button className="primary export-btn" onClick={() => void run('save')} disabled={busy || (!until && from > to)}><Download size={16} />{busy ? '生成中…' : '保存图片'}</button><button className="export-btn" onClick={() => void run('copy')} disabled={busy || (!until && from > to)}><Clipboard size={16} />复制图片</button></div>{message && <small className="export-message">{message}</small>}</section><section className="panel export-preview"><ExportPreview chart={chart} title={CHARTS.find((item) => item.value === chart)!.label} period={until ? '至今' : `${from} — ${to}`} platform={scope === 'all' ? '总览 + 所有 OJ' : PLATFORM_META[scope].name} /></section></div>
  </>;
}

function ExportPreview({ chart, title, period, platform }: { chart: ChartType; title: string; period: string; platform: string }) {
  return <div className="export-preview-sheet"><header><div><small>OJ INSIGHT</small><strong>{title}</strong></div><span>{platform} · {period}</span></header><div className="export-preview-scopes"><b>总览</b><span>CF</span><span>ATC</span><span>LG</span><span>NC</span><span>QOJ</span><span>LC</span></div><div className={`export-preview-chart ${chart}`}>
    {chart === 'heatmap' && <div className="preview-heatmap">{Array.from({ length: 168 }, (_, index) => <i key={index} className={`level-${(index * 13 + index * index) % 5}`} />)}</div>}
    {chart === 'difficulty' && <div className="preview-bars">{[32,48,73,92,82,59,39,22].map((height, index) => <i key={index} style={{ height: `${height}%` }}><b>{index + 1}</b></i>)}</div>}
    {chart === 'knowledge' && <svg viewBox="0 0 240 220"><polygon points="120,18 192,48 222,110 192,178 120,205 48,178 18,110 48,48"/><polygon className="shape" points="120,42 176,64 185,110 169,155 120,180 69,161 48,110 76,70"/>{[[120,42],[176,64],[185,110],[169,155],[120,180],[69,161],[48,110],[76,70]].map(([cx,cy], index) => <circle key={index} cx={cx} cy={cy} r="4" />)}</svg>}
    {chart === 'overview' && <div className="preview-cards">{['生涯解题','AC 提交','活跃天数','最长连续'].map((label,index) => <div key={label}><small>{label}</small><strong>{[428,690,136,21][index]}</strong></div>)}</div>}
  </div><footer>Generated by OJ Insight</footer></div>;
}

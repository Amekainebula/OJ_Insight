import { save } from '@tauri-apps/plugin-dialog';
import { sep } from '@tauri-apps/api/path';
import { APP_VERSION } from '../lib/version';
import type { AccountConfig, DailyPoint, Snapshot } from '../types';
import { api } from './api';

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 76;
const TOP = 46;
const WEEKS = 53;

async function svgToPng(svg: string, width: number, height: number) {
  const img = new Image();
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = width * 2; canvas.height = height * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2); ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG 编码失败')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

async function deliverSvg(svg: string, width: number, height: number, filename: string, format: 'png' | 'svg', action: 'save' | 'copy') {
  if (action === 'copy') {
    const png = await svgToPng(svg, width, height);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  }
  const storage = await api.storageInfo();
  const separator = sep();
  const slash = storage.exportDir.endsWith('/') || storage.exportDir.endsWith('\\') ? '' : separator;
  const path = await save({ defaultPath: `${storage.exportDir}${slash}${filename}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
  if (!path) return false;
  const data = format === 'svg' ? new TextEncoder().encode(svg) : new Uint8Array(await (await svgToPng(svg, width, height)).arrayBuffer());
  await api.writeExportFile(path, Array.from(data));
  return true;
}

const level = (n: number, max: number) => {
  if (!n) return 0;
  if (max <= 1) return 4;
  const x = n / max;
  if (x <= .2) return 1;
  if (x <= .45) return 2;
  if (x <= .72) return 3;
  return 4;
};

const levelOpacity = [0, .30, .52, .76, 1];
type ExportDay = { day: string; week: number; dow: number; count: number };

function yearDays(year: number, points: Map<string, number>, startDay?:string, endDay?:string) {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const dec31 = new Date(Date.UTC(year, 11, 31));
  const firstSunday = new Date(jan1);
  firstSunday.setUTCDate(jan1.getUTCDate() - jan1.getUTCDay());
  const rows: ExportDay[] = [];
  for (let d = new Date(firstSunday); d <= dec31; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCFullYear() > year) break;
    const day = d.toISOString().slice(0, 10);
    if (d.getUTCFullYear() === year && (!startDay || day>=startDay) && (!endDay || day<=endDay)) {
      const diff = Math.floor((d.getTime() - firstSunday.getTime()) / 86400000);
      rows.push({ day, week: Math.floor(diff / 7), dow: d.getUTCDay(), count: points.get(day) || 0 });
    }
  }
  return rows;
}

function rangeDays(startDay:string,endDay:string,points:Map<string,number>) {
  const start=new Date(`${startDay}T00:00:00Z`),end=new Date(`${endDay}T00:00:00Z`),firstSunday=new Date(start);
  firstSunday.setUTCDate(start.getUTCDate()-start.getUTCDay());const rows:ExportDay[]=[];
  for(let d=new Date(firstSunday);d<=end;d.setUTCDate(d.getUTCDate()+1)){
    const day=d.toISOString().slice(0,10);if(day<startDay)continue;
    const diff=Math.floor((d.getTime()-firstSunday.getTime())/86400000);rows.push({day,week:Math.floor(diff/7),dow:d.getUTCDay(),count:points.get(day)||0});
  }
  return rows;
}

export async function exportHeatmap(title: string, daily: DailyPoint[], startYear: number, endYear: number, format: 'png' | 'svg', startDay?:string, endDay?:string, action: 'save' | 'copy' = 'save') {
  const map = new Map(daily.map((x) => [x.day, x.count]));
  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);
  const ranges:Array<{label:string;days:ExportDay[]}>=startDay&&endDay
    ? [{label:`${startDay} — ${endDay}`,days:rangeDays(startDay,endDay,map)}]
    : years.map(year=>({label:String(year),days:yearDays(year,map)}));
  const yearHeight = TOP + 7 * STEP + 34;
  const weeks=Math.max(WEEKS,...ranges.flatMap(r=>r.days.map(d=>d.week+1)));
  const width = LEFT + weeks * STEP + 30;
  const height = 28 + ranges.length * yearHeight + 34;
  const max = Math.max(1, ...daily.map((x) => x.count));
  const rootStyle = getComputedStyle(document.documentElement);
  const heatmapColor = `rgb(${(rootStyle.getPropertyValue('--heatmap-rgb').trim() || '85 215 125').replace(/\s+/g, ',')})`;
  const emptyColor = rootStyle.getPropertyValue('--brick-empty').trim() || '#1c232a';

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
  let body = `<rect width="100%" height="100%" fill="#0b0e12"/><text x="24" y="30" fill="#f1f4f7" font-size="18" font-family="Segoe UI,Arial">${esc(title)}</text>`;
  ranges.forEach((range, yi) => {
    const oy = 28 + yi * yearHeight;
    body += `<text x="24" y="${oy + 34}" fill="#9aa4af" font-size="13" font-family="Segoe UI,Arial">${range.label}</text>`;
    for (const item of range.days) {
      const x = LEFT + item.week * STEP;
      const y = oy + TOP + item.dow * STEP;
      const bucket = level(item.count, max);
      body += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${bucket ? heatmapColor : emptyColor}"${bucket ? ` fill-opacity="${levelOpacity[bucket]}"` : ''}/>`;
    }
  });
  body += `<text x="24" y="${height - 16}" fill="#66717d" font-size="11" font-family="Segoe UI,Arial">Generated by OJ Insight</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return deliverSvg(svg, width, height, `OJ-Insight-${startDay&&endDay?'until-now':`${startYear}-${endYear}`}`, format, action);
}

const esc = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]!));

export async function exportVisual(title: string, snapshot: Snapshot, kind: 'difficulty' | 'knowledge' | 'overview', format: 'png' | 'svg', action: 'save' | 'copy') {
  const width = 1000, height = 600;
  let body = `<rect width="100%" height="100%" fill="#0b0e12"/><text x="42" y="54" fill="#f1f4f7" font-size="25" font-family="Segoe UI,Arial">${esc(title)}</text>`;
  if (kind === 'difficulty') {
    const rows = snapshot.difficulty.filter((item) => item.count > 0).slice(0, 18); const max = Math.max(1, ...rows.map((item) => item.count));
    rows.forEach((item, index) => { const x = 48 + index * (900 / Math.max(1, rows.length)); const h = item.count / max * 390; body += `<rect x="${x}" y="${500-h}" width="${Math.max(12, 720 / Math.max(1, rows.length))}" height="${h}" rx="5" fill="#55d77d"/><text x="${x}" y="525" fill="#8e99a5" font-size="11" font-family="Segoe UI,Arial" transform="rotate(35 ${x} 525)">${esc(item.label)}</text><text x="${x}" y="${486-h}" fill="#dce3e8" font-size="12" font-family="Segoe UI,Arial">${item.count}</text>`; });
  } else if (kind === 'knowledge') {
    const rows = (snapshot.knowledge || []).filter((item) => item.count > 0 || item.score >= 0).slice(0, 8); const cx = 330, cy = 315, radius = 205;
    const pt = (index:number, score:number) => { const angle = Math.PI*2*index/rows.length-Math.PI/2; return [cx+Math.cos(angle)*radius*score/100,cy+Math.sin(angle)*radius*score/100]; };
    [25,50,75,100].forEach((score) => body += `<polygon points="${rows.map((_,i)=>pt(i,score).join(',')).join(' ')}" fill="none" stroke="#29323b"/>`);
    body += `<polygon points="${rows.map((item,i)=>pt(i,item.score).join(',')).join(' ')}" fill="#55d77d44" stroke="#55d77d" stroke-width="3"/>`;
    rows.forEach((item,index) => { const [x,y]=pt(index,118); body += `<text x="${x}" y="${y}" text-anchor="middle" fill="#b6c0c9" font-size="14" font-family="Segoe UI,Arial">${esc(item.axis)}</text>`; });
  } else {
    const cards = [['生涯解题',snapshot.career.solved],['AC 提交',snapshot.career.accepted_submissions],['活跃天数',snapshot.career.active_days],['最长连续',snapshot.career.longest_streak]];
    cards.forEach(([label,value],index) => { const x=48+(index%2)*456,y=105+Math.floor(index/2)*170; body += `<rect x="${x}" y="${y}" width="420" height="138" rx="14" fill="#151b21" stroke="#29323b"/><text x="${x+28}" y="${y+42}" fill="#89949f" font-size="14" font-family="Segoe UI,Arial">${label}</text><text x="${x+28}" y="${y+101}" fill="#f1f4f7" font-size="42" font-family="Segoe UI,Arial" font-weight="700">${value}</text>`; });
  }
  body += `<text x="42" y="574" fill="#66717d" font-size="12" font-family="Segoe UI,Arial">Generated by OJ Insight</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return deliverSvg(svg, width, height, `OJ-Insight-${kind}`, format, action);
}

export async function exportPersonalProfile(accounts: AccountConfig[], includeCredentials: boolean) {
  const storage = await api.storageInfo();
  const separator = sep();
  const slash = storage.exportDir.endsWith('/') || storage.exportDir.endsWith('\\') ? '' : separator;
  const suffix = includeCredentials ? 'with-credentials' : 'safe';
  const defaultPath = `${storage.exportDir}${slash}OJ-Insight-personal-profile-${suffix}.json`;
  const path = await save({ defaultPath, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (!path) return false;
  const exportedAccounts = accounts
    .filter((entry) => entry.account.trim())
    .map((entry) => ({
      platform: entry.platform,
      account: entry.account.trim(),
      ...(includeCredentials && entry.secret.trim() ? { secret: entry.secret.trim() } : {}),
    }));
  const profile = {
    schema: 'com.ojinsight.personal-profile',
    schema_version: 1,
    app_version: APP_VERSION,
    exported_at: new Date().toISOString(),
    contains_credentials: includeCredentials,
    accounts: exportedAccounts,
  };
  const data = new TextEncoder().encode(`${JSON.stringify(profile, null, 2)}\n`);
  await api.writeExportFile(path, Array.from(data));
  return true;
}

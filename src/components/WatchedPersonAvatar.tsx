import { useEffect, useState, type ReactNode } from 'react';
import { PLATFORM_ORDER } from '../lib/platforms';
import { api } from '../services/api';
import type { WatchedPerson } from '../types';

const positiveTtl = 7 * 24 * 60 * 60 * 1000;
const negativeTtl = 60 * 60 * 1000;

interface CachedAvatar { image: string | null; expires: number }

function cacheKey(platform: string, account: string) {
  return `oj-insight.watched-avatar.${platform}.${account.toLocaleLowerCase()}`;
}

function readCache(key: string): CachedAvatar | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedAvatar;
    return cached.expires > Date.now() ? cached : null;
  } catch { return null; }
}

function writeCache(key: string, image: string | null) {
  try { localStorage.setItem(key, JSON.stringify({ image, expires: Date.now() + (image ? positiveTtl : negativeTtl) })); }
  catch { /* Avatar caching is optional. */ }
}

const pendingAvatars = new Map<string, Promise<string | null>>();

function compressAvatar(mime: string, bytes: number[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const source = new Image();
    source.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext('2d');
      if (!context) { reject(new Error('Canvas unavailable')); return; }
      const side = Math.min(source.naturalWidth, source.naturalHeight);
      context.drawImage(source, (source.naturalWidth - side) / 2, (source.naturalHeight - side) / 2, side, side, 0, 0, 64, 64);
      resolve(canvas.toDataURL('image/webp', 0.82));
    };
    source.onerror = () => reject(new Error('Avatar image unavailable'));
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) {
      binary += String.fromCharCode(...bytes.slice(index, index + 8192));
    }
    source.src = `data:${mime};base64,${btoa(binary)}`;
  });
}

function loadAvatar(person: WatchedPerson): Promise<string | null> {
  const key = cacheKey(person.platform, person.account);
  const cached = readCache(key);
  if (cached) return Promise.resolve(cached.image);
  const pending = pendingAvatars.get(key);
  if (pending) return pending;
  const request = (async () => {
    let image: string | null = null;
    try {
      const source = await api.getWatchedAvatar(person.platform, person.account);
      if (source) image = await compressAvatar(source.mime, source.bytes);
    } catch { /* The next platform may have an avatar. */ }
    writeCache(key, image);
    pendingAvatars.delete(key);
    return image;
  })();
  pendingAvatars.set(key, request);
  return request;
}

export default function WatchedPersonAvatar({ people, fallback }: { people: WatchedPerson[]; fallback: ReactNode }) {
  const signature = people.map((person) => `${person.platform}:${person.account}`).join('|');
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImage(null);
    const ordered = [...people].sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));
    void (async () => {
      for (const person of ordered) {
        const avatar = await loadAvatar(person);
        if (cancelled) return;
        if (avatar) { setImage(avatar); return; }
      }
    })();
    return () => { cancelled = true; };
  }, [signature]);

  return image
    ? <span className="relationship-person-avatar" aria-hidden="true"><img src={image} alt="" /></span>
    : <>{fallback}</>;
}

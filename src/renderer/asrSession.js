import { useEffect, useState } from 'react';
import { api } from './App.jsx';

/* 转写任务保存在模块级，切换页面/页签不会丢失进度与结果 */
const jobs = new Map(); // key = fileId|callId → { busy, pct, elapsed, result, error }
const listeners = new Set();
let wired = false;

const keyOf = (fileId, callId) => `${fileId}|${callId}`;
const emit = () => listeners.forEach(fn => fn());

export function useAsrJobs() {
  const [, force] = useState(0);
  useEffect(() => {
    if (!wired) {
      wired = true;
      api.on('asr:progress', p => {
        const job = jobs.get(p?.key);
        if (!job) return;
        job.pct = p.pct || 0;
        job.elapsed = p.elapsed || 0;
        emit();
      });
    }
    const fn = () => force(x => x + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return jobs;
}

export function getAsrJob(fileId, callId) {
  return jobs.get(keyOf(fileId, callId));
}

export async function startAsr({ fileId, callId, mode }) {
  const key = keyOf(fileId, callId);
  jobs.set(key, { busy: true, pct: 0, elapsed: 0, result: null, error: null });
  emit();
  try {
    const r = await api.asrTranscribe({ fileId, callId, mode, key });
    const job = jobs.get(key);
    if (r.ok) { job.result = r; job.pct = 1; } else { job.result = r; job.error = r.error || '识别失败'; }
  } catch (e) {
    const job = jobs.get(key);
    job.error = String(e.message || e);
  } finally {
    const job = jobs.get(key);
    job.busy = false;
    emit();
  }
}

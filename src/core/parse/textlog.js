// M-Ryuga — 文本信令日志解析（VOS / EP CALLFLOW 导出、纯 SIP 文本）
// 支持两种形态：
//  1) CALLFLOW|时间|方向|源|方法|目的|  后紧跟原始 SIP 报文（VOS 呼叫流水）
//  2) 无 CALLFLOW 标记的纯 SIP 报文串（时间取顺序，地址取 Via / 请求行）
// 输出统一的报文块：{ text, tsUs, srcIp, sport, dstIp, dport }

const fs = require('fs');

const MAX_TEXT = 64 * 1024 * 1024;
const SIP_START_RE = /^(SIP\/2\.0\s+\d{3}|(INVITE|ACK|BYE|CANCEL|REGISTER|OPTIONS|INFO|PRACK|UPDATE|REFER|SUBSCRIBE|NOTIFY|MESSAGE|PUBLISH)\s+\S+\s+SIP\/2\.0)/;
const SIP_METHOD_RE = /^(INVITE|ACK|BYE|CANCEL|REGISTER|OPTIONS|INFO|PRACK|UPDATE|REFER|SUBSCRIBE|NOTIFY|MESSAGE|PUBLISH)$/i;

function looksLikeTextSip(head) {
  const lines = String(head || '').split(/\r?\n/).slice(0, 300);
  return lines.some(l => /^\s*CALLFLOW\|/.test(l) || SIP_START_RE.test(l.trim()));
}

function splitAddr(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const i = t.lastIndexOf(':');
  if (i <= 0) return null;
  const ip = t.slice(0, i).replace(/^\[|\]$/g, '');
  const port = Number(t.slice(i + 1));
  if (!ip || !Number.isFinite(port)) return null;
  return { ip, port };
}

function parseTs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?/.exec(String(s || '').trim());
  if (!m) return null;
  const fracUs = m[7] ? Math.round(Number('0.' + m[7]) * 1e6) : 0;
  const ms = Math.floor(fracUs / 1000);
  const base = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms).getTime();
  return base * 1000 + (fracUs % 1000);
}

function parseSipUri(uri) {
  const m = /^sips?:([^@;>\s]+@)?([^;:>\s]+)(?::(\d+))?/i.exec(String(uri || '').trim());
  if (!m) return null;
  return { ip: m[2], port: m[3] ? Number(m[3]) : 5060 };
}

/** 无 CALLFLOW 时从头部推断收发地址 */
function headerEndpoints(text) {
  const via = /^Via:\s*SIP\/2\.0\/[A-Za-z]+\s+([^;\s]+)/mi.exec(text);
  const call = /^([A-Z]+)\s+(sips?:[^\s]+)\s+SIP\/2\.0/m.exec(text);
  const to = /^To:\s*.*?<(sips?:[^>]+)>/mi.exec(text);
  return {
    src: via ? splitAddr(via[1]) : null,
    dst: parseSipUri(call ? call[2] : (to ? to[1] : ''))
  };
}

function parseSipTextLog(text) {
  const lines = String(text).split(/\r?\n/);
  const blocks = [];
  let cur = null, pending = null, lastTs = null, seq = 0;

  const flush = () => {
    if (!cur) return;
    // 部分日志导出会在头部与 SDP 之间丢掉空行：补一个，保证 body 能被识别
    const out = [];
    let inBody = false;
    for (const l of cur.lines) {
      if (!inBody && /^[a-z]=/.test(l)) {
        if (out.length && out[out.length - 1] !== '') out.push('');
        inBody = true;
      }
      out.push(l);
    }
    const body = out.join('\r\n').replace(/[\s\r\n]+$/, '');
    if (SIP_START_RE.test((cur.lines[0] || '').trim())) {
      const hdr = headerEndpoints(body);
      const src = splitAddr(cur.src) || hdr.src || { ip: '0.0.0.0', port: 5060 };
      const dst = splitAddr(cur.dst) || hdr.dst || { ip: '0.0.0.0', port: 5060 };
      blocks.push({ text: body, tsUs: cur.tsUs, srcIp: src.ip, sport: src.port, dstIp: dst.ip, dport: dst.port });
    }
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*CALLFLOW\|/.test(line)) {
      flush();
      const f = line.split('|');
      const ts = parseTs(f[1]);
      if (ts != null) lastTs = ts;
      const meth = String(f[4] || '').trim();
      const isSip = f.length >= 6 && (SIP_START_RE.test(meth) || SIP_METHOD_RE.test(meth) || /^\d{3}\b/.test(meth));
      pending = isSip ? { tsUs: ts ?? lastTs, src: f[3], dst: f[5] } : null;
      continue;
    }
    if (!cur && SIP_START_RE.test(line.trim())) {
      seq++;
      const tsUs = pending?.tsUs ?? (lastTs != null ? lastTs + seq : 1.7e15 + seq);
      cur = { tsUs, src: pending?.src, dst: pending?.dst, lines: [line] };
      pending = null;
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  flush();
  return blocks;
}

async function parseTextLog(filePath) {
  const st = await fs.promises.stat(filePath);
  if (st.size > MAX_TEXT) throw new Error(`文本日志超过 ${Math.round(MAX_TEXT / 1048576)} MiB 上限`);
  const text = await fs.promises.readFile(filePath, 'utf8');
  const blocks = parseSipTextLog(text);
  return { blocks, size: st.size };
}

module.exports = { looksLikeTextSip, parseTextLog, parseSipTextLog, MAX_TEXT };

// M-Ryuga — 通话聚合引擎：将 SIP 消息 + RTP 流聚合成通话（dialog）模型
// 设计参考：Wireshark VoIP Calls / 文档旧版 Call-ID 聚合 + SDP 端点反查 + 方向判定兜底

const { parseRtp } = require('../rtp/parser');
const { RtpStream } = require('../media/assembler');

/**
 * CallAnalyzer：单文件分析上下文。
 * 一次 pass 收集 SIP 消息与 RTP 流，然后聚合为通话。
 */
class CallAnalyzer {
  constructor(fileId) {
    this.fileId = fileId;
    this.calls = new Map();          // callId -> call
    this.sipMsgs = [];               // 全部 SIP 消息（内存压缩存储：仅必要字段）
    this.rtpStreams = new Map();     // flowKey -> RtpStream
    this.sdpEndpoints = [];          // SDP 媒体端点 { callId, ip, port, dir, tsUs }
    this.stats = { totalPkts: 0, sipPkts: 0, rtpPkts: 0, otherPkts: 0, bytes: 0, firstUs: null, lastUs: null };
    this._tcpReasm = new Map();      // TCP SIP 重组： "src>dst" -> { buf, startUs }
  }

  /** 处理一个解码后的包 */
  feed(tsUs, dec, meta) {
    const s = this.stats;
    s.totalPkts++;
    if (s.firstUs === null) s.firstUs = tsUs;
    s.lastUs = tsUs;

    const isUdp = dec.proto === 'UDP';
    const isTcp = dec.proto === 'TCP';

    // SIP 端口启发式 + 内容嗅探
    let sipPayload = null;
    if (isUdp && dec.payload.length > 0) {
      if (looksSipUdp(dec.payload)) sipPayload = dec.payload;
    } else if (isTcp && dec.payload.length > 0) {
      // TCP 重组（简化：按流缓冲，遇 CRLFCRLF 分帧）
      sipPayload = this._tcpFeed(dec, tsUs);
    }

    if (sipPayload) {
      const { parseSip } = require('../sip/parser');
      const msg = parseSip(sipPayload, { srcIp: dec.srcIp, sport: dec.sport, dstIp: dec.dstIp, dport: dec.dport });
      if (msg && msg.isSip) {
        s.sipPkts++;
        this._onSip(tsUs, msg, meta);
        return;
      }
    }

    // RTP 判定：UDP + 长度 >= 12 + version=2，且 (端口范围或已知 SDP 端点)
    if (isUdp && dec.payload.length >= 12) {
      const rtp = parseRtp(dec.payload);
      if (rtp && this._isLikelyRtp(dec, rtp)) {
        s.rtpPkts++;
        this._onRtp(tsUs, dec, rtp, meta);
        return;
      }
    }
    s.otherPkts++;
  }

  _tcpFeed(dec, tsUs) {
    const key = `${dec.srcIp}:${dec.sport}>${dec.dstIp}:${dec.dport}`;
    let st = this._tcpReasm.get(key);
    if (!st || dec.tcpSyn) { st = { buf: Buffer.alloc(0), tsUs, seq: dec.tcpSeq }; this._tcpReasm.set(key, st); }
    st.buf = Buffer.concat([st.buf, dec.payload]);
    // 找 CRLFCRLF 分帧
    const idx = st.buf.indexOf('\r\n\r\n');
    if (idx < 0) {
      if (st.buf.length > 65536) this._tcpReasm.delete(key); // 防爆
      return null;
    }
    const frame = st.buf.slice(0, idx + 4);
    st.buf = st.buf.slice(idx + 4);
    return frame;
  }

  _isLikelyRtp(dec, rtp) {
    // 已知 SDP 端点 → 高置信
    for (const ep of this.sdpEndpoints) {
      if ((dec.sport === ep.port || dec.dport === ep.port) && (dec.srcIp === ep.ip || dec.dstIp === ep.ip)) return true;
    }
    const p = dec.sport;
    // RFC5766 常用范围 + 16384-32768 常见软交换范围
    if ((p >= 16384 && p <= 32768) || (p >= 49152 && p <= 65535) || (p >= 1024 && p <= 5000)) {
      // PT 合理性：静态 pt 0/8/9/18/3 或动态 < 96 的 pt 较少；接受 0-127 但要求 marker/seq 合理
      return true;
    }
    return false;
  }

  _onSip(tsUs, msg, meta) {
    // 残缺报文（无 Call-ID / 无 From-To）无法归属通话，跳过而非让整次分析失败
    if (!msg || !msg.callId || !msg.from || !msg.to) return;
    // 消息瘦身存储
    const rec = {
      tsUs, off: meta.off, file: this.fileId, iface: meta.ifaceId,
      kind: msg.kind, method: msg.method, cseq: msg.cseq, cseqMethod: msg.cseqMethod,
      status: msg.status, reason: msg.reason,
      callId: msg.callId, fromUri: msg.from.uri, fromUser: msg.from.user, fromDisp: msg.from.disp, fromTag: msg.fromTag,
      toUri: msg.to.uri, toUser: msg.to.user, toDisp: msg.to.disp, toTag: msg.toTag,
      src: `${msg.srcIp}:${msg.sport}`, dst: `${msg.dstIp}:${msg.dport}`,
      via: msg.via, branch: msg.branch, contact: msg.contact, ua: msg.userAgent || msg.server,
      contentType: msg.contentType, replaces: msg.replaces, join: msg.join, referTo: msg.referTo,
      referredBy: msg.referredBy, rseq: msg.rseq, reasonPh: msg.reasonPh,
      subject: msg.subject, div: msg.div, pai: msg.pai, rpid: msg.rpid,
      startLine: msg.startLine,
      // 报文详情需要完整头域与正文（限长，避免大数据量占用过多内存）
      hdrs: (msg.hdrs || []).slice(0, 48).map(([k, v]) => [k, String(v).length > 512 ? String(v).slice(0, 512) + '…' : String(v)]),
      body: typeof msg.body === 'string' && msg.body.length ? msg.body.slice(0, 4096) : null
    };
    this.sipMsgs.push(rec);

    // 通话记录
    let call = this.calls.get(msg.callId);
    if (!call) {
      call = {
        callId: msg.callId,
        files: new Set([this.fileId]),
        msgs: [],
        rtpStreams: new Set(),
        sdp: [],
        fromUser: msg.from.user || msg.from.uri,
        toUser: msg.to.user || msg.to.uri,
        fromDisp: msg.from.disp,
        toDisp: msg.to.disp,
        firstUs: tsUs,
        lastUs: tsUs,
        srcIp: msg.srcIp, dstIp: msg.dstIp
      };
      this.calls.set(msg.callId, call);
    }
    call.msgs.push(rec);
    call.lastUs = Math.max(call.lastUs, tsUs);
    if (!call.fromUser && msg.from.user) call.fromUser = msg.from.user;
    if (!call.toUser && msg.to.user) call.toUser = msg.to.user;

    // SDP 端点提取
    if (msg.contentType && msg.contentType.toLowerCase().includes('sdp') && msg.body) {
      const { parseSdp } = require('../sip/parser');
      const sdp = parseSdp(msg.body);
      if (sdp && sdp.connection) {
        const cIp = (sdp.connection.match(/IN IP4 (\S+)/) || [])[1];
        for (const m of sdp.media) {
          if (m.type === 'audio') {
            const ep = { callId: msg.callId, ip: cIp || msg.srcIp, port: m.port, dir: m.direction || 'sendrecv', tsUs, fromTag: msg.fromTag, rtpmaps: m.rtpmaps, ptime: m.ptime, codecs: Object.values(m.rtpmaps).map(r => r.name).concat(m.formats.split(' ')) };
            this.sdpEndpoints.push(ep);
            call.sdp.push(ep);
          }
        }
      }
    }
  }

  _onRtp(tsUs, dec, rtp, meta) {
    const key = `${dec.srcIp}:${dec.sport}>${dec.dstIp}:${dec.dport}`;
    let stream = this.rtpStreams.get(key);
    if (!stream) {
      stream = new RtpStream(key, null);
      stream.srcIp = dec.srcIp; stream.sport = dec.sport;
      stream.dstIp = dec.dstIp; stream.dport = dec.dport;
      stream.firstUs = tsUs;
      this.rtpStreams.set(key, stream);
    }
    // 该方向上最近的 SDP 归属：根据 5 元组与 SDP 端点匹配 callId
    const ep = this._matchEndpoint(dec);
    if (ep) stream.callId = ep.callId;
    stream.lastUs = tsUs;
    stream.addRtp(tsUs, rtp, ep ? ep.rtpmaps : null);
    if (ep) this.calls.get(ep.callId)?.rtpStreams.add(key);
  }

  _matchEndpoint(dec) {
    // 精确端口匹配优先
    for (const ep of this.sdpEndpoints) {
      if (ep.port === dec.dport && ep.ip === dec.dstIp) return ep;
      if (ep.port === dec.sport && ep.ip === dec.srcIp) return ep;
    }
    return null;
  }

  /** 聚合收尾：把 RTP 流按 callId 归属并双向配对 */
  finalize() {
    // 未匹配到 SDP 的 RTP 流：按时间窗口就近归属
    for (const [key, stream] of this.rtpStreams) {
      if (!stream.callId) {
        // 找 firstTsUs 前后 5s 内有 SDP/信令活动的通话
        let best = null, bestDist = Infinity;
        for (const call of this.calls.values()) {
          for (const ep of call.sdp) {
            const d = Math.abs(ep.tsUs - stream.firstUs);
            if (d < bestDist && d < 30e6) { bestDist = d; best = call; }
          }
        }
        if (best) { stream.callId = best.callId; best.rtpStreams.add(key); }
      }
    }
    // 为每路流确定方向（基于通话内 SDP 的 fromTag）
    for (const call of this.calls.values()) {
      const ep0 = call.sdp[0]; // 第一个 offer（通常主叫→被叫）
      for (const key of call.rtpStreams) {
        const st = this.rtpStreams.get(key);
        if (!st) continue;
        if (ep0) {
          // offer 来自 from 侧：其 SDP 描述对方(本端)收流端口 → A2B = B→A 网络方向
          st.dir = this._guessDir(call, st, ep0);
        } else {
          st.dir = null;
        }
      }
      call.rtpStreams = [...call.rtpStreams].map(k => this.rtpStreams.get(k).finalize()).filter(Boolean);
    }
    return [...this.calls.values()];
  }

  _guessDir(call, stream, ep0) {
    // ep0 是主叫侧 offer：SDP 声明的是主叫的接收地址
    // 发往 (ep0.ip, ep0.port) = 被叫→主叫（B2A）；其余（源自主叫端点）= 主叫→被叫（A2B）
    if (stream.dstIp === ep0.ip && stream.dport === ep0.port) return 'B2A';
    return 'A2B';
  }
}

function looksSipUdp(payload) {
  if (payload.length < 16) return false;
  const head = payload.slice(0, 64).toString('latin1');
  if (/^SIP\/2\.0 \d{3}/.test(head)) return true;
  const m = head.match(/^([A-Z]+) \S+ SIP\/2\.0\r?\n/);
  if (m) {
    const KNOWN = ['INVITE', 'ACK', 'BYE', 'CANCEL', 'REGISTER', 'OPTIONS', 'INFO', 'PRACK', 'UPDATE', 'REFER', 'SUBSCRIBE', 'NOTIFY', 'MESSAGE', 'PUBLISH'];
    return KNOWN.includes(m[1]);
  }
  return false;
}

module.exports = { CallAnalyzer, looksSipUdp };

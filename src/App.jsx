// "am_toolbox_v5.jsx"
import { useState, useEffect, useRef, useMemo, useCallback } from "react";

const TWO_PI = 2 * Math.PI;
const SAMPLES = 2400;

// ── Signal generators ──
function generateSignalSample(type, phase, dutyCycle = 0.5) {
  const norm = ((phase % TWO_PI) + TWO_PI) % TWO_PI; // 0..2π
  switch (type) {
    case "sine":     return Math.sin(phase);
    case "square":   return norm < TWO_PI * dutyCycle ? 1 : -1;
    case "triangle": return norm < Math.PI ? -1 + (2 / Math.PI) * norm : 3 - (2 / Math.PI) * norm;
    case "sawtooth": return -1 + norm / Math.PI;
    case "pulse":    return norm < TWO_PI * 0.2 ? 1 : -1;
    default:         return Math.sin(phase);
  }
}

function generateNoise(length, snrDb) {
  if (snrDb >= 40) return new Array(length).fill(0);
  const noiseAmp = Math.pow(10, -snrDb / 20);
  return Array.from({ length }, () => (Math.random() * 2 - 1) * noiseAmp);
}

function buildSignals(p, timeOffset = 0) {
  const { mode, sigType, tone, Am1, Am2, Ac, fm1, fm2, fc, mu1, mu2, phi1, phi2, cycles, dutyCycle, snrDb, noiseOn } = p;
  const T = cycles / fm1;
  const t = Array.from({ length: SAMPLES }, (_, i) => timeOffset + (i / (SAMPLES - 1)) * T);
  const rad1 = phi1 * Math.PI / 180;
  const rad2 = phi2 * Math.PI / 180;

  const msg = t.map(ti =>
    Am1 * generateSignalSample(sigType, TWO_PI * fm1 * ti + rad1, dutyCycle) +
    (tone === "double" ? Am2 * generateSignalSample(sigType, TWO_PI * fm2 * ti + rad2, dutyCycle) : 0)
  );
  const carrier = t.map(ti => Ac * Math.cos(TWO_PI * fc * ti));

  let modulated, envelope;
  if (mode === "dsbfc") {
    // For non-sine, use the signal directly as the modulating wave
    const env1 = t.map(ti =>
      tone === "single"
        ? Ac * (1 + mu1 * generateSignalSample(sigType, TWO_PI * fm1 * ti + rad1, dutyCycle))
        : Ac * (1 + mu1 * generateSignalSample(sigType, TWO_PI * fm1 * ti + rad1, dutyCycle)
               + mu2 * generateSignalSample(sigType, TWO_PI * fm2 * ti + rad2, dutyCycle))
    );
    envelope = env1;
    modulated = envelope.map((env, i) => env * Math.cos(TWO_PI * fc * t[i]));
  } else if (mode === "dsbsc") {
    modulated = msg.map((m, i) => m * Math.cos(TWO_PI * fc * t[i]));
    envelope = msg.map(v => Math.abs(v));
  } else if (mode === "ssb") {
    modulated = t.map((ti, i) => {
      const ip = msg[i] * Math.cos(TWO_PI * fc * ti);
      const qp = Am1 * generateSignalSample(sigType, TWO_PI * fm1 * ti + rad1 + Math.PI / 2, dutyCycle) * Math.sin(TWO_PI * fc * ti);
      return (ip - qp) / 2;
    });
    envelope = modulated.map(v => Math.abs(v));
  } else {
    modulated = t.map((ti, i) => {
      const usb = (Am1 / 2) * Math.cos(TWO_PI * (fc + fm1) * ti + rad1);
      const vsb = (Am1 / 8) * Math.cos(TWO_PI * (fc - fm1) * ti - rad1);
      return usb + vsb;
    });
    envelope = modulated.map(v => Math.abs(v));
  }

  const demodulated = envelope.map(v => (mode === "dsbfc" ? v - Ac : v));

  // Add noise if enabled
  if (noiseOn) {
    const noise = generateNoise(SAMPLES, snrDb);
    return {
      t, msg, carrier,
      modulated: modulated.map((v, i) => v + noise[i] * Ac * 0.5),
      envelope, demodulated
    };
  }
  return { t, msg, carrier, modulated, envelope, demodulated };
}

function buildSpectrum(p) {
  const { mode, tone, Am1, Am2, Ac, fm1, fm2, fc, mu1, mu2 } = p;
  const lines = [];
  if (mode === "dsbfc") {
    lines.push({ f: fc, amp: Ac / 2, label: "Carrier", color: "#00ffcc" });
    lines.push({ f: fc + fm1, amp: (mu1 * Ac) / 4, label: tone === "double" ? "USB₁" : "USB", color: "#ff6b6b" });
    lines.push({ f: fc - fm1, amp: (mu1 * Ac) / 4, label: tone === "double" ? "LSB₁" : "LSB", color: "#6bf5ff" });
    if (tone === "double") {
      lines.push({ f: fc + fm2, amp: (mu2 * Ac) / 4, label: "USB₂", color: "#ffcc44" });
      lines.push({ f: fc - fm2, amp: (mu2 * Ac) / 4, label: "LSB₂", color: "#b86bff" });
    }
  } else if (mode === "dsbsc") {
    lines.push({ f: fc + fm1, amp: Am1 / 4, label: tone === "double" ? "USB₁" : "USB", color: "#ff6b6b" });
    lines.push({ f: fc - fm1, amp: Am1 / 4, label: tone === "double" ? "LSB₁" : "LSB", color: "#6bf5ff" });
    if (tone === "double") {
      lines.push({ f: fc + fm2, amp: Am2 / 4, label: "USB₂", color: "#ffcc44" });
      lines.push({ f: fc - fm2, amp: Am2 / 4, label: "LSB₂", color: "#b86bff" });
    }
  } else if (mode === "ssb") {
    lines.push({ f: fc + fm1, amp: Am1 / 4, label: "USB", color: "#ff6b6b" });
  } else {
    lines.push({ f: fc + fm1, amp: Am1 / 2, label: "USB", color: "#ff6b6b" });
    lines.push({ f: fc - fm1, amp: Am1 / 8, label: "Vestige", color: "#6bf5ff" });
  }
  return lines;
}

function buildMetrics(p) {
  const { mode, tone, Am1, Am2, Ac, fm1, fm2, mu1, mu2 } = p;
  let Pt, Pc, eff, bw, muTot;
  if (mode === "dsbfc") {
    Pc = (Ac * Ac) / 2;
    muTot = tone === "single" ? mu1 : Math.sqrt(mu1 * mu1 + mu2 * mu2);
    const Psb = (muTot * muTot * Pc) / 2;
    Pt = Pc + Psb;
    eff = (Psb / Pt) * 100;
    bw = tone === "single" ? 2 * fm1 : 2 * Math.max(fm1, fm2);
  } else if (mode === "dsbsc") {
    Pc = 0; muTot = null;
    const As = tone === "single" ? Am1 : Math.sqrt(Am1 * Am1 + Am2 * Am2);
    Pt = (As * As) / 4; eff = 100;
    bw = tone === "single" ? 2 * fm1 : 2 * Math.max(fm1, fm2);
  } else if (mode === "ssb") {
    Pc = 0; muTot = null;
    Pt = (Am1 * Am1) / 8; eff = 100; bw = fm1;
  } else {
    Pc = 0; muTot = null;
    Pt = ((Am1 / 2) ** 2 + (Am1 / 8) ** 2) / 2;
    eff = 100; bw = fm1 * 1.25;
  }
  return {
    Pt: Pt.toFixed(4), Pc: Pc.toFixed(4),
    eff: eff.toFixed(2),
    bw: (bw / 1000).toFixed(2) + " kHz",
    muTot: muTot !== null ? muTot.toFixed(3) : "—",
    overmod: muTot !== null && muTot > 1
  };
}

// ── Animated Waveform Group with Zoom ──
function AnimatedWaves({ params, speed, showEnv, waveConfigs, zoomLevel, panOffset }) {
  const timeRef = useRef(0);
  const rafRef = useRef(null);
  const canvasRefs = useRef([]);
  const paramsRef = useRef(params);
  const speedRef = useRef(speed);
  const zoomRef = useRef(zoomLevel);
  const panRef = useRef(panOffset);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { zoomRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { panRef.current = panOffset; }, [panOffset]);

  const stablePeaks = useMemo(() => {
    const s = buildSignals(params, 0);
    return {
      msg: Math.max(...s.msg.map(Math.abs), 0.001),
      carrier: Math.max(...s.carrier.map(Math.abs), 0.001),
      modulated: Math.max(...s.modulated.map(Math.abs), 0.001),
      envelope: Math.max(...s.envelope.map(Math.abs), 0.001),
      demodulated: Math.max(...s.demodulated.map(Math.abs), 0.001),
    };
  }, [params.mode, params.tone, params.Am1, params.Am2, params.Ac, params.fm1, params.fm2,
      params.fc, params.mu1, params.mu2, params.phi1, params.phi2, params.sigType,
      params.dutyCycle, params.noiseOn, params.snrDb]);

  useEffect(() => {
    const drawAll = () => {
      const s = buildSignals(paramsRef.current, timeRef.current);
      const sp = speedRef.current;
      const zoom = zoomRef.current;
      const pan = panRef.current;

      canvasRefs.current.forEach((canvas, idx) => {
        if (!canvas) return;
        const cfg = waveConfigs[idx];
        const ctx = canvas.getContext("2d");
        const W = canvas.width, H = canvas.height;

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = "#030d0d";
        ctx.fillRect(0, 0, W, H);

        // Grid
        ctx.strokeStyle = "#0b2222"; ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) { const y = (i / 4) * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        const gridCols = Math.max(8, Math.round(8 * zoom));
        for (let i = 1; i < gridCols; i++) { const x = (i / gridCols) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }

        ctx.strokeStyle = "#1a4040"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

        const data = s[cfg.key];
        const peak = stablePeaks[cfg.key] || Math.max(...data.map(Math.abs), 0.001);

        ctx.fillStyle = "#2a5555"; ctx.font = "9px monospace"; ctx.textAlign = "right";
        ctx.fillText("+" + peak.toFixed(2), W - 4, 10);
        ctx.fillText("-" + peak.toFixed(2), W - 4, H - 3);
        ctx.textAlign = "left";

        // Zoom: show a windowed slice of the data
        const totalSamples = data.length;
        const visibleFraction = 1 / zoom;
        const startFrac = Math.max(0, Math.min(pan, 1 - visibleFraction));
        const startIdx = Math.floor(startFrac * totalSamples);
        const endIdx = Math.min(totalSamples - 1, Math.floor(startIdx + visibleFraction * totalSamples));
        const visData = data.slice(startIdx, endIdx + 1);

        const toX = i => (i / (visData.length - 1)) * W;
        const toY = v => H / 2 - (v / peak) * (H / 2 - 8);

        // Zoom level indicator
        if (zoom > 1) {
          ctx.fillStyle = "rgba(0,255,204,0.07)";
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = "#00ffcc33";
          ctx.font = "9px monospace";
          ctx.textAlign = "right";
          ctx.fillText(`${zoom.toFixed(1)}×`, W - 4, H - 12);
          ctx.textAlign = "left";
        }

        // Envelope
        if (cfg.showEnv && s.envelope) {
          const visEnv = s.envelope.slice(startIdx, endIdx + 1);
          ctx.strokeStyle = "rgba(255,200,40,0.5)"; ctx.lineWidth = 1.2;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          visEnv.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
          ctx.stroke();
          ctx.beginPath();
          visEnv.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(-Math.abs(v))) : ctx.lineTo(toX(i), toY(-Math.abs(v))));
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Signal line
        ctx.strokeStyle = cfg.color; ctx.lineWidth = zoom > 2 ? 2.2 : 1.8;
        ctx.shadowColor = cfg.color; ctx.shadowBlur = 5;
        ctx.beginPath();
        visData.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Label
        const lw = ctx.measureText(cfg.label).width + 14;
        ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(6, 4, lw, 20);
        ctx.fillStyle = cfg.color; ctx.font = "bold 11px 'Courier New', monospace";
        ctx.fillText(cfg.label, 10, 18);

        // LIVE badge
        if (sp > 0) {
          ctx.fillStyle = "rgba(0,255,100,0.15)"; ctx.fillRect(W - 44, 4, 38, 18);
          ctx.fillStyle = "#00ff88"; ctx.font = "bold 9px monospace"; ctx.textAlign = "right";
          ctx.fillText("● LIVE", W - 6, 16); ctx.textAlign = "left";
        }
      });

      if (sp > 0) timeRef.current += sp * 0.00003;
      rafRef.current = requestAnimationFrame(drawAll);
    };

    rafRef.current = requestAnimationFrame(drawAll);
    return () => cancelAnimationFrame(rafRef.current);
  }, [waveConfigs, stablePeaks]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {waveConfigs.map((cfg, idx) => (
        <canvas key={cfg.key + cfg.label}
          ref={el => canvasRefs.current[idx] = el}
          width={1400} height={cfg.height || 110}
          style={{ width: "100%", height: cfg.height || 110, display: "block", borderRadius: 4, border: "1px solid #0d2828" }}
        />
      ))}
    </div>
  );
}

// ── Spectrum Canvas ──
function SpecCanvas({ lines }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !lines.length) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#030d0d"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#0b2222"; ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) { const y = (i / 5) * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const freqs = lines.map(l => l.f);
    const maxA = Math.max(...lines.map(l => l.amp), 0.001);
    const fMin = Math.min(...freqs), fMax = Math.max(...freqs);
    const pad = (fMax - fMin) * 0.4 || 2500;
    const fLo = fMin - pad, fHi = fMax + pad;
    const toX = f => 28 + ((f - fLo) / (fHi - fLo)) * (W - 56);
    const toY = a => H - 32 - (a / maxA) * (H - 64);
    ctx.strokeStyle = "#1a4040"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H - 32); ctx.lineTo(W, H - 32); ctx.stroke();
    ctx.fillStyle = "#2a5555"; ctx.font = "10px monospace"; ctx.textAlign = "center";
    for (let i = 0; i <= 8; i++) {
      const f = fLo + i * (fHi - fLo) / 8;
      ctx.fillText((f / 1000).toFixed(1) + "k", toX(f), H - 10);
    }
    lines.forEach(line => {
      const x = toX(line.f), y = toY(line.amp);
      ctx.strokeStyle = line.color; ctx.lineWidth = 3;
      ctx.shadowColor = line.color; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(x, H - 32); ctx.lineTo(x, y); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = line.color;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, TWO_PI); ctx.fill();
      ctx.font = "bold 11px 'Courier New', monospace"; ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(x - 24, y - 26, 48, 17);
      ctx.fillStyle = line.color; ctx.fillText(line.label, x, y - 13);
      ctx.fillStyle = "#3a8080"; ctx.font = "9px monospace";
      ctx.fillText("A=" + line.amp.toFixed(3), x, y + 14);
    });
    ctx.textAlign = "left";
  }, [lines]);
  return <canvas ref={ref} width={1400} height={220}
    style={{ width: "100%", height: 220, display: "block", borderRadius: 4, border: "1px solid #0d2828" }} />;
}

// ── Phasor Canvas ──
function PhasorCanvas({ mu, mode }) {
  const ref = useRef(null);
  const raf = useRef(null);
  const angle = useRef(0);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 20;
    const draw = () => {
      angle.current += 0.022;
      const a = angle.current;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#030d0d"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#0d2828"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TWO_PI); ctx.stroke();
      ctx.strokeStyle = "#163030";
      ctx.beginPath(); ctx.moveTo(cx - R - 4, cy); ctx.lineTo(cx + R + 4, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - R - 4); ctx.lineTo(cx, cy + R + 4); ctx.stroke();
      const cLen = R * 0.68;
      const ex = cx + cLen * Math.cos(a);
      const ey = cy - cLen * Math.sin(a);
      ctx.strokeStyle = "#00ffcc"; ctx.lineWidth = 2.5;
      ctx.shadowColor = "#00ffcc"; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = "#00ffcc"; ctx.beginPath(); ctx.arc(ex, ey, 4, 0, TWO_PI); ctx.fill();
      ctx.shadowBlur = 0;
      if (mode === "dsbfc" || mode === "dsbsc") {
        const sbLen = R * 0.3 * Math.min(Math.max(mu, 0.1), 1.5);
        const usbX = ex + sbLen * Math.cos(2 * a), usbY = ey - sbLen * Math.sin(2 * a);
        const lsbX = ex + sbLen, lsbY = ey;
        ctx.strokeStyle = "#ff6b6b"; ctx.lineWidth = 2; ctx.shadowColor = "#ff6b6b"; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(usbX, usbY); ctx.stroke();
        ctx.fillStyle = "#ff6b6b"; ctx.beginPath(); ctx.arc(usbX, usbY, 3, 0, TWO_PI); ctx.fill();
        ctx.strokeStyle = "#6bf5ff"; ctx.shadowColor = "#6bf5ff";
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(lsbX, lsbY); ctx.stroke();
        ctx.fillStyle = "#6bf5ff"; ctx.beginPath(); ctx.arc(lsbX, lsbY, 3, 0, TWO_PI); ctx.fill();
        ctx.shadowBlur = 0;
      }
      const legend = [["#00ffcc", "Carrier"], ...(mode === "dsbfc" || mode === "dsbsc" ? [["#ff6b6b", "USB"], ["#6bf5ff", "LSB"]] : []), ...(mode === "ssb" ? [["#ff6b6b", "USB only"]] : [])];
      legend.forEach(([col, lbl], i) => { ctx.fillStyle = col; ctx.font = "bold 10px monospace"; ctx.fillText("● " + lbl, 6, 14 + i * 13); });
      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [mu, mode]);
  return <canvas ref={ref} width={260} height={260}
    style={{ width: 260, height: 260, flexShrink: 0, borderRadius: 4, border: "1px solid #0d2828" }} />;
}

// ── Demod Theory ──
function DemodTheory({ mode }) {
  const info = {
    dsbfc: { title: "DSB-FC  —  Envelope Detection", color: "#00ffcc", steps: ["Rectify the signal (half or full-wave)", "RC low-pass filter to smooth the rectified output", "DC block (capacitor) to remove the Ac offset", "Output ≈ Ac · μ · m(t)  ✓ No phase reference needed"] },
    dsbsc: { title: "DSB-SC  —  Synchronous (Coherent) Detection", color: "#6bf5ff", steps: ["Multiply received signal by local carrier cos(2πfc·t)", "Low-pass filter removes the 2fc term", "Output = m(t)/2  — requires phase-locked local oscillator", "⚠  Envelope detection FAILS — phase ambiguity problem"] },
    ssb: { title: "SSB-USB  —  Coherent Detection", color: "#ff6b6b", steps: ["Multiply by cos(2πfc·t) using a phase-locked oscillator", "Low-pass filter extracts the baseband", "Very sensitive to frequency offset errors", "Half-power output compared to original (Am/4 vs Am)"] },
    vsb: { title: "VSB  —  Coherent + VSB Equaliser Filter", color: "#ffcc44", steps: ["Coherent demodulation same as SSB", "Vestigial filter corrects amplitude at baseband edges", "Used in broadcast TV (NTSC/PAL), digital TV (ATSC)", "Good balance: SSB bandwidth efficiency + DSB robustness"] },
  };
  const d = info[mode];
  return (
    <div style={{ background: "#040e0e", border: `1px solid ${d.color}35`, borderRadius: 6, padding: 14, marginTop: 10 }}>
      <div style={{ color: d.color, fontSize: 12, fontWeight: "bold", marginBottom: 10, letterSpacing: 1 }}>{d.title}</div>
      {d.steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 10, marginBottom: 7, fontSize: 11, color: "#6aadad", lineHeight: 1.5 }}>
          <span style={{ color: d.color, flexShrink: 0, fontWeight: "bold" }}>Step {i + 1}.</span>
          <span>{s}</span>
        </div>
      ))}
    </div>
  );
}

// ── Signal Shape Preview ──
function SignalPreview({ type, color, dutyCycle = 0.5 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#020b0b"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#0b2020"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.shadowColor = color; ctx.shadowBlur = 4;
    ctx.beginPath();
    const pts = 200;
    for (let i = 0; i < pts; i++) {
      const phase = (i / pts) * TWO_PI * 2;
      const v = generateSignalSample(type, phase, dutyCycle);
      const x = (i / pts) * W;
      const y = H / 2 - v * (H / 2 - 3);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
  }, [type, color, dutyCycle]);
  return <canvas ref={ref} width={120} height={36}
    style={{ width: 120, height: 36, borderRadius: 3, border: "1px solid #0c2222", display: "block" }} />;
}

// ── UI Helpers ──
function Slider({ label, val, min, max, step, unit, onChange, color = "#00ffcc" }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ color: "#4a9090", fontSize: 10, fontFamily: "monospace" }}>{label}</span>
        <span style={{ color, fontSize: 11, fontFamily: "monospace", fontWeight: "bold" }}>
          {typeof val === "number" ? (val < 10 ? val.toFixed(2) : Math.round(val)) : val}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={val}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: color, cursor: "pointer", height: 4 }} />
    </div>
  );
}

function MCard({ label, val, color = "#00ffcc", sub }) {
  return (
    <div style={{ flex: "1 1 100px", background: "#040e0e", borderRadius: 6, border: `1px solid ${color}30`, padding: "9px 12px" }}>
      <div style={{ color: "#2a6868", fontSize: 10, fontFamily: "monospace", marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontSize: 14, fontFamily: "monospace", fontWeight: "bold" }}>{val}</div>
      {sub && <div style={{ color: "#2a6060", fontSize: 9, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const btnStyle = (active, color = "#00ffcc") => ({
  padding: "5px 13px", cursor: "pointer", fontSize: 10,
  fontFamily: "monospace", fontWeight: "bold",
  background: active ? `${color}20` : "transparent",
  color: active ? color : "#2a6868",
  border: `1px solid ${active ? color + "66" : "#0d2828"}`,
  borderRadius: 4, transition: "all 0.15s", letterSpacing: 0.5,
});

const SIG_TYPES = [
  { id: "sine",     label: "Sine",     color: "#00ffcc" },
  { id: "square",   label: "Square",   color: "#ff6b6b" },
  { id: "triangle", label: "Triangle", color: "#ffcc44" },
  { id: "sawtooth", label: "Sawtooth", color: "#b86bff" },
  { id: "pulse",    label: "Pulse",    color: "#6bf5ff" },
];

// ── MAIN APP ──
export default function AMToolbox() {
  const [mode, setMode] = useState("dsbfc");
  const [tone, setTone] = useState("single");
  const [tab, setTab] = useState("time");
  const [showEnv, setShowEnv] = useState(true);
  const [cycles, setCycles] = useState(4);
  const [animSpeed, setAnimSpeed] = useState(1);
  const [sigType, setSigType] = useState("sine");
  const [dutyCycle, setDutyCycle] = useState(0.5);

  // Zoom & pan
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState(0);

  // Noise
  const [noiseOn, setNoiseOn] = useState(false);
  const [snrDb, setSnrDb] = useState(20);

  // Signal params
  const [Am1, setAm1] = useState(1.0);
  const [Am2, setAm2] = useState(0.5);
  const [Ac, setAc] = useState(2.0);
  const [fm1, setFm1] = useState(1000);
  const [fm2, setFm2] = useState(1500);
  const [fc, setFc] = useState(10000);
  const [mu1, setMu1] = useState(0.5);
  const [mu2, setMu2] = useState(0.3);
  const [phi1, setPhi1] = useState(0);
  const [phi2, setPhi2] = useState(0);

  const params = { mode, sigType, tone, Am1, Am2, Ac, fm1, fm2, fc, mu1, mu2, phi1, phi2, cycles, dutyCycle, snrDb, noiseOn };
  const specLines = useMemo(() => buildSpectrum(params), [mode, tone, Am1, Am2, Ac, fm1, fm2, fc, mu1, mu2]);
  const metrics = useMemo(() => buildMetrics(params), [mode, tone, Am1, Am2, Ac, fm1, fm2, mu1, mu2]);
  const muDisp = mode === "dsbfc" ? (tone === "single" ? mu1 : Math.sqrt(mu1 ** 2 + mu2 ** 2)) : 0;

  const sigColor = SIG_TYPES.find(s => s.id === sigType)?.color || "#00ffcc";

  // Zoom handlers
  const handleZoomIn = useCallback(() => setZoomLevel(z => Math.min(z * 2, 32)), []);
  const handleZoomOut = useCallback(() => {
    setZoomLevel(z => {
      const nz = Math.max(z / 2, 1);
      if (nz === 1) setPanOffset(0);
      return nz;
    });
  }, []);
  const handleZoomReset = useCallback(() => { setZoomLevel(1); setPanOffset(0); }, []);
  const handlePanLeft = useCallback(() => {
    setPanOffset(p => Math.max(0, p - 0.1 / zoomLevel));
  }, [zoomLevel]);
  const handlePanRight = useCallback(() => {
    setPanOffset(p => Math.min(1 - 1 / zoomLevel, p + 0.1 / zoomLevel));
  }, [zoomLevel]);

  // Wheel zoom on canvas container
  const zoomContainerRef = useRef(null);
  useEffect(() => {
    const el = zoomContainerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      if (e.deltaY < 0) setZoomLevel(z => Math.min(z * 1.3, 32));
      else setZoomLevel(z => { const nz = Math.max(z / 1.3, 1); if (nz <= 1) setPanOffset(0); return nz; });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const timeWaves = useMemo(() => [
    { key: "msg",       label: `m(t)  —  Message  [${SIG_TYPES.find(s=>s.id===sigType)?.label}]`, color: sigColor, height: 110 },
    { key: "carrier",   label: "c(t)  —  Carrier Wave",                                            color: "#3ab0b0", height: 90 },
    { key: "modulated", label: "s(t)  —  Modulated Signal",                                        color: "#00ffcc", height: 140, showEnv },
  ], [showEnv, sigType, sigColor]);

  const demodWaves = useMemo(() => [
    { key: "modulated",   label: "s(t)  —  Received (Modulated Input)",  color: "#00ffcc", height: 120, showEnv },
    { key: "envelope",    label: "env(t) — Detected Envelope",            color: "#ffcc44", height: 95 },
    { key: "demodulated", label: "m′(t) — Recovered Message",             color: sigColor,  height: 110 },
    { key: "msg",         label: "m(t)  — Original Reference",            color: sigColor + "55", height: 95 },
  ], [showEnv, sigColor]);

  return (
    <div style={{ minHeight: "100vh", width: "100%", background: "#010c0c", color: "#c0dada", fontFamily: "'Courier New', monospace", padding: "10px 16px", boxSizing: "border-box" }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #0c2828", display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: "#00ffcc", letterSpacing: 4, textShadow: "0 0 20px #00ffcc66" }}>◈ AM SIGNAL TOOLBOX</h1>
          <span style={{ color: "#1a5858", fontSize: 11 }}>EC401 · Analog Communication · MAKAUT</span>
        </div>
        <span style={{ color: "#1a5858", fontSize: 10 }}>v5.0 — Signal Shapes + Zoom + Noise</span>
      </div>

      <div style={{ display: "flex", gap: 12, width: "100%", boxSizing: "border-box" }}>

        {/* ── LEFT SIDEBAR ── */}
        <div style={{ width: 230, flexShrink: 0, background: "#040f0f", borderRadius: 8, border: "1px solid #0a2424", padding: 11, overflowY: "auto", maxHeight: "calc(100vh - 72px)", boxSizing: "border-box" }}>

          {/* Mode */}
          <div style={{ marginBottom: 11 }}>
            <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, marginBottom: 5, fontWeight: "bold" }}>MODULATION MODE</div>
            {[["dsbfc","DSB-FC  (full carrier)"],["dsbsc","DSB-SC  (suppressed)"],["ssb","SSB-USB  (single side)"],["vsb","VSB  (vestigial)"]].map(([v, l]) => (
              <button key={v} onClick={() => setMode(v)}
                style={{ ...btnStyle(mode === v), display: "block", width: "100%", marginBottom: 3, textAlign: "left" }}>{l}</button>
            ))}
          </div>

          {/* Tone */}
          <div style={{ marginBottom: 11 }}>
            <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, marginBottom: 5, fontWeight: "bold" }}>TONE TYPE</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[["single","Single"],["double","Double"]].map(([v, l]) => (
                <button key={v} onClick={() => setTone(v)} style={{ ...btnStyle(tone === v), flex: 1, textAlign: "center", fontSize: 10 }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Animation */}
          <div style={{ marginBottom: 11, background: "#020a0a", border: "1px solid #0c3030", borderRadius: 5, padding: "8px 9px 5px" }}>
            <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, marginBottom: 5, fontWeight: "bold" }}>ANIMATION</div>
            <Slider label="Scroll Speed" val={animSpeed} min={0} max={10} step={0.5} unit="×"
              onChange={setAnimSpeed} color={animSpeed === 0 ? "#ffcc44" : "#00ff88"} />
            <div style={{ fontSize: 9, color: animSpeed === 0 ? "#ffcc44" : "#00ff88", marginTop: -3, marginBottom: 3 }}>
              {animSpeed === 0 ? "⏸ FROZEN" : `▶ LIVE ${animSpeed}×`}
            </div>
          </div>

          {/* Carrier */}
          <div style={{ borderTop: "1px solid #0a2424", paddingTop: 9, marginBottom: 5 }}>
            <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, marginBottom: 5, fontWeight: "bold" }}>CARRIER</div>
            <Slider label="Ac — Amplitude" val={Ac} min={0.5} max={5} step={0.1} unit=" V" onChange={setAc} />
            <Slider label="fc — Frequency"  val={fc} min={2000} max={50000} step={500} unit=" Hz" onChange={setFc} color="#6bf5ff" />
          </div>

          {/* Message 1 */}
          <div style={{ borderTop: "1px solid #0a2424", paddingTop: 9, marginBottom: 5 }}>
            <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, marginBottom: 5, fontWeight: "bold" }}>MESSAGE 1</div>
            <Slider label="Am₁ — Amplitude" val={Am1} min={0.1} max={5} step={0.1} unit=" V" onChange={setAm1} color="#ff6b6b" />
            <Slider label="fm₁ — Frequency"  val={fm1} min={100} max={5000} step={50} unit=" Hz" onChange={setFm1} color="#ff6b6b" />
            {mode === "dsbfc" && <Slider label="μ₁ — Mod. Index" val={mu1} min={0.01} max={2} step={0.01} unit="" onChange={setMu1} color="#ff6b6b" />}
            <Slider label="φ₁ — Phase" val={phi1} min={-180} max={180} step={5} unit="°" onChange={setPhi1} color="#ff6b6b" />
          </div>

          {/* Message 2 */}
          {tone === "double" && (
            <div style={{ borderTop: "1px solid #0a2424", paddingTop: 9, marginBottom: 5 }}>
              <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, marginBottom: 5, fontWeight: "bold" }}>MESSAGE 2</div>
              <Slider label="Am₂ — Amplitude" val={Am2} min={0.1} max={5} step={0.1} unit=" V" onChange={setAm2} color="#ffcc44" />
              <Slider label="fm₂ — Frequency"  val={fm2} min={100} max={5000} step={50} unit=" Hz" onChange={setFm2} color="#ffcc44" />
              {mode === "dsbfc" && <Slider label="μ₂ — Mod. Index" val={mu2} min={0.01} max={2} step={0.01} unit="" onChange={setMu2} color="#ffcc44" />}
              <Slider label="φ₂ — Phase" val={phi2} min={-180} max={180} step={5} unit="°" onChange={setPhi2} color="#ffcc44" />
            </div>
          )}

          {/* Display */}
          <div style={{ borderTop: "1px solid #0a2424", paddingTop: 9 }}>
            <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, marginBottom: 5, fontWeight: "bold" }}>DISPLAY</div>
            <Slider label="Cycles Shown" val={cycles} min={1} max={10} step={1} unit="" onChange={setCycles} color="#b86bff" />
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginTop: 5 }}>
              <input type="checkbox" checked={showEnv} onChange={e => setShowEnv(e.target.checked)} style={{ accentColor: "#ffcc44" }} />
              <span style={{ color: "#4a9090", fontSize: 10 }}>Show envelope trace</span>
            </label>
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0 }}>

          {/* ── TOP BAR: Signal Type + Noise ── */}
          <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "stretch" }}>

            {/* Signal Shape Panel */}
            <div style={{ background: "#040f0f", border: "1px solid #0a2828", borderRadius: 7, padding: "10px 14px", flex: "2 1 320px" }}>
              <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, marginBottom: 7, fontWeight: "bold" }}>MESSAGE SIGNAL SHAPE</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {SIG_TYPES.map(({ id, label, color }) => (
                  <div key={id} onClick={() => setSigType(id)} style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                    background: sigType === id ? `${color}15` : "transparent",
                    border: `1px solid ${sigType === id ? color + "66" : "#0d2828"}`,
                    borderRadius: 5, padding: "6px 8px", transition: "all 0.15s" }}>
                    <SignalPreview type={id} color={color} dutyCycle={dutyCycle} />
                    <span style={{ color: sigType === id ? color : "#2a6868", fontSize: 10, fontWeight: "bold", fontFamily: "monospace" }}>{label}</span>
                  </div>
                ))}
              </div>
              {sigType === "pulse" && (
                <div style={{ marginTop: 8 }}>
                  <Slider label="Duty Cycle" val={dutyCycle} min={0.05} max={0.95} step={0.05} unit="" onChange={setDutyCycle} color="#6bf5ff" />
                </div>
              )}
            </div>

            {/* Noise Panel */}
            <div style={{ background: "#040f0f", border: `1px solid ${noiseOn ? "#ff6b6b44" : "#0a2828"}`, borderRadius: 7, padding: "10px 14px", flex: "1 1 200px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, fontWeight: "bold" }}>AWGN NOISE</div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={noiseOn} onChange={e => setNoiseOn(e.target.checked)} style={{ accentColor: "#ff6b6b" }} />
                  <span style={{ color: noiseOn ? "#ff6b6b" : "#2a6868", fontSize: 10, fontWeight: "bold" }}>{noiseOn ? "ON" : "OFF"}</span>
                </label>
              </div>
              {noiseOn && (
                <>
                  <Slider label="SNR (dB)" val={snrDb} min={0} max={40} step={1} unit=" dB" onChange={setSnrDb} color="#ff6b6b" />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {[0, 5, 10, 20, 30].map(v => (
                      <button key={v} onClick={() => setSnrDb(v)}
                        style={{ ...btnStyle(snrDb === v, "#ff6b6b"), fontSize: 9, padding: "3px 8px" }}>{v} dB</button>
                    ))}
                  </div>
                  <div style={{ marginTop: 7, fontSize: 10, color: snrDb < 10 ? "#ff6b6b" : snrDb < 20 ? "#ffcc44" : "#00ff88" }}>
                    {snrDb < 5 ? "⚠ Very noisy — severe distortion" : snrDb < 10 ? "⚠ Noisy channel" : snrDb < 20 ? "△ Moderate noise" : "✓ Good SNR"}
                  </div>
                </>
              )}
              {!noiseOn && <div style={{ color: "#1a4444", fontSize: 10, marginTop: 4 }}>Enable to add Additive White Gaussian Noise to s(t)</div>}
            </div>
          </div>

          {/* Metrics row */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <MCard label="Total Power"   val={metrics.Pt + " W"}    sub="Pt = Pc + Psb" />
            <MCard label="Carrier Power" val={metrics.Pc + " W"}    color="#6bf5ff" sub="Pc = Ac²/2" />
            <MCard label="Efficiency"    val={metrics.eff + "%"}     color={parseFloat(metrics.eff) < 50 ? "#ff6b6b" : "#00ffcc"} sub="η = Psb/Pt" />
            <MCard label="Bandwidth"     val={metrics.bw}            color="#ffcc44" sub={mode === "ssb" ? "BW = fm" : mode === "vsb" ? "BW ≈ 1.25fm" : "BW = 2fm"} />
            {mode === "dsbfc" && <MCard label="Mod. Index μ" val={metrics.muTot} color={metrics.overmod ? "#ff4444" : "#b86bff"} sub={metrics.overmod ? "⚠ OVERMOD!" : "μ < 1  ✓"} />}
            <MCard label="Signal Shape"  val={SIG_TYPES.find(s=>s.id===sigType)?.label} color={sigColor} sub={noiseOn ? `SNR = ${snrDb} dB` : "No noise"} />
          </div>

          {/* Overmod warning */}
          {mode === "dsbfc" && metrics.overmod && (
            <div style={{ background: "#1a0208", border: "1px solid #ff4444", borderRadius: 5, padding: "7px 14px", marginBottom: 8, fontSize: 11, color: "#ff8080", lineHeight: 1.6 }}>
              ⚠  <strong>OVERMODULATION</strong> — μ = {metrics.muTot} &gt; 1 &nbsp;
              <span style={{ fontSize: 10, color: "#aa5555" }}>The envelope crosses zero → distortion at detector output.</span>
            </div>
          )}

          {/* Tab bar */}
          <div style={{ display: "flex", gap: 5, marginBottom: 10, flexWrap: "wrap" }}>
            {[["time","⟟ TIME DOMAIN"],["spectrum","⟝ SPECTRUM"],["phasor","⊙ PHASOR"],["demod","⟒ DEMOD LAB"]].map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)} style={btnStyle(tab === v)}>{l}</button>
            ))}
          </div>

          {/* ── TIME DOMAIN ── */}
          {tab === "time" && (
            <div>
              {/* Zoom Controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ color: "#1e6060", fontSize: 9, letterSpacing: 1 }}>TIME DOMAIN  ·  THREE SIGNAL VIEW</span>
                <div style={{ flex: 1, height: 1, background: "#0a2424", minWidth: 20 }} />
                <span style={{ fontSize: 9, color: "#1a5858" }}>🖱 Scroll to zoom</span>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <button onClick={handleZoomOut}  style={{ ...btnStyle(false), padding: "3px 10px", fontSize: 13 }}>−</button>
                  <span style={{ color: "#00ffcc", fontSize: 11, fontFamily: "monospace", minWidth: 40, textAlign: "center" }}>{zoomLevel.toFixed(1)}×</span>
                  <button onClick={handleZoomIn}   style={{ ...btnStyle(false), padding: "3px 10px", fontSize: 13 }}>+</button>
                  <button onClick={handleZoomReset} style={{ ...btnStyle(zoomLevel === 1), padding: "3px 10px", fontSize: 9 }}>RESET</button>
                </div>
                {zoomLevel > 1 && (
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <button onClick={handlePanLeft}  style={{ ...btnStyle(false), padding: "3px 10px", fontSize: 12 }}>◀</button>
                    <span style={{ color: "#4a9090", fontSize: 9 }}>PAN</span>
                    <button onClick={handlePanRight} style={{ ...btnStyle(false), padding: "3px 10px", fontSize: 12 }}>▶</button>
                  </div>
                )}
                <span style={{ fontSize: 9, color: animSpeed === 0 ? "#ffcc44" : "#00ff88" }}>
                  {animSpeed === 0 ? "⏸ FROZEN" : `▶ LIVE ${animSpeed}×`}
                </span>
              </div>
              <div ref={zoomContainerRef}>
                <AnimatedWaves params={params} speed={animSpeed} showEnv={showEnv} waveConfigs={timeWaves} zoomLevel={zoomLevel} panOffset={panOffset} />
              </div>
            </div>
          )}

          {/* ── SPECTRUM ── */}
          {tab === "spectrum" && (
            <div>
              <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, marginBottom: 8, fontWeight: "bold" }}>FREQUENCY DOMAIN  —  SPECTRAL LINES</div>
              <SpecCanvas lines={specLines} />
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {specLines.map((l, i) => (
                  <div key={i} style={{ background: "#040e0e", border: `1px solid ${l.color}30`, borderRadius: 4, padding: "6px 12px", fontSize: 10 }}>
                    <span style={{ color: l.color, fontWeight: "bold" }}>{l.label}</span>
                    <span style={{ color: "#4a9090", marginLeft: 8 }}>{(l.f / 1000).toFixed(2)} kHz</span>
                    <span style={{ color: "#2a7070", marginLeft: 8 }}>A = {l.amp.toFixed(3)}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: "#2a7070", lineHeight: 1.7 }}>
                <strong style={{ color: "#1e6060" }}>Bandwidth:</strong>{" "}
                {mode === "dsbfc" && `DSB-FC BW = 2 × fm = ${(2 * fm1 / 1000).toFixed(2)} kHz`}
                {mode === "dsbsc" && `DSB-SC BW = 2 × fm = ${(2 * fm1 / 1000).toFixed(2)} kHz`}
                {mode === "ssb"   && `SSB BW = fm = ${(fm1 / 1000).toFixed(2)} kHz`}
                {mode === "vsb"   && `VSB BW ≈ 1.25 × fm = ${(1.25 * fm1 / 1000).toFixed(2)} kHz`}
                {noiseOn && <span style={{ color: "#ff6b6b", marginLeft: 12 }}>⚠ SNR = {snrDb} dB — noise floor visible in AWGN</span>}
              </div>
            </div>
          )}

          {/* ── PHASOR ── */}
          {tab === "phasor" && (
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
              <PhasorCanvas mu={muDisp} mode={mode} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 2, marginBottom: 10, fontWeight: "bold" }}>PHASOR REPRESENTATION</div>
                <div style={{ fontSize: 12, color: "#4a9090", lineHeight: 2 }}>
                  {mode === "dsbfc" && <>
                    <div style={{ color: "#00ffcc", fontWeight: "bold", marginBottom: 4 }}>DSB-FC  =  Carrier + USB + LSB</div>
                    <div>s(t) = Ac·cos(2πfc·t) + (μ·Ac/2)·USB + (μ·Ac/2)·LSB</div>
                    <div style={{ marginTop: 8, color: muDisp > 1 ? "#ff4444" : "#b86bff", fontWeight: "bold" }}>μ = {muDisp.toFixed(3)}  {muDisp > 1 ? "⚠  OVERMODULATION" : "✓  Normal"}</div>
                  </>}
                  {mode === "dsbsc" && <><div style={{ color: "#6bf5ff", fontWeight: "bold", marginBottom: 4 }}>DSB-SC  =  USB + LSB  (no carrier)</div><div>s(t) = m(t)·cos(2πfc·t)</div></>}
                  {mode === "ssb" && <><div style={{ color: "#ff6b6b", fontWeight: "bold", marginBottom: 4 }}>SSB-USB  =  Upper Sideband Only</div><div>s(t) = (Am/2)·cos(2π(fc+fm)·t)</div></>}
                  {mode === "vsb" && <><div style={{ color: "#ffcc44", fontWeight: "bold", marginBottom: 4 }}>VSB  =  USB + Vestigial LSB</div><div>s(t) ≈ USB + small vestige of LSB</div></>}
                </div>
                <div style={{ marginTop: 14, background: "#040e0e", border: "1px solid #0d2828", borderRadius: 5, padding: 10 }}>
                  <div style={{ color: "#1e6060", fontSize: 9, letterSpacing: 1, marginBottom: 6 }}>SIGNAL SHAPE EFFECT</div>
                  <div style={{ fontSize: 11, color: "#4a8080", lineHeight: 1.7 }}>
                    <div><span style={{ color: sigColor }}>▸ {SIG_TYPES.find(s => s.id === sigType)?.label} wave</span> — currently selected</div>
                    {sigType === "sine"     && <div>Pure single-frequency tone. Simplest spectrum — only fundamental.</div>}
                    {sigType === "square"   && <div>Rich harmonics: fundamental + odd harmonics (3rd, 5th, 7th…). Wider effective BW.</div>}
                    {sigType === "triangle" && <div>Odd harmonics with 1/n² rolloff. Softer edges than square wave.</div>}
                    {sigType === "sawtooth" && <div>All harmonics present (1/n rolloff). Sharp edges — very wide spectral content.</div>}
                    {sigType === "pulse"    && <div>Duty cycle determines harmonic distribution. Short pulse = very wide spectrum.</div>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── DEMOD LAB ── */}
          {tab === "demod" && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ color: "#1e6060", fontSize: 9, letterSpacing: 1, fontWeight: "bold" }}>
                  DEMODULATION LAB  —  {mode === "dsbfc" ? "ENVELOPE" : mode === "dsbsc" ? "SYNCHRONOUS" : mode === "ssb" ? "COHERENT" : "COHERENT + VSB"} DETECTION
                </span>
                <div style={{ flex: 1, height: 1, background: "#0a2424" }} />
                <span style={{ fontSize: 9, color: animSpeed === 0 ? "#ffcc44" : "#00ff88" }}>
                  {animSpeed === 0 ? "⏸ FROZEN" : `▶ LIVE`}
                </span>
              </div>
              <AnimatedWaves params={params} speed={animSpeed} showEnv={showEnv} waveConfigs={demodWaves} zoomLevel={1} panOffset={0} />
              <DemodTheory mode={mode} />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

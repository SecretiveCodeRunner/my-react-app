import { useState, useEffect, useRef, useMemo, useCallback } from "react";

const TWO_PI = 2 * Math.PI;
const SAMPLES = 2400; // more samples for smooth scrolling

function buildSignals(p, timeOffset = 0) {
  const { mode, tone, Am1, Am2, Ac, fm1, fm2, fc, mu1, mu2, phi1, phi2, cycles } = p;
  const T = cycles / fm1;
  const t = Array.from({ length: SAMPLES }, (_, i) => timeOffset + (i / (SAMPLES - 1)) * T);
  const rad1 = phi1 * Math.PI / 180;
  const rad2 = phi2 * Math.PI / 180;

  const msg = t.map(ti =>
    Am1 * Math.cos(TWO_PI * fm1 * ti + rad1) +
    (tone === "double" ? Am2 * Math.cos(TWO_PI * fm2 * ti + rad2) : 0)
  );
  const carrier = t.map(ti => Ac * Math.cos(TWO_PI * fc * ti));

  let modulated, envelope;
  if (mode === "dsbfc") {
    envelope = t.map(ti =>
      tone === "single"
        ? Ac * (1 + mu1 * Math.cos(TWO_PI * fm1 * ti + rad1))
        : Ac * (1 + mu1 * Math.cos(TWO_PI * fm1 * ti + rad1) + mu2 * Math.cos(TWO_PI * fm2 * ti + rad2))
    );
    modulated = envelope.map((env, i) => env * Math.cos(TWO_PI * fc * t[i]));
  } else if (mode === "dsbsc") {
    modulated = msg.map((m, i) => m * Math.cos(TWO_PI * fc * t[i]));
    envelope = msg.map(v => Math.abs(v));
  } else if (mode === "ssb") {
    modulated = t.map((ti, i) => {
      const ip = msg[i] * Math.cos(TWO_PI * fc * ti);
      const qp = Am1 * Math.sin(TWO_PI * fm1 * ti + rad1) * Math.sin(TWO_PI * fc * ti);
      return (ip - qp) / 2;
    });
    envelope = modulated.map(v => Math.abs(v));
  } else {
    modulated = t.map(ti =>
      (Am1 / 2) * Math.cos(TWO_PI * (fc + fm1) * ti + rad1) +
      (Am1 / 8) * Math.cos(TWO_PI * (fc - fm1) * ti - rad1)
    );
    envelope = modulated.map(v => Math.abs(v));
  }

  const demodulated = envelope.map(v => (mode === "dsbfc" ? v - Ac : v));
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

// ─────────────────────────────────────────────
// Animated Waveform Canvas
// timeOffset: shared scrolling time ref (passed from parent)
// ─────────────────────────────────────────────
function WaveCanvas({ getSignal, color, label, height = 120, showEnv, getEnv, peak: peakOverride }) {
  const ref = useRef(null);

  const draw = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    const data = getSignal();
    const envData = getEnv ? getEnv() : null;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#030d0d";
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = "#0b2222";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (i / 4) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let i = 1; i < 8; i++) {
      const x = (i / 8) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = "#1a4040";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    // Y-axis label: +peak / -peak
    const peak = peakOverride || Math.max(...data.map(Math.abs), 0.001);
    ctx.fillStyle = "#2a5555";
    ctx.font = "9px monospace";
    ctx.textAlign = "right";
    ctx.fillText("+" + peak.toFixed(2), W - 4, 10);
    ctx.fillText("-" + peak.toFixed(2), W - 4, H - 3);
    ctx.textAlign = "left";

    const toX = i => (i / (data.length - 1)) * W;
    const toY = v => H / 2 - (v / peak) * (H / 2 - 8);

    // Envelope dashes
    if (showEnv && envData && envData.length) {
      ctx.strokeStyle = "rgba(255,200,40,0.5)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      envData.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
      ctx.stroke();
      ctx.beginPath();
      envData.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(-Math.abs(v))) : ctx.lineTo(toX(i), toY(-Math.abs(v))));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Signal
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    data.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Label — bigger and clearer
    ctx.fillStyle = "#000000aa";
    ctx.fillRect(6, 4, ctx.measureText(label).width + 10, 18);
    ctx.fillStyle = color;
    ctx.font = "bold 11px monospace";
    ctx.fillText(label, 10, 17);
  }, [getSignal, getEnv, color, label, showEnv, peakOverride]);

  // expose draw so parent can call it in the animation loop
  ref.drawFn = draw;

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div style={{ marginBottom: 2 }}>
      <canvas
        ref={ref}
        width={900}
        height={height}
        style={{ width: "100%", height, display: "block", borderRadius: 4, border: "1px solid #0d2828" }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Animated waveform group — drives RAF loop
// ─────────────────────────────────────────────
function AnimatedWaves({ params, speed, showEnv, waveConfigs }) {
  const timeRef = useRef(0);
  const rafRef = useRef(null);
  const canvasRefs = useRef([]);
  const paramsRef = useRef(params);
  const speedRef = useRef(speed);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  // Pre-compute peak per wave type so scale stays stable while scrolling
  const stablePeaks = useMemo(() => {
    const s = buildSignals(params, 0);
    return {
      msg: Math.max(...s.msg.map(Math.abs), 0.001),
      carrier: Math.max(...s.carrier.map(Math.abs), 0.001),
      modulated: Math.max(...s.modulated.map(Math.abs), 0.001),
      envelope: Math.max(...s.envelope.map(Math.abs), 0.001),
      demodulated: Math.max(...s.demodulated.map(Math.abs), 0.001),
    };
  }, [params.mode, params.tone, params.Am1, params.Am2, params.Ac, params.fm1, params.fm2, params.fc, params.mu1, params.mu2, params.phi1, params.phi2]);

  useEffect(() => {
    const drawAll = () => {
      const s = buildSignals(paramsRef.current, timeRef.current);
      const sp = speedRef.current;

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
        for (let i = 1; i < 4; i++) { const y = (i/4)*H; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
        for (let i = 1; i < 8; i++) { const x = (i/8)*W; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }

        // Zero line
        ctx.strokeStyle = "#1a4040"; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

        const data = s[cfg.key];
        const peak = stablePeaks[cfg.key] || Math.max(...data.map(Math.abs), 0.001);

        // Y labels
        ctx.fillStyle = "#2a5555"; ctx.font = "9px monospace"; ctx.textAlign = "right";
        ctx.fillText("+" + peak.toFixed(2), W - 4, 10);
        ctx.fillText("-" + peak.toFixed(2), W - 4, H - 3);
        ctx.textAlign = "left";

        const toX = i => (i / (data.length - 1)) * W;
        const toY = v => H/2 - (v / peak) * (H/2 - 8);

        // Envelope
        if (cfg.showEnv && s.envelope) {
          ctx.strokeStyle = "rgba(255,200,40,0.5)"; ctx.lineWidth = 1.2;
          ctx.setLineDash([5,4]);
          ctx.beginPath();
          s.envelope.forEach((v,i) => i===0 ? ctx.moveTo(toX(i),toY(v)) : ctx.lineTo(toX(i),toY(v)));
          ctx.stroke();
          ctx.beginPath();
          s.envelope.forEach((v,i) => i===0 ? ctx.moveTo(toX(i),toY(-Math.abs(v))) : ctx.lineTo(toX(i),toY(-Math.abs(v))));
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Signal line
        ctx.strokeStyle = cfg.color; ctx.lineWidth = 1.8;
        ctx.shadowColor = cfg.color; ctx.shadowBlur = 5;
        ctx.beginPath();
        data.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Label background + text
        const labelW = ctx.measureText(cfg.label).width + 14;
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fillRect(6, 4, labelW, 20);
        ctx.fillStyle = cfg.color;
        ctx.font = "bold 11px 'Courier New', monospace";
        ctx.fillText(cfg.label, 10, 18);

        // "LIVE" badge when scrolling
        if (sp > 0) {
          ctx.fillStyle = "rgba(0,255,100,0.15)";
          ctx.fillRect(W - 42, 4, 36, 18);
          ctx.fillStyle = "#00ff88";
          ctx.font = "bold 9px monospace";
          ctx.textAlign = "right";
          ctx.fillText("● LIVE", W - 6, 16);
          ctx.textAlign = "left";
        }
      });

      if (sp > 0) {
        timeRef.current += sp * 0.00003;
      }
      rafRef.current = requestAnimationFrame(drawAll);
    };

    rafRef.current = requestAnimationFrame(drawAll);
    return () => cancelAnimationFrame(rafRef.current);
  }, [waveConfigs, stablePeaks]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {waveConfigs.map((cfg, idx) => (
        <div key={cfg.key + cfg.label}>
          <canvas
            ref={el => canvasRefs.current[idx] = el}
            width={900}
            height={cfg.height || 120}
            style={{ width: "100%", height: cfg.height || 120, display: "block", borderRadius: 4, border: "1px solid #0d2828" }}
          />
        </div>
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
    for (let i = 1; i < 5; i++) { const y = (i/5)*H; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    const freqs = lines.map(l => l.f);
    const maxA = Math.max(...lines.map(l => l.amp), 0.001);
    const fMin = Math.min(...freqs), fMax = Math.max(...freqs);
    const pad = (fMax - fMin) * 0.4 || 2500;
    const fLo = fMin - pad, fHi = fMax + pad;
    const toX = f => 24 + ((f - fLo) / (fHi - fLo)) * (W - 48);
    const toY = a => H - 28 - (a / maxA) * (H - 56);

    ctx.strokeStyle = "#1a4040"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H-28); ctx.lineTo(W, H-28); ctx.stroke();

    // Frequency axis labels
    ctx.fillStyle = "#2a5555"; ctx.font = "9px monospace"; ctx.textAlign = "center";
    const numTicks = 6;
    for (let i = 0; i <= numTicks; i++) {
      const f = fLo + i * (fHi - fLo) / numTicks;
      const x = toX(f);
      ctx.fillText((f/1000).toFixed(1)+"k", x, H-10);
    }

    lines.forEach(line => {
      const x = toX(line.f), y = toY(line.amp);
      ctx.strokeStyle = line.color; ctx.lineWidth = 3;
      ctx.shadowColor = line.color; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(x, H-28); ctx.lineTo(x, y); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = line.color;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, TWO_PI); ctx.fill();

      // Label above spike
      ctx.font = "bold 11px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(x - 22, y - 24, 44, 16);
      ctx.fillStyle = line.color;
      ctx.fillText(line.label, x, y - 12);

      // Amplitude below
      ctx.fillStyle = "#3a8080"; ctx.font = "9px monospace";
      ctx.fillText("A="+line.amp.toFixed(3), x, y + 14);
    });
    ctx.textAlign = "left";
  }, [lines]);

  return (
    <canvas ref={ref} width={900} height={200}
      style={{ width: "100%", height: 200, display: "block", borderRadius: 4, border: "1px solid #0d2828" }}
    />
  );
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
    const cx = W/2, cy = H/2;
    const R = Math.min(W,H)/2 - 20;

    const draw = () => {
      angle.current += 0.022;
      const a = angle.current;
      ctx.clearRect(0,0,W,H);
      ctx.fillStyle = "#030d0d"; ctx.fillRect(0,0,W,H);

      // Reference circle
      ctx.strokeStyle = "#0d2828"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TWO_PI); ctx.stroke();
      ctx.strokeStyle = "#163030";
      ctx.beginPath(); ctx.moveTo(cx-R-4,cy); ctx.lineTo(cx+R+4,cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx,cy-R-4); ctx.lineTo(cx,cy+R+4); ctx.stroke();

      const cLen = R * 0.68;
      const ex = cx + cLen * Math.cos(a);
      const ey = cy - cLen * Math.sin(a);

      // Carrier
      ctx.strokeStyle = "#00ffcc"; ctx.lineWidth = 2.5;
      ctx.shadowColor = "#00ffcc"; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(ex,ey); ctx.stroke();
      ctx.fillStyle = "#00ffcc"; ctx.beginPath(); ctx.arc(ex,ey,4,0,TWO_PI); ctx.fill();
      ctx.shadowBlur = 0;

      if (mode === "dsbfc" || mode === "dsbsc") {
        const sbLen = R * 0.3 * Math.min(Math.max(mu,0.1),1.5);
        const usbX = ex + sbLen * Math.cos(2*a);
        const usbY = ey - sbLen * Math.sin(2*a);
        const lsbX = ex + sbLen;
        const lsbY = ey;

        ctx.strokeStyle = "#ff6b6b"; ctx.lineWidth = 2;
        ctx.shadowColor = "#ff6b6b"; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(usbX,usbY); ctx.stroke();
        ctx.fillStyle = "#ff6b6b"; ctx.beginPath(); ctx.arc(usbX,usbY,3,0,TWO_PI); ctx.fill();

        ctx.strokeStyle = "#6bf5ff"; ctx.shadowColor = "#6bf5ff";
        ctx.beginPath(); ctx.moveTo(ex,ey); ctx.lineTo(lsbX,lsbY); ctx.stroke();
        ctx.fillStyle = "#6bf5ff"; ctx.beginPath(); ctx.arc(lsbX,lsbY,3,0,TWO_PI); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Legend
      const legend = [
        ["#00ffcc", "Carrier"],
        ...(mode === "dsbfc" || mode === "dsbsc" ? [["#ff6b6b","USB"],["#6bf5ff","LSB"]] : []),
        ...(mode === "ssb" ? [["#ff6b6b","USB only"]] : []),
      ];
      legend.forEach(([col, lbl], i) => {
        ctx.fillStyle = col; ctx.font = "bold 10px monospace";
        ctx.fillText("● " + lbl, 6, 14 + i * 13);
      });

      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [mu, mode]);

  return <canvas ref={ref} width={230} height={230}
    style={{ width: 230, height: 230, flexShrink: 0, borderRadius: 4, border: "1px solid #0d2828" }} />;
}

// ── Demod Theory ──
function DemodTheory({ mode }) {
  const info = {
    dsbfc: { title: "DSB-FC  —  Envelope Detection", color: "#00ffcc", steps: [
      "Rectify the signal (half or full-wave)",
      "RC low-pass filter to smooth the rectified output",
      "DC block (capacitor) to remove the Ac offset",
      "Output ≈ Ac · μ · cos(2πfm·t)  ✓ No phase reference needed"
    ]},
    dsbsc: { title: "DSB-SC  —  Synchronous (Coherent) Detection", color: "#6bf5ff", steps: [
      "Multiply received signal by local carrier cos(2πfc·t)",
      "Low-pass filter removes the 2fc term",
      "Output = m(t)/2  — requires phase-locked local oscillator",
      "⚠  Envelope detection FAILS — phase ambiguity problem"
    ]},
    ssb: { title: "SSB-USB  —  Coherent Detection", color: "#ff6b6b", steps: [
      "Multiply by cos(2πfc·t) using a phase-locked oscillator",
      "Low-pass filter extracts the baseband",
      "Very sensitive to frequency offset errors",
      "Half-power output compared to original (Am/4 vs Am)"
    ]},
    vsb: { title: "VSB  —  Coherent + VSB Equaliser Filter", color: "#ffcc44", steps: [
      "Coherent demodulation same as SSB",
      "Vestigial filter corrects amplitude at baseband edges",
      "Used in broadcast TV (NTSC/PAL), digital TV (ATSC)",
      "Good balance: SSB bandwidth efficiency + DSB robustness"
    ]},
  };
  const d = info[mode];
  return (
    <div style={{ background: "#040e0e", border: `1px solid ${d.color}35`, borderRadius: 6, padding: 14, marginTop: 12 }}>
      <div style={{ color: d.color, fontSize: 12, fontWeight: "bold", marginBottom: 10, letterSpacing: 1 }}>{d.title}</div>
      {d.steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 10, marginBottom: 7, fontSize: 11, color: "#6aadad", lineHeight: 1.5 }}>
          <span style={{ color: d.color, flexShrink: 0, fontWeight: "bold" }}>Step {i+1}.</span>
          <span>{s}</span>
        </div>
      ))}
    </div>
  );
}

// ── UI helpers ──
function Slider({ label, val, min, max, step, unit, onChange, color = "#00ffcc" }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ color: "#4a9090", fontSize: 11, fontFamily: "monospace" }}>{label}</span>
        <span style={{ color, fontSize: 12, fontFamily: "monospace", fontWeight: "bold" }}>
          {typeof val === "number" ? (val < 10 ? val.toFixed(2) : Math.round(val)) : val}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={val}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: color, cursor: "pointer", height: 4 }}
      />
    </div>
  );
}

function MCard({ label, val, color = "#00ffcc", sub }) {
  return (
    <div style={{ flex: 1, minWidth: 90, background: "#040e0e", borderRadius: 6, border: `1px solid ${color}30`, padding: "10px 12px" }}>
      <div style={{ color: "#2a6868", fontSize: 10, fontFamily: "monospace", marginBottom: 3 }}>{label}</div>
      <div style={{ color, fontSize: 15, fontFamily: "monospace", fontWeight: "bold" }}>{val}</div>
      {sub && <div style={{ color: "#2a6060", fontSize: 9, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const btnStyle = (active, color = "#00ffcc") => ({
  padding: "6px 16px", cursor: "pointer", fontSize: 11,
  fontFamily: "monospace", fontWeight: "bold",
  background: active ? `${color}20` : "transparent",
  color: active ? color : "#2a6868",
  border: `1px solid ${active ? color + "66" : "#0d2828"}`,
  borderRadius: 4, transition: "all 0.15s",
  letterSpacing: 0.5,
});

// ─────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────
export default function AMToolbox() {
  const [mode, setMode] = useState("dsbfc");
  const [tone, setTone] = useState("single");
  const [tab, setTab] = useState("time");
  const [showEnv, setShowEnv] = useState(true);
  const [cycles, setCycles] = useState(4);
  const [animSpeed, setAnimSpeed] = useState(1); // 0 = frozen, 1 = normal, 5 = fast

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

  const params = { mode, tone, Am1, Am2, Ac, fm1, fm2, fc, mu1, mu2, phi1, phi2, cycles };
  const specLines = useMemo(() => buildSpectrum(params), [mode, tone, Am1, Am2, Ac, fm1, fm2, fc, mu1, mu2]);
  const metrics = useMemo(() => buildMetrics(params), [mode, tone, Am1, Am2, Ac, fm1, fm2, mu1, mu2]);
  const muDisp = mode === "dsbfc" ? (tone === "single" ? mu1 : Math.sqrt(mu1**2 + mu2**2)) : 0;

  // Wave configs for time domain tab
  const timeWaves = useMemo(() => [
    { key: "msg",       label: "m(t)  —  Message Signal",    color: "#ff6b6b", height: 105 },
    { key: "carrier",   label: "c(t)  —  Carrier Wave",      color: "#3ab0b0", height: 85  },
    { key: "modulated", label: "s(t)  —  Modulated Signal",  color: "#00ffcc", height: 140, showEnv: showEnv },
  ], [showEnv]);

  // Wave configs for demod tab
  const demodWaves = useMemo(() => [
    { key: "modulated",  label: "s(t)  —  Received (Modulated Input)",  color: "#00ffcc", height: 120, showEnv: showEnv },
    { key: "envelope",   label: "env(t) — Detected Envelope",           color: "#ffcc44", height: 95  },
    { key: "demodulated",label: "m′(t) — Recovered Message",            color: "#ff6b6b", height: 110 },
    { key: "msg",        label: "m(t)  — Original Reference",           color: "#ff6b6b55", height: 95 },
  ], [showEnv]);

  return (
    <div style={{ minHeight: "100vh", background: "#010c0c", color: "#c0dada", fontFamily: "'Courier New', monospace", padding: 14 }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid #0c2828" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <h1 style={{ margin: 0, fontSize: 22, color: "#00ffcc", letterSpacing: 4, textShadow: "0 0 20px #00ffcc66" }}>
              ◈ AM SIGNAL TOOLBOX
            </h1>
            <span
      style={{
        padding: "10px 28px",
        border: "1px solid #00ffcc88",
        borderRadius: 10,
        color: "#00ffcc",
        fontSize: 22,
        fontWeight: "bold",
        letterSpacing: 5,
        textShadow: "0 0 18px #00ffccaa",
        boxShadow: "0 0 18px #00ffcc22 inset, 0 0 12px #00ffcc33",
        background: "rgba(0,255,200,0.05)",
      }}
    >
      APURBA MAITY
    </span>
  </div>
</div>

      <div style={{ display: "flex", gap: 14 }}>

        {/* ── LEFT CONTROLS ── */}
        <div style={{ width: 238, flexShrink: 0, background: "#040f0f", borderRadius: 8, border: "1px solid #0a2424", padding: 13, overflowY: "auto", maxHeight: "calc(100vh - 80px)" }}>

          {/* Mode */}
          <div style={{ marginBottom: 13 }}>
            <div style={{ color: "#1e6060", fontSize: 10, letterSpacing: 2, marginBottom: 6, fontWeight: "bold" }}>MODULATION MODE</div>
            {[["dsbfc","DSB-FC  (full carrier)"],["dsbsc","DSB-SC  (suppressed)"],["ssb","SSB-USB  (single side)"],["vsb","VSB  (vestigial)"]].map(([v,l]) => (
              <button key={v} onClick={() => setMode(v)}
                style={{ ...btnStyle(mode===v), display:"block", width:"100%", marginBottom:4, textAlign:"left" }}>
                {l}
              </button>
            ))}
          </div>

          {/* Tone */}
          <div style={{ marginBottom: 13 }}>
            <div style={{ color: "#1e6060", fontSize: 10, letterSpacing: 2, marginBottom: 6, fontWeight: "bold" }}>TONE TYPE</div>
            <div style={{ display:"flex", gap:5 }}>
              {[["single","Single Tone"],["double","Double Tone"]].map(([v,l]) => (
                <button key={v} onClick={() => setTone(v)} style={{ ...btnStyle(tone===v), flex:1, textAlign:"center", fontSize:10 }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Animation speed */}
          <div style={{ marginBottom: 13, background: "#020a0a", border: "1px solid #0c3030", borderRadius: 6, padding: "10px 10px 6px" }}>
            <div style={{ color: "#1e6060", fontSize: 10, letterSpacing: 2, marginBottom: 6, fontWeight: "bold" }}>
              WAVEFORM ANIMATION
            </div>
            <Slider
              label="Scroll Speed"
              val={animSpeed} min={0} max={10} step={0.5} unit="×"
              onChange={setAnimSpeed}
              color={animSpeed === 0 ? "#ffcc44" : "#00ff88"}
            />
            <div style={{ fontSize: 10, color: animSpeed === 0 ? "#ffcc44" : "#00ff88", marginTop: -4, marginBottom: 4 }}>
              {animSpeed === 0 ? "⏸ FROZEN — stable view" : `▶ LIVE — speed ${animSpeed}×`}
            </div>
          </div>

          {/* Carrier */}
          <div style={{ borderTop: "1px solid #0a2424", paddingTop: 10, marginBottom: 6 }}>
            <div style={{ color: "#1e6060", fontSize: 10, letterSpacing: 2, marginBottom: 6, fontWeight: "bold" }}>CARRIER</div>
            <Slider label="Ac — Amplitude" val={Ac} min={0.5} max={5} step={0.1} unit=" V" onChange={setAc} />
            <Slider label="fc — Frequency" val={fc} min={2000} max={50000} step={500} unit=" Hz" onChange={setFc} color="#6bf5ff" />
          </div>

          {/* Message 1 */}
          <div style={{ borderTop: "1px solid #0a2424", paddingTop: 10, marginBottom: 6 }}>
            <div style={{ color: "#1e6060", fontSize: 10, letterSpacing: 2, marginBottom: 6, fontWeight: "bold" }}>MESSAGE 1</div>
            <Slider label="Am₁ — Amplitude" val={Am1} min={0.1} max={5} step={0.1} unit=" V" onChange={setAm1} color="#ff6b6b" />
            <Slider label="fm₁ — Frequency" val={fm1} min={100} max={5000} step={50} unit=" Hz" onChange={setFm1} color="#ff6b6b" />
            {mode === "dsbfc" && <Slider label="μ₁ — Mod. Index" val={mu1} min={0.01} max={2} step={0.01} unit="" onChange={setMu1} color="#ff6b6b" />}
            <Slider label="φ₁ — Phase" val={phi1} min={-180} max={180} step={5} unit="°" onChange={setPhi1} color="#ff6b6b" />
          </div>

          {/* Message 2 */}
          {tone === "double" && (
            <div style={{ borderTop: "1px solid #0a2424", paddingTop: 10, marginBottom: 6 }}>
              <div style={{ color: "#1e6060", fontSize: 10, letterSpacing: 2, marginBottom: 6, fontWeight: "bold" }}>MESSAGE 2</div>
              <Slider label="Am₂ — Amplitude" val={Am2} min={0.1} max={5} step={0.1} unit=" V" onChange={setAm2} color="#ffcc44" />
              <Slider label="fm₂ — Frequency" val={fm2} min={100} max={5000} step={50} unit=" Hz" onChange={setFm2} color="#ffcc44" />
              {mode === "dsbfc" && <Slider label="μ₂ — Mod. Index" val={mu2} min={0.01} max={2} step={0.01} unit="" onChange={setMu2} color="#ffcc44" />}
              <Slider label="φ₂ — Phase" val={phi2} min={-180} max={180} step={5} unit="°" onChange={setPhi2} color="#ffcc44" />
            </div>
          )}

          {/* Display */}
          <div style={{ borderTop: "1px solid #0a2424", paddingTop: 10 }}>
            <div style={{ color: "#1e6060", fontSize: 10, letterSpacing: 2, marginBottom: 6, fontWeight: "bold" }}>DISPLAY</div>
            <Slider label="Cycles Shown" val={cycles} min={1} max={10} step={1} unit="" onChange={setCycles} color="#b86bff" />
            <label style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer", marginTop:6 }}>
              <input type="checkbox" checked={showEnv} onChange={e => setShowEnv(e.target.checked)} style={{ accentColor:"#ffcc44" }} />
              <span style={{ color:"#4a9090", fontSize:11 }}>Show envelope trace</span>
            </label>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Metrics row */}
          <div style={{ display:"flex", gap:7, marginBottom:12, flexWrap:"wrap" }}>
            <MCard label="Total Power" val={metrics.Pt + " W"} sub="Pt = Pc + Psb" />
            <MCard label="Carrier Power" val={metrics.Pc + " W"} color="#6bf5ff" sub="Pc = Ac²/2" />
            <MCard label="Efficiency" val={metrics.eff + "%"} color={parseFloat(metrics.eff) < 50 ? "#ff6b6b" : "#00ffcc"} sub="η = Psb/Pt" />
            <MCard label="Bandwidth" val={metrics.bw} color="#ffcc44" sub={mode==="ssb" ? "BW = fm" : mode==="vsb" ? "BW ≈ 1.25fm" : "BW = 2fm"} />
            {mode === "dsbfc" && <MCard label="Mod. Index μ" val={metrics.muTot} color={metrics.overmod ? "#ff4444" : "#b86bff"} sub={metrics.overmod ? "⚠ OVERMOD!" : "μ < 1  ✓"} />}
          </div>

          {/* Overmod warning */}
          {mode === "dsbfc" && metrics.overmod && (
            <div style={{ background:"#1a0208", border:"1px solid #ff4444", borderRadius:5, padding:"8px 14px", marginBottom:10, fontSize:12, color:"#ff8080", lineHeight:1.6 }}>
              ⚠  <strong>OVERMODULATION</strong> — μ = {metrics.muTot} &gt; 1<br/>
              <span style={{ fontSize:10, color:"#aa5555" }}>The envelope crosses zero → envelope detector output is clipped and distorted.</span>
            </div>
          )}

          {/* Tab bar */}
          <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
            {[["time","⟟ TIME DOMAIN"],["spectrum","⟝ SPECTRUM"],["phasor","⊙ PHASOR"],["demod","⟒ DEMOD LAB"]].map(([v,l]) => (
              <button key={v} onClick={() => setTab(v)} style={btnStyle(tab===v)}>{l}</button>
            ))}
          </div>

          {/* ── TIME DOMAIN ── */}
          {tab === "time" && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                <span style={{ color:"#1e6060", fontSize:10, letterSpacing:1 }}>TIME DOMAIN  —  THREE SIGNAL VIEW</span>
                <div style={{ flex:1, height:1, background:"#0a2424" }}/>
                <span style={{ fontSize:10, color: animSpeed===0 ? "#ffcc44" : "#00ff88" }}>
                  {animSpeed===0 ? "⏸ FROZEN" : `▶ SCROLLING ${animSpeed}×`}
                </span>
              </div>
              <AnimatedWaves params={params} speed={animSpeed} showEnv={showEnv} waveConfigs={timeWaves} />
            </div>
          )}

          {/* ── SPECTRUM ── */}
          {tab === "spectrum" && (
            <div>
              <div style={{ color:"#1e6060", fontSize:10, letterSpacing:2, marginBottom:8, fontWeight:"bold" }}>
                FREQUENCY DOMAIN  —  SPECTRAL LINES
              </div>
              <SpecCanvas lines={specLines} />
              <div style={{ marginTop:10, display:"flex", gap:8, flexWrap:"wrap" }}>
                {specLines.map((l,i) => (
                  <div key={i} style={{ background:"#040e0e", border:`1px solid ${l.color}30`, borderRadius:4, padding:"7px 12px", fontSize:11 }}>
                    <span style={{ color:l.color, fontWeight:"bold" }}>{l.label}</span>
                    <span style={{ color:"#4a9090", marginLeft:8 }}>{(l.f/1000).toFixed(2)} kHz</span>
                    <span style={{ color:"#2a7070", marginLeft:8 }}>A = {l.amp.toFixed(3)}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:10, fontSize:11, color:"#2a7070", lineHeight:1.7 }}>
                <strong style={{ color:"#1e6060" }}>Bandwidth:</strong>{" "}
                {mode==="dsbfc" && `DSB-FC BW = 2 × fm = ${(2*fm1/1000).toFixed(2)} kHz`}
                {mode==="dsbsc" && `DSB-SC BW = 2 × fm = ${(2*fm1/1000).toFixed(2)} kHz  (no carrier power)`}
                {mode==="ssb"   && `SSB BW = fm = ${(fm1/1000).toFixed(2)} kHz  (half of DSB)`}
                {mode==="vsb"   && `VSB BW ≈ 1.25 × fm = ${(1.25*fm1/1000).toFixed(2)} kHz`}
              </div>
            </div>
          )}

          {/* ── PHASOR ── */}
          {tab === "phasor" && (
            <div style={{ display:"flex", gap:20, alignItems:"flex-start", flexWrap:"wrap" }}>
              <PhasorCanvas mu={muDisp} mode={mode} />
              <div style={{ flex:1, minWidth:200 }}>
                <div style={{ color:"#1e6060", fontSize:10, letterSpacing:2, marginBottom:10, fontWeight:"bold" }}>PHASOR REPRESENTATION</div>
                <div style={{ fontSize:12, color:"#4a9090", lineHeight:2 }}>
                  {mode==="dsbfc" && <>
                    <div style={{ color:"#00ffcc", fontWeight:"bold", marginBottom:4 }}>DSB-FC  =  Carrier + USB + LSB</div>
                    <div>s(t) = Ac · cos(2π fc t)</div>
                    <div style={{ paddingLeft:16, color:"#ff8080" }}>+  (μ·Ac/2) · cos(2π(fc + fm)t)  ←  Upper Sideband</div>
                    <div style={{ paddingLeft:16, color:"#7aeeff" }}>+  (μ·Ac/2) · cos(2π(fc − fm)t)  ←  Lower Sideband</div>
                    <div style={{ marginTop:10, color: muDisp>1 ? "#ff4444" : "#b86bff", fontWeight:"bold" }}>
                      μ = {muDisp.toFixed(3)}  {muDisp>1 ? "⚠  OVERMODULATION" : "✓  Normal"}
                    </div>
                  </>}
                  {mode==="dsbsc" && <>
                    <div style={{ color:"#6bf5ff", fontWeight:"bold", marginBottom:4 }}>DSB-SC  =  USB + LSB  (no carrier)</div>
                    <div>s(t) = m(t) · cos(2π fc t)</div>
                    <div style={{ paddingLeft:16, color:"#ff8080" }}>= (Am/2) · cos(2π(fc + fm)t)  ←  USB</div>
                    <div style={{ paddingLeft:16, color:"#7aeeff" }}>+ (Am/2) · cos(2π(fc − fm)t)  ←  LSB</div>
                    <div style={{ marginTop:8, color:"#4a7070", fontSize:11 }}>Carrier is suppressed → 100% power efficiency</div>
                  </>}
                  {mode==="ssb" && <>
                    <div style={{ color:"#ff6b6b", fontWeight:"bold", marginBottom:4 }}>SSB-USB  =  Upper Sideband Only</div>
                    <div>s(t) = (Am/2) · cos(2π(fc + fm)t)</div>
                    <div style={{ marginTop:8, color:"#4a7070", fontSize:11 }}>Half the bandwidth of DSB · Needs coherent demodulation</div>
                  </>}
                  {mode==="vsb" && <>
                    <div style={{ color:"#ffcc44", fontWeight:"bold", marginBottom:4 }}>VSB  =  USB + Vestigial LSB</div>
                    <div>s(t) = (Am/2) · cos(2π(fc + fm)t)</div>
                    <div style={{ paddingLeft:16, color:"#7aeeff" }}>+ (Am/8) · cos(2π(fc − fm)t)  ←  Vestige</div>
                    <div style={{ marginTop:8, color:"#4a7070", fontSize:11 }}>BW ≈ 1.25 fm · Used in TV broadcast (NTSC/PAL)</div>
                  </>}
                </div>
              </div>
            </div>
          )}

          {/* ── DEMOD LAB ── */}
          {tab === "demod" && (
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
                <span style={{ color:"#1e6060", fontSize:10, letterSpacing:1, fontWeight:"bold" }}>
                  DEMODULATION LAB  —  {mode==="dsbfc"?"ENVELOPE DETECTION":mode==="dsbsc"?"SYNCHRONOUS DETECTION":mode==="ssb"?"COHERENT DETECTION":"COHERENT + VSB FILTER"}
                </span>
                <div style={{ flex:1, height:1, background:"#0a2424" }}/>
                <span style={{ fontSize:10, color: animSpeed===0 ? "#ffcc44" : "#00ff88" }}>
                  {animSpeed===0 ? "⏸ FROZEN" : `▶ LIVE`}
                </span>
              </div>
              <AnimatedWaves params={params} speed={animSpeed} showEnv={showEnv} waveConfigs={demodWaves} />
              <DemodTheory mode={mode} />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

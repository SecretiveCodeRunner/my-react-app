import { useState, useEffect, useRef, useMemo } from "react";

const TWO_PI = 2 * Math.PI;
const SAMPLES = 800;

function linspace(a, b, n) {
  return Array.from({ length: n }, (_, i) => a + (i / (n - 1)) * (b - a));
}

function buildSignals(p) {
  const { mode, tone, Am1, Am2, Ac, fm1, fm2, fc, mu1, mu2, phi1, phi2, cycles } = p;
  const T = cycles / fm1;
  const t = linspace(0, T, SAMPLES);
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
    modulated = t.map((_, i) => envelope[i] * Math.cos(TWO_PI * fc * t[i]));
  } else if (mode === "dsbsc") {
    modulated = t.map((_, i) => msg[i] * Math.cos(TWO_PI * fc * t[i]));
    envelope = msg.map(v => Math.abs(v));
  } else if (mode === "ssb") {
    modulated = t.map((ti, i) => {
      const ip = msg[i] * Math.cos(TWO_PI * fc * ti);
      const qp = Am1 * Math.sin(TWO_PI * fm1 * ti + rad1) * Math.sin(TWO_PI * fc * ti);
      return (ip - qp) / 2;
    });
    envelope = modulated.map(v => Math.abs(v));
  } else if (mode === "vsb") {
    modulated = t.map(ti =>
      (Am1 / 2) * Math.cos(TWO_PI * (fc + fm1) * ti + rad1) +
      (Am1 / 8) * Math.cos(TWO_PI * (fc - fm1) * ti - rad1)
    );
    envelope = modulated.map(v => Math.abs(v));
  }

  // Demodulation: envelope detection then remove DC offset
  const demodulated = envelope.map(v => mode === "dsbfc" ? v - Ac : v);

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
  } else if (mode === "vsb") {
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
    Pc = 0;
    muTot = null;
    const As = tone === "single" ? Am1 : Math.sqrt(Am1 * Am1 + Am2 * Am2);
    Pt = (As * As) / 4;
    eff = 100;
    bw = tone === "single" ? 2 * fm1 : 2 * Math.max(fm1, fm2);
  } else if (mode === "ssb") {
    Pc = 0; muTot = null;
    Pt = (Am1 * Am1) / 8;
    eff = 100; bw = fm1;
  } else {
    // VSB
    Pc = 0; muTot = null;
    Pt = ((Am1 / 2) ** 2 + (Am1 / 8) ** 2) / 2;
    eff = 100;
    bw = fm1 * 1.25;
  }
  return {
    Pt: Pt.toFixed(4),
    Pc: Pc.toFixed(4),
    eff: eff.toFixed(2),
    bw: (bw / 1000).toFixed(2) + " kHz",
    muTot: muTot !== null ? muTot.toFixed(3) : "—",
    overmod: muTot !== null && muTot > 1
  };
}

// ── Canvas Waveform ──
function WaveCanvas({ data, color, label, height = 120, showEnv, envData, yScaleOverride }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !data || !data.length) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#030b0b";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "#0d2828";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = (i / 4) * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    for (let i = 1; i < 8; i++) { const x = (i / 8) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }

    ctx.strokeStyle = "#163030";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    const peak = yScaleOverride || Math.max(...data.map(Math.abs), 0.001);
    const toX = i => (i / (data.length - 1)) * W;
    const toY = v => H / 2 - (v / peak) * (H / 2 - 6);

    if (showEnv && envData && envData.length) {
      ctx.strokeStyle = "rgba(255,200,40,0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      envData.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
      ctx.stroke();
      ctx.beginPath();
      envData.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(-Math.abs(v))) : ctx.lineTo(toX(i), toY(-Math.abs(v))));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    data.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = color;
    ctx.font = "bold 10px monospace";
    ctx.fillText(label, 8, 14);
  }, [data, color, label, showEnv, envData, yScaleOverride]);

  return (
    <canvas ref={ref} width={860} height={height}
      style={{ width: "100%", height, display: "block", borderRadius: 3, border: "1px solid #0d2828" }}
    />
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
    ctx.fillStyle = "#030b0b";
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "#0d2828";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = (i / 4) * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    const freqs = lines.map(l => l.f);
    const maxA = Math.max(...lines.map(l => l.amp), 0.001);
    const fMin = Math.min(...freqs), fMax = Math.max(...freqs);
    const pad = (fMax - fMin) * 0.35 || 2000;
    const fLo = fMin - pad, fHi = fMax + pad;

    const toX = f => 20 + ((f - fLo) / (fHi - fLo)) * (W - 40);
    const toY = a => H - 24 - (a / maxA) * (H - 50);

    ctx.strokeStyle = "#163030";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H - 24); ctx.lineTo(W, H - 24); ctx.stroke();

    lines.forEach(line => {
      const x = toX(line.f), y = toY(line.amp);
      ctx.strokeStyle = line.color; ctx.lineWidth = 2.5;
      ctx.shadowColor = line.color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(x, H - 24); ctx.lineTo(x, y); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = line.color;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, TWO_PI); ctx.fill();
      ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
      ctx.fillText(line.label, x, y - 10);
      ctx.fillStyle = "#4a8080"; ctx.font = "9px monospace";
      ctx.fillText((line.f / 1000).toFixed(1) + "k", x, H - 8);
    });
    ctx.textAlign = "left";
  }, [lines]);

  return (
    <canvas ref={ref} width={860} height={160}
      style={{ width: "100%", height: 160, display: "block", borderRadius: 3, border: "1px solid #0d2828" }}
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
    const cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) / 2 - 18;

    const draw = () => {
      angle.current += 0.022;
      const a = angle.current;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#030b0b"; ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = "#0d2828"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TWO_PI); ctx.stroke();
      ctx.strokeStyle = "#163030";
      ctx.beginPath(); ctx.moveTo(cx - R - 4, cy); ctx.lineTo(cx + R + 4, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - R - 4); ctx.lineTo(cx, cy + R + 4); ctx.stroke();

      const cLen = R * 0.68;
      const ex = cx + cLen * Math.cos(a);
      const ey = cy - cLen * Math.sin(a);

      ctx.strokeStyle = "#00ffcc"; ctx.lineWidth = 2.5;
      ctx.shadowColor = "#00ffcc"; ctx.shadowBlur = 7;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = "#00ffcc";
      ctx.beginPath(); ctx.arc(ex, ey, 4, 0, TWO_PI); ctx.fill();
      ctx.shadowBlur = 0;

      if (mode === "dsbfc" || mode === "dsbsc") {
        const sbLen = R * 0.3 * Math.min(Math.max(mu, 0.1), 1.5);
        const usbX = ex + sbLen * Math.cos(2 * a);
        const usbY = ey - sbLen * Math.sin(2 * a);
        const lsbX = ex + sbLen * Math.cos(0);
        const lsbY = ey;

        ctx.strokeStyle = "#ff6b6b"; ctx.lineWidth = 2;
        ctx.shadowColor = "#ff6b6b"; ctx.shadowBlur = 5;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(usbX, usbY); ctx.stroke();
        ctx.fillStyle = "#ff6b6b";
        ctx.beginPath(); ctx.arc(usbX, usbY, 3, 0, TWO_PI); ctx.fill();

        ctx.strokeStyle = "#6bf5ff"; ctx.shadowColor = "#6bf5ff";
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(lsbX, lsbY); ctx.stroke();
        ctx.fillStyle = "#6bf5ff";
        ctx.beginPath(); ctx.arc(lsbX, lsbY, 3, 0, TWO_PI); ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.font = "bold 9px monospace";
      ctx.fillStyle = "#00ffcc"; ctx.fillText("● Carrier", 6, 14);
      if (mode === "dsbfc" || mode === "dsbsc") {
        ctx.fillStyle = "#ff6b6b"; ctx.fillText("● USB", 6, 26);
        ctx.fillStyle = "#6bf5ff"; ctx.fillText("● LSB", 6, 38);
      } else if (mode === "ssb") {
        ctx.fillStyle = "#ff6b6b"; ctx.fillText("● USB only", 6, 26);
      }

      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [mu, mode]);

  return (
    <canvas ref={ref} width={220} height={220}
      style={{ width: 220, height: 220, flexShrink: 0, borderRadius: 4, border: "1px solid #0d2828" }}
    />
  );
}

// ── Demodulation Theory Panel ──
function DemodTheory({ mode }) {
  const info = {
    dsbfc: {
      title: "DSB-FC Demodulation",
      steps: [
        "Envelope Detector: rectify + RC low-pass filter",
        "DC Block: remove carrier amplitude offset (Ac)",
        "Output: recovered m(t) ≈ Ac·μ·cos(2πfm·t)",
        "Works because envelope ≥ 0 always (no overmod)"
      ],
      color: "#00ffcc"
    },
    dsbsc: {
      title: "DSB-SC Demodulation",
      steps: [
        "Synchronous (coherent) detection required",
        "Multiply by cos(2πfc·t) — needs phase-locked local carrier",
        "Low-pass filter to remove 2fc component",
        "Output: m(t)/2 — simple envelope detection FAILS"
      ],
      color: "#6bf5ff"
    },
    ssb: {
      title: "SSB-USB Demodulation",
      steps: [
        "Coherent detection: multiply by cos(2πfc·t)",
        "Low-pass filter extracts baseband",
        "Very sensitive to frequency/phase errors",
        "Half-power output: Am/4 vs original Am"
      ],
      color: "#ff6b6b"
    },
    vsb: {
      title: "VSB Demodulation",
      steps: [
        "Coherent detection like SSB",
        "Vestigial filter compensates for partial sideband",
        "Used in TV broadcast (NTSC/PAL video)",
        "Compromise between SSB bandwidth & DSB simplicity"
      ],
      color: "#ffcc44"
    }
  };
  const d = info[mode];
  return (
    <div style={{ background: "#040e0e", border: `1px solid ${d.color}30`, borderRadius: 6, padding: 14, marginTop: 10 }}>
      <div style={{ color: d.color, fontSize: 11, fontWeight: "bold", marginBottom: 8, letterSpacing: 1 }}>{d.title}</div>
      {d.steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 10, color: "#6aadad" }}>
          <span style={{ color: d.color, flexShrink: 0 }}>{i + 1}.</span>
          <span>{s}</span>
        </div>
      ))}
    </div>
  );
}

// ── UI Primitives ──
function Slider({ label, val, min, max, step, unit, onChange, color = "#00ffcc" }) {
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ color: "#4a8888", fontSize: 10, fontFamily: "monospace" }}>{label}</span>
        <span style={{ color, fontSize: 11, fontFamily: "monospace", fontWeight: "bold" }}>
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

function MCard({ label, val, color = "#00ffcc" }) {
  return (
    <div style={{ flex: 1, background: "#040e0e", borderRadius: 5, border: `1px solid ${color}28`, padding: "8px 10px" }}>
      <div style={{ color: "#2a6060", fontSize: 9, fontFamily: "monospace", marginBottom: 2 }}>{label}</div>
      <div style={{ color, fontSize: 14, fontFamily: "monospace", fontWeight: "bold" }}>{val}</div>
    </div>
  );
}

const btnStyle = (active, color = "#00ffcc") => ({
  padding: "5px 14px", cursor: "pointer", fontSize: 11,
  fontFamily: "monospace", fontWeight: "bold",
  background: active ? `${color}18` : "transparent",
  color: active ? color : "#2a6060",
  border: `1px solid ${active ? color + "55" : "#0d2828"}`,
  borderRadius: 4, transition: "all 0.15s"
});

// ── Main App ──
export default function AMToolbox() {
  const [mode, setMode] = useState("dsbfc");
  const [tone, setTone] = useState("single");
  const [tab, setTab] = useState("time");
  const [showEnv, setShowEnv] = useState(true);
  const [cycles, setCycles] = useState(4);

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

  const { msg, carrier, modulated, envelope, demodulated } = useMemo(() => buildSignals(params), [
    mode, tone, Am1, Am2, Ac, fm1, fm2, fc, mu1, mu2, phi1, phi2, cycles
  ]);
  const specLines = useMemo(() => buildSpectrum(params), [mode, tone, Am1, Am2, Ac, fm1, fm2, fc, mu1, mu2]);
  const metrics = useMemo(() => buildMetrics(params), [mode, tone, Am1, Am2, Ac, fm1, fm2, mu1, mu2]);

  const muDisp = mode === "dsbfc" ? (tone === "single" ? mu1 : Math.sqrt(mu1 ** 2 + mu2 ** 2)) : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#020b0b", color: "#b0d8d4", fontFamily: "monospace", padding: 14 }}>

      {/* Header */}
<div style={{ marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid #0a2828" }}>
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
    
    <h1
      style={{
        margin: 0,
        fontSize: 20,
        color: "#00ffcc",
        letterSpacing: 3,
        textShadow: "0 0 16px #00ffcc55"
      }}
    >
      ◈ AM SIGNAL TOOLBOX
    </h1>

    <span
      style={{
        color: "#7fffd4",
        fontSize: 18,
        fontWeight: "bold",
        letterSpacing: 2,
        textShadow: "0 0 12px #00ffcc88",
        padding: "4px 12px",
        border: "1px solid #0a4a4a",
        borderRadius: 10,
        background: "rgba(0,255,204,0.05)"
      }}
    >
      APURBA MAITY
    </span>

  </div>
</div>


      <div style={{ display: "flex", gap: 14 }}>

        {/* ── LEFT PANEL ── */}
        <div style={{ width: 230, flexShrink: 0, background: "#040e0e", borderRadius: 8, border: "1px solid #0a2828", padding: 12, overflowY: "auto", maxHeight: "calc(100vh - 80px)" }}>

          {/* Mode */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#2a7070", fontSize: 9, letterSpacing: 1, marginBottom: 5 }}>MODULATION MODE</div>
            {[["dsbfc", "DSB-FC  (with carrier)"], ["dsbsc", "DSB-SC  (suppressed)"], ["ssb", "SSB-USB  (single side)"], ["vsb", "VSB  (vestigial)"]].map(([v, l]) => (
              <button key={v} onClick={() => setMode(v)}
                style={{ ...btnStyle(mode === v), display: "block", width: "100%", marginBottom: 4, textAlign: "left" }}>
                {l}
              </button>
            ))}
          </div>

          {/* Tone */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "#2a7070", fontSize: 9, letterSpacing: 1, marginBottom: 5 }}>TONE TYPE</div>
            <div style={{ display: "flex", gap: 5 }}>
              {[["single", "Single"], ["double", "Double"]].map(([v, l]) => (
                <button key={v} onClick={() => setTone(v)} style={{ ...btnStyle(tone === v), flex: 1, textAlign: "center" }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Carrier */}
          <div style={{ borderTop: "1px solid #0a2828", paddingTop: 10, marginBottom: 6 }}>
            <div style={{ color: "#2a7070", fontSize: 9, letterSpacing: 1, marginBottom: 6 }}>CARRIER</div>
            <Slider label="Ac — amplitude (V)" val={Ac} min={0.5} max={5} step={0.1} unit=" V" onChange={setAc} />
            <Slider label="fc — frequency (Hz)" val={fc} min={2000} max={50000} step={500} unit=" Hz" onChange={setFc} color="#6bf5ff" />
          </div>

          {/* Message 1 */}
          <div style={{ borderTop: "1px solid #0a2828", paddingTop: 10, marginBottom: 6 }}>
            <div style={{ color: "#2a7070", fontSize: 9, letterSpacing: 1, marginBottom: 6 }}>MESSAGE 1</div>
            <Slider label="Am₁ — amplitude (V)" val={Am1} min={0.1} max={5} step={0.1} unit=" V" onChange={setAm1} color="#ff6b6b" />
            <Slider label="fm₁ — frequency (Hz)" val={fm1} min={100} max={5000} step={50} unit=" Hz" onChange={setFm1} color="#ff6b6b" />
            {mode === "dsbfc" && <Slider label="μ₁ — mod. index" val={mu1} min={0.01} max={2} step={0.01} unit="" onChange={setMu1} color="#ff6b6b" />}
            <Slider label="φ₁ — phase (°)" val={phi1} min={-180} max={180} step={5} unit="°" onChange={setPhi1} color="#ff6b6b" />
          </div>

          {/* Message 2 */}
          {tone === "double" && (
            <div style={{ borderTop: "1px solid #0a2828", paddingTop: 10, marginBottom: 6 }}>
              <div style={{ color: "#2a7070", fontSize: 9, letterSpacing: 1, marginBottom: 6 }}>MESSAGE 2</div>
              <Slider label="Am₂ — amplitude (V)" val={Am2} min={0.1} max={5} step={0.1} unit=" V" onChange={setAm2} color="#ffcc44" />
              <Slider label="fm₂ — frequency (Hz)" val={fm2} min={100} max={5000} step={50} unit=" Hz" onChange={setFm2} color="#ffcc44" />
              {mode === "dsbfc" && <Slider label="μ₂ — mod. index" val={mu2} min={0.01} max={2} step={0.01} unit="" onChange={setMu2} color="#ffcc44" />}
              <Slider label="φ₂ — phase (°)" val={phi2} min={-180} max={180} step={5} unit="°" onChange={setPhi2} color="#ffcc44" />
            </div>
          )}

          {/* Display */}
          <div style={{ borderTop: "1px solid #0a2828", paddingTop: 10 }}>
            <Slider label="Cycles displayed" val={cycles} min={1} max={10} step={1} unit="" onChange={setCycles} color="#b86bff" />
            <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", marginTop: 6 }}>
              <input type="checkbox" checked={showEnv} onChange={e => setShowEnv(e.target.checked)} style={{ accentColor: "#ffcc44" }} />
              <span style={{ color: "#4a8080", fontSize: 10 }}>Show envelope</span>
            </label>
          </div>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Metrics */}
          <div style={{ display: "flex", gap: 7, marginBottom: 12, flexWrap: "wrap" }}>
            <MCard label="Total Power (W)" val={metrics.Pt} />
            <MCard label="Carrier Power (W)" val={metrics.Pc} color="#6bf5ff" />
            <MCard label="Efficiency" val={metrics.eff + "%"} color={parseFloat(metrics.eff) < 50 ? "#ff6b6b" : "#00ffcc"} />
            <MCard label="Bandwidth" val={metrics.bw} color="#ffcc44" />
            {mode === "dsbfc" && (
              <MCard label="μ total" val={metrics.muTot} color={metrics.overmod ? "#ff4444" : "#b86bff"} />
            )}
          </div>

          {/* Overmod warning */}
          {mode === "dsbfc" && metrics.overmod && (
            <div style={{
              background: "#2a050a", border: "1px solid #ff4444", borderRadius: 5,
              padding: "6px 12px", marginBottom: 10, fontSize: 11, color: "#ff7070"
            }}>
              ⚠ OVERMODULATION DETECTED — μ = {metrics.muTot} &gt; 1 — Signal will be distorted at demodulator
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {[["time", "TIME DOMAIN"], ["spectrum", "SPECTRUM"], ["phasor", "PHASOR"], ["demod", "DEMODULATION LAB"]].map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)} style={btnStyle(tab === v)}>{l}</button>
            ))}
          </div>

          {/* ── TIME DOMAIN ── */}
          {tab === "time" && (
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                <WaveCanvas data={msg} color="#ff6b6b" label="m(t) — Message Signal" height={100} />
                <WaveCanvas data={carrier} color="#2a9090" label="c(t) — Carrier" height={80} />
                <WaveCanvas
                  data={modulated} color="#00ffcc" label="s(t) — Modulated Signal" height={140}
                  showEnv={showEnv} envData={envelope}
                />
              </div>
            </div>
          )}

          {/* ── SPECTRUM ── */}
          {tab === "spectrum" && (
            <div>
              <div style={{ color: "#2a7070", fontSize: 9, marginBottom: 6, letterSpacing: 1 }}>FREQUENCY DOMAIN — SPECTRAL LINES</div>
              <SpecCanvas lines={specLines} />
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {specLines.map((l, i) => (
                  <div key={i} style={{ background: "#040e0e", border: `1px solid ${l.color}30`, borderRadius: 4, padding: "5px 10px", fontSize: 10 }}>
                    <span style={{ color: l.color }}>{l.label}</span>
                    <span style={{ color: "#4a8080", marginLeft: 6 }}>{(l.f / 1000).toFixed(2)} kHz</span>
                    <span style={{ color: "#2a6060", marginLeft: 6 }}>A={l.amp.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── PHASOR ── */}
          {tab === "phasor" && (
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <PhasorCanvas mu={muDisp} mode={mode} />
              <div style={{ flex: 1 }}>
                <div style={{ color: "#2a7070", fontSize: 9, letterSpacing: 1, marginBottom: 8 }}>PHASOR REPRESENTATION</div>
                <div style={{ fontSize: 10, color: "#4a9090", lineHeight: 1.7 }}>
                  {mode === "dsbfc" && <>
                    <div style={{ color: "#00ffcc", marginBottom: 4 }}>DSB-FC = Carrier + USB + LSB</div>
                    <div>s(t) = Ac·cos(2πfc·t)</div>
                    <div style={{ marginLeft: 12 }}>+ (μ·Ac/2)·cos(2π(fc+fm)·t)  ← USB</div>
                    <div style={{ marginLeft: 12 }}>+ (μ·Ac/2)·cos(2π(fc−fm)·t)  ← LSB</div>
                    <div style={{ marginTop: 8, color: "#b86bff" }}>μ = {muDisp.toFixed(3)} {muDisp > 1 ? "⚠ OVERMOD" : "✓ OK"}</div>
                  </>}
                  {mode === "dsbsc" && <>
                    <div style={{ color: "#6bf5ff", marginBottom: 4 }}>DSB-SC = USB + LSB (no carrier)</div>
                    <div>s(t) = m(t)·cos(2πfc·t)</div>
                    <div style={{ marginLeft: 12 }}>= (Am/2)·cos(2π(fc+fm)·t)</div>
                    <div style={{ marginLeft: 12 }}>+ (Am/2)·cos(2π(fc−fm)·t)</div>
                  </>}
                  {mode === "ssb" && <>
                    <div style={{ color: "#ff6b6b", marginBottom: 4 }}>SSB-USB = Upper sideband only</div>
                    <div>s(t) = (Am/2)·cos(2π(fc+fm)·t)</div>
                    <div style={{ marginTop: 6, color: "#4a8080" }}>BW = fm (half of DSB)</div>
                  </>}
                  {mode === "vsb" && <>
                    <div style={{ color: "#ffcc44", marginBottom: 4 }}>VSB = USB + partial LSB (vestige)</div>
                    <div>s(t) = (Am/2)·cos(2π(fc+fm)·t)</div>
                    <div style={{ marginLeft: 12 }}>+ (Am/8)·cos(2π(fc−fm)·t)</div>
                    <div style={{ marginTop: 6, color: "#4a8080" }}>BW ≈ 1.25·fm</div>
                  </>}
                </div>
              </div>
            </div>
          )}

          {/* ── DEMODULATION LAB (from v2, enhanced) ── */}
          {tab === "demod" && (
            <div>
              <div style={{ color: "#2a7070", fontSize: 9, letterSpacing: 1, marginBottom: 8 }}>
                DEMODULATION LAB — ENVELOPE DETECTION SIMULATION
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <WaveCanvas
                  data={modulated} color="#00ffcc" label="s(t) — Demodulator Input (modulated)"
                  height={130} showEnv={showEnv} envData={envelope}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                  <div style={{ flex: 1, height: 1, background: "#0d2828" }} />
                  <span style={{ color: "#2a7070", fontSize: 9 }}>
                    {mode === "dsbfc" ? "ENVELOPE DETECTOR + DC BLOCK" :
                     mode === "dsbsc" ? "SYNCHRONOUS DETECTOR (×cos + LPF)" :
                     mode === "ssb" ? "COHERENT DETECTOR (×cos + LPF)" :
                     "COHERENT DETECTOR + VSB FILTER"}
                  </span>
                  <div style={{ flex: 1, height: 1, background: "#0d2828" }} />
                </div>
                <WaveCanvas
                  data={envelope} color="#ffcc44" label="|env(t)| — Detected Envelope"
                  height={100}
                />
                <WaveCanvas
                  data={demodulated} color="#ff6b6b" label="m'(t) — Recovered Message"
                  height={120}
                />
                <WaveCanvas
                  data={msg} color="#ff6b6b44" label="m(t) — Original Message (reference)"
                  height={100}
                />
              </div>
              <DemodTheory mode={mode} />
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

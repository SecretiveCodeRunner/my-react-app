// "am_toolbox_v5_fullwidth.jsx"
import { useState, useEffect, useRef, useMemo, useCallback } from "react";

const TWO_PI = 2 * Math.PI;
const SAMPLES = 2400;

// ── Signal generators ──
function generateSignalSample(type, phase, dutyCycle = 0.5) {
  const norm = ((phase % TWO_PI) + TWO_PI) % TWO_PI;
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
    envelope = t.map(ti =>
      tone === "single"
        ? Ac * (1 + mu1 * generateSignalSample(sigType, TWO_PI * fm1 * ti + rad1, dutyCycle))
        : Ac * (1 + mu1 * generateSignalSample(sigType, TWO_PI * fm1 * ti + rad1, dutyCycle)
               + mu2 * generateSignalSample(sigType, TWO_PI * fm2 * ti + rad2, dutyCycle))
    );
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
    modulated = t.map((ti) => {
      const usb = (Am1 / 2) * Math.cos(TWO_PI * (fc + fm1) * ti + rad1);
      const vsb = (Am1 / 8) * Math.cos(TWO_PI * (fc - fm1) * ti - rad1);
      return usb + vsb;
    });
    envelope = modulated.map(v => Math.abs(v));
  }

  const demodulated = envelope.map(v => (mode === "dsbfc" ? v - Ac : v));

  if (noiseOn) {
    const noise = generateNoise(SAMPLES, snrDb);
    return { t, msg, carrier, modulated: modulated.map((v, i) => v + noise[i] * Ac * 0.5), envelope, demodulated };
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

// ── Animated Waveform Group ──
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
      msg:         Math.max(...s.msg.map(Math.abs), 0.001),
      carrier:     Math.max(...s.carrier.map(Math.abs), 0.001),
      modulated:   Math.max(...s.modulated.map(Math.abs), 0.001),
      envelope:    Math.max(...s.envelope.map(Math.abs), 0.001),
      demodulated: Math.max(...s.demodulated.map(Math.abs), 0.001),
    };
  }, [
    params.mode, params.tone, params.Am1, params.Am2, params.Ac,
    params.fm1, params.fm2, params.fc, params.mu1, params.mu2,
    params.phi1, params.phi2, params.sigType, params.dutyCycle,
    params.noiseOn, params.snrDb
  ]);

  useEffect(() => {
    const drawAll = () => {
      const s   = buildSignals(paramsRef.current, timeRef.current);
      const sp  = speedRef.current;
      const zoom = zoomRef.current;
      const pan  = panRef.current;

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
        const gridCols = Math.max(10, Math.round(10 * zoom));
        for (let i = 1; i < 5; i++) { const y = (i/5)*H; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
        for (let i = 1; i < gridCols; i++) { const x = (i/gridCols)*W; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }

        // Zero line
        ctx.strokeStyle = "#1a4040"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

        const data = s[cfg.key];
        const peak = stablePeaks[cfg.key] || Math.max(...data.map(Math.abs), 0.001);

        // Y axis labels
        ctx.fillStyle = "#3a7070"; ctx.font = "11px monospace"; ctx.textAlign = "right";
        ctx.fillText("+" + peak.toFixed(3), W - 6, 14);
        ctx.fillText("-"  + peak.toFixed(3), W - 6, H - 4);
        ctx.textAlign = "left";

        // Zoom window
        const visibleFraction = 1 / zoom;
        const startFrac = Math.max(0, Math.min(pan, 1 - visibleFraction));
        const startIdx  = Math.floor(startFrac * data.length);
        const endIdx    = Math.min(data.length - 1, Math.floor(startIdx + visibleFraction * data.length));
        const visData   = data.slice(startIdx, endIdx + 1);

        const toX = i => (i / (visData.length - 1)) * W;
        const toY = v => H/2 - (v / peak) * (H/2 - 10);

        // Tinted bg when zoomed
        if (zoom > 1) {
          ctx.fillStyle = "rgba(0,255,204,0.025)";
          ctx.fillRect(0, 0, W, H);
        }

        // Envelope
        if (cfg.showEnv && s.envelope) {
          const visEnv = s.envelope.slice(startIdx, endIdx + 1);
          ctx.strokeStyle = "rgba(255,200,40,0.55)"; ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          visEnv.forEach((v,i) => i===0 ? ctx.moveTo(toX(i),toY(v)) : ctx.lineTo(toX(i),toY(v)));
          ctx.stroke();
          ctx.beginPath();
          visEnv.forEach((v,i) => i===0 ? ctx.moveTo(toX(i),toY(-Math.abs(v))) : ctx.lineTo(toX(i),toY(-Math.abs(v))));
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Signal
        ctx.strokeStyle = cfg.color; ctx.lineWidth = zoom > 2 ? 2.4 : 2;
        ctx.shadowColor = cfg.color; ctx.shadowBlur = 6;
        ctx.beginPath();
        visData.forEach((v, i) => i === 0 ? ctx.moveTo(toX(i), toY(v)) : ctx.lineTo(toX(i), toY(v)));
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Label pill
        ctx.font = "bold 12px 'Courier New', monospace";
        const lw = ctx.measureText(cfg.label).width + 16;
        ctx.fillStyle = "rgba(0,0,0,0.72)"; ctx.fillRect(6, 5, lw, 22);
        ctx.fillStyle = cfg.color; ctx.fillText(cfg.label, 12, 21);

        // Zoom badge
        if (zoom > 1) {
          ctx.font = "10px monospace"; ctx.textAlign = "right";
          ctx.fillStyle = "rgba(0,255,204,0.15)"; ctx.fillRect(W-52, 5, 46, 20);
          ctx.fillStyle = "#00ffcc"; ctx.fillText(zoom.toFixed(1)+"×", W-6, 19);
          ctx.textAlign = "left";
        }

        // LIVE badge
        if (sp > 0) {
          ctx.font = "bold 10px monospace"; ctx.textAlign = "right";
          ctx.fillStyle = "rgba(0,255,100,0.12)"; ctx.fillRect(W-60, zoom>1 ? 28 : 5, 54, 20);
          ctx.fillStyle = "#00ff88"; ctx.fillText("● LIVE", W-6, zoom>1 ? 42 : 19);
          ctx.textAlign = "left";
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
        <canvas
          key={cfg.key + cfg.label}
          ref={el => canvasRefs.current[idx] = el}
          width={2400}
          height={cfg.height || 120}
          style={{ width: "100%", height: cfg.height || 120, display: "block", borderRadius: 5, border: "1px solid #0d2828" }}
        />
      ))}
    </div>
  );
}

// ── Spectrum Canvas ──
function SpecCanvas({ lines }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas || !lines.length) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = "#030d0d"; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = "#0b2222"; ctx.lineWidth = 1;
    for (let i=1;i<6;i++){const y=(i/6)*H; ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    const freqs = lines.map(l=>l.f);
    const maxA = Math.max(...lines.map(l=>l.amp),0.001);
    const fMin = Math.min(...freqs), fMax = Math.max(...freqs);
    const pad = (fMax-fMin)*0.4||2500;
    const fLo = fMin-pad, fHi = fMax+pad;
    const toX = f => 40+((f-fLo)/(fHi-fLo))*(W-80);
    const toY = a => H-40-(a/maxA)*(H-80);
    ctx.strokeStyle="#1a4040"; ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(0,H-40);ctx.lineTo(W,H-40);ctx.stroke();
    ctx.fillStyle="#2a5555"; ctx.font="11px monospace"; ctx.textAlign="center";
    for(let i=0;i<=10;i++){
      const f=fLo+i*(fHi-fLo)/10;
      ctx.fillText((f/1000).toFixed(1)+"k", toX(f), H-14);
    }
    lines.forEach(line=>{
      const x=toX(line.f), y=toY(line.amp);
      ctx.strokeStyle=line.color; ctx.lineWidth=4;
      ctx.shadowColor=line.color; ctx.shadowBlur=14;
      ctx.beginPath();ctx.moveTo(x,H-40);ctx.lineTo(x,y);ctx.stroke();
      ctx.shadowBlur=0;
      ctx.fillStyle=line.color;
      ctx.beginPath();ctx.arc(x,y,6,0,TWO_PI);ctx.fill();
      ctx.font="bold 13px 'Courier New',monospace"; ctx.textAlign="center";
      ctx.fillStyle="rgba(0,0,0,0.75)"; ctx.fillRect(x-30,y-30,60,20);
      ctx.fillStyle=line.color; ctx.fillText(line.label,x,y-15);
      ctx.fillStyle="#3a8080"; ctx.font="11px monospace";
      ctx.fillText("A="+line.amp.toFixed(3),x,y+18);
    });
    ctx.textAlign="left";
  }, [lines]);
  return <canvas ref={ref} width={2400} height={260}
    style={{ width:"100%", height:260, display:"block", borderRadius:5, border:"1px solid #0d2828" }} />;
}

// ── Phasor Canvas ──
function PhasorCanvas({ mu, mode }) {
  const ref = useRef(null); const raf = useRef(null); const angle = useRef(0);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const cx = W/2, cy = H/2, R = Math.min(W,H)/2 - 24;
    const draw = () => {
      angle.current += 0.022; const a = angle.current;
      ctx.clearRect(0,0,W,H); ctx.fillStyle="#030d0d"; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle="#0d2828"; ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(cx,cy,R,0,TWO_PI);ctx.stroke();
      ctx.strokeStyle="#163030";
      ctx.beginPath();ctx.moveTo(cx-R-6,cy);ctx.lineTo(cx+R+6,cy);ctx.stroke();
      ctx.beginPath();ctx.moveTo(cx,cy-R-6);ctx.lineTo(cx,cy+R+6);ctx.stroke();
      const cLen=R*0.68, ex=cx+cLen*Math.cos(a), ey=cy-cLen*Math.sin(a);
      ctx.strokeStyle="#00ffcc"; ctx.lineWidth=3; ctx.shadowColor="#00ffcc"; ctx.shadowBlur=10;
      ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(ex,ey);ctx.stroke();
      ctx.fillStyle="#00ffcc"; ctx.beginPath();ctx.arc(ex,ey,5,0,TWO_PI);ctx.fill();
      ctx.shadowBlur=0;
      if(mode==="dsbfc"||mode==="dsbsc"){
        const sbLen=R*0.3*Math.min(Math.max(mu,0.1),1.5);
        const usbX=ex+sbLen*Math.cos(2*a), usbY=ey-sbLen*Math.sin(2*a);
        const lsbX=ex+sbLen, lsbY=ey;
        ctx.strokeStyle="#ff6b6b"; ctx.lineWidth=2.5; ctx.shadowColor="#ff6b6b"; ctx.shadowBlur=6;
        ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(usbX,usbY);ctx.stroke();
        ctx.fillStyle="#ff6b6b"; ctx.beginPath();ctx.arc(usbX,usbY,4,0,TWO_PI);ctx.fill();
        ctx.strokeStyle="#6bf5ff"; ctx.shadowColor="#6bf5ff";
        ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(lsbX,lsbY);ctx.stroke();
        ctx.fillStyle="#6bf5ff"; ctx.beginPath();ctx.arc(lsbX,lsbY,4,0,TWO_PI);ctx.fill();
        ctx.shadowBlur=0;
      }
      const legend=[["#00ffcc","Carrier"],...(mode==="dsbfc"||mode==="dsbsc"?[["#ff6b6b","USB"],["#6bf5ff","LSB"]]:[]),(mode==="ssb"?[["#ff6b6b","USB only"]]:[])].flat(1);
      let li=0;
      for(let i=0;i<legend.length;i+=2){
        ctx.fillStyle=legend[i]; ctx.font="bold 12px monospace";
        ctx.fillText("● "+legend[i+1], 8, 18+li*16); li++;
      }
      raf.current=requestAnimationFrame(draw);
    };
    raf.current=requestAnimationFrame(draw);
    return ()=>cancelAnimationFrame(raf.current);
  },[mu,mode]);
  return <canvas ref={ref} width={320} height={320}
    style={{width:320,height:320,flexShrink:0,borderRadius:5,border:"1px solid #0d2828"}} />;
}

// ── Demod Theory ──
function DemodTheory({ mode }) {
  const info = {
    dsbfc: { title:"DSB-FC  —  Envelope Detection", color:"#00ffcc", steps:["Rectify the signal (half or full-wave rectifier)","RC low-pass filter smooths the rectified output envelope","DC block capacitor removes the Ac offset","Output ≈ Ac · μ · m(t)  ✓ No phase reference needed — simple & robust"] },
    dsbsc: { title:"DSB-SC  —  Synchronous (Coherent) Detection", color:"#6bf5ff", steps:["Multiply received s(t) by locally generated cos(2πfc·t)","Low-pass filter removes the double-frequency 2fc term","Output = m(t)/2  — requires a phase-locked local oscillator","⚠  Envelope detection FAILS here due to phase ambiguity"] },
    ssb:   { title:"SSB-USB  —  Coherent Detection", color:"#ff6b6b", steps:["Multiply by cos(2πfc·t) from a phase-locked oscillator","Low-pass filter extracts the baseband signal","Very sensitive to frequency offset / phase errors","Half-power output vs original — but half the bandwidth"] },
    vsb:   { title:"VSB  —  Coherent + Equalizer Filter", color:"#ffcc44", steps:["Coherent demodulation same as SSB","Vestigial equalizer filter corrects edge rolloff","Used in broadcast TV (NTSC/PAL/ATSC DVB)","Best compromise: near-SSB bandwidth + DSB robustness"] },
  };
  const d = info[mode];
  return (
    <div style={{background:"#040e0e",border:`1px solid ${d.color}35`,borderRadius:7,padding:16,marginTop:12}}>
      <div style={{color:d.color,fontSize:13,fontWeight:"bold",marginBottom:12,letterSpacing:1}}>{d.title}</div>
      {d.steps.map((s,i)=>(
        <div key={i} style={{display:"flex",gap:12,marginBottom:9,fontSize:12,color:"#6aadad",lineHeight:1.6}}>
          <span style={{color:d.color,flexShrink:0,fontWeight:"bold",minWidth:52}}>Step {i+1}.</span>
          <span>{s}</span>
        </div>
      ))}
    </div>
  );
}

// ── Signal Shape Mini-Preview ──
function SignalPreview({ type, color, dutyCycle = 0.5 }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H); ctx.fillStyle="#020b0b"; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle="#0b2020"; ctx.lineWidth=0.5;
    ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);ctx.stroke();
    ctx.strokeStyle=color; ctx.lineWidth=2; ctx.shadowColor=color; ctx.shadowBlur=5;
    ctx.beginPath();
    const pts=300;
    for(let i=0;i<pts;i++){
      const phase=(i/pts)*TWO_PI*2.5;
      const v=generateSignalSample(type,phase,dutyCycle);
      const x=(i/pts)*W, y=H/2-v*(H/2-4);
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    ctx.stroke(); ctx.shadowBlur=0;
  },[type,color,dutyCycle]);
  return <canvas ref={ref} width={140} height={44}
    style={{width:140,height:44,borderRadius:4,border:"1px solid #0c2222",display:"block"}} />;
}

// ── Reusable UI ──
function Slider({ label, val, min, max, step, unit, onChange, color="#00ffcc" }) {
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
        <span style={{color:"#4a9090",fontSize:11,fontFamily:"monospace"}}>{label}</span>
        <span style={{color,fontSize:12,fontFamily:"monospace",fontWeight:"bold"}}>
          {typeof val==="number"?(val<10?val.toFixed(2):Math.round(val)):val}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={val}
        onChange={e=>onChange(parseFloat(e.target.value))}
        style={{width:"100%",accentColor:color,cursor:"pointer",height:4}} />
    </div>
  );
}

function MCard({ label, val, color="#00ffcc", sub }) {
  return (
    <div style={{flex:"1 1 110px",background:"#040e0e",borderRadius:7,border:`1px solid ${color}30`,padding:"11px 14px"}}>
      <div style={{color:"#2a6868",fontSize:10,fontFamily:"monospace",marginBottom:3}}>{label}</div>
      <div style={{color,fontSize:16,fontFamily:"monospace",fontWeight:"bold"}}>{val}</div>
      {sub&&<div style={{color:"#2a6060",fontSize:10,marginTop:3}}>{sub}</div>}
    </div>
  );
}

const btnStyle = (active, color="#00ffcc") => ({
  padding:"6px 15px", cursor:"pointer", fontSize:11,
  fontFamily:"monospace", fontWeight:"bold",
  background: active?`${color}20`:"transparent",
  color: active?color:"#2a6868",
  border:`1px solid ${active?color+"66":"#0d2828"}`,
  borderRadius:4, transition:"all 0.15s", letterSpacing:0.5,
  whiteSpace:"nowrap",
});

const SIG_TYPES = [
  { id:"sine",     label:"Sine",     color:"#00ffcc" },
  { id:"square",   label:"Square",   color:"#ff6b6b" },
  { id:"triangle", label:"Triangle", color:"#ffcc44" },
  { id:"sawtooth", label:"Sawtooth", color:"#b86bff" },
  { id:"pulse",    label:"Pulse",    color:"#6bf5ff" },
];

// ══════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════
export default function AMToolbox() {
  const [mode,      setMode]      = useState("dsbfc");
  const [tone,      setTone]      = useState("single");
  const [tab,       setTab]       = useState("time");
  const [showEnv,   setShowEnv]   = useState(true);
  const [cycles,    setCycles]    = useState(4);
  const [animSpeed, setAnimSpeed] = useState(1);
  const [sigType,   setSigType]   = useState("sine");
  const [dutyCycle, setDutyCycle] = useState(0.5);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const [noiseOn,   setNoiseOn]   = useState(false);
  const [snrDb,     setSnrDb]     = useState(20);
  const [Am1, setAm1] = useState(1.0);
  const [Am2, setAm2] = useState(0.5);
  const [Ac,  setAc]  = useState(2.0);
  const [fm1, setFm1] = useState(1000);
  const [fm2, setFm2] = useState(1500);
  const [fc,  setFc]  = useState(10000);
  const [mu1, setMu1] = useState(0.5);
  const [mu2, setMu2] = useState(0.3);
  const [phi1,setPhi1]= useState(0);
  const [phi2,setPhi2]= useState(0);

  const params = { mode,sigType,tone,Am1,Am2,Ac,fm1,fm2,fc,mu1,mu2,phi1,phi2,cycles,dutyCycle,snrDb,noiseOn };
  const specLines = useMemo(()=>buildSpectrum(params),[mode,tone,Am1,Am2,Ac,fm1,fm2,fc,mu1,mu2]);
  const metrics   = useMemo(()=>buildMetrics(params), [mode,tone,Am1,Am2,Ac,fm1,fm2,mu1,mu2]);
  const muDisp    = mode==="dsbfc"?(tone==="single"?mu1:Math.sqrt(mu1**2+mu2**2)):0;
  const sigColor  = SIG_TYPES.find(s=>s.id===sigType)?.color||"#00ffcc";

  const handleZoomIn    = useCallback(()=>setZoomLevel(z=>Math.min(z*2,32)),[]);
  const handleZoomOut   = useCallback(()=>setZoomLevel(z=>{const n=Math.max(z/2,1);if(n===1)setPanOffset(0);return n;}),[]);
  const handleZoomReset = useCallback(()=>{setZoomLevel(1);setPanOffset(0);},[]);
  const handlePanLeft   = useCallback(()=>setPanOffset(p=>Math.max(0,p-0.08/zoomLevel)),[zoomLevel]);
  const handlePanRight  = useCallback(()=>setPanOffset(p=>Math.min(1-1/zoomLevel,p+0.08/zoomLevel)),[zoomLevel]);

  const zoomContainerRef = useRef(null);
  useEffect(()=>{
    const el=zoomContainerRef.current; if(!el)return;
    const onWheel=e=>{
      e.preventDefault();
      if(e.deltaY<0) setZoomLevel(z=>Math.min(z*1.25,32));
      else setZoomLevel(z=>{const n=Math.max(z/1.25,1);if(n<=1.01)setPanOffset(0);return n;});
    };
    el.addEventListener("wheel",onWheel,{passive:false});
    return()=>el.removeEventListener("wheel",onWheel);
  },[]);

  const timeWaves = useMemo(()=>[
    {key:"msg",       label:`m(t)  ——  Message  [${SIG_TYPES.find(s=>s.id===sigType)?.label} Wave]`, color:sigColor, height:130},
    {key:"carrier",   label:"c(t)  ——  Carrier Wave",                                                color:"#3ab0b0", height:110},
    {key:"modulated", label:"s(t)  ——  Modulated Signal",                                            color:"#00ffcc", height:160, showEnv},
  ],[showEnv,sigType,sigColor]);

  const demodWaves = useMemo(()=>[
    {key:"modulated",   label:"s(t)  ——  Received (Modulated Input)",  color:"#00ffcc", height:140, showEnv},
    {key:"envelope",    label:"env(t)  ——  Detected Envelope",          color:"#ffcc44", height:110},
    {key:"demodulated", label:"m′(t)  ——  Recovered Message",           color:sigColor,  height:130},
    {key:"msg",         label:"m(t)  ——  Original Reference",           color:sigColor+"55", height:110},
  ],[showEnv,sigColor]);

  return (
    // ── outermost shell: full viewport width, horizontal scroll allowed ──
    <div style={{
      minWidth:"100vw",          // always AT LEAST the full viewport
      width:"100%",
      minHeight:"100vh",
      background:"#010c0c",
      color:"#c0dada",
      fontFamily:"'Courier New',monospace",
      boxSizing:"border-box",
      overflowX:"auto",          // scroll rather than squish
    }}>
      {/* ── inner wrapper: generous padding, no max-width cap ── */}
      <div style={{padding:"12px 24px 32px", minWidth:0}}>

        {/* ── HEADER ── */}
        <div style={{marginBottom:14,paddingBottom:10,borderBottom:"1px solid #0c2828",
          display:"flex",alignItems:"baseline",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
          <div style={{display:"flex",alignItems:"baseline",gap:16}}>
            <h1 style={{margin:0,fontSize:24,color:"#00ffcc",letterSpacing:5,textShadow:"0 0 24px #00ffcc66"}}>
              ◈ AM SIGNAL TOOLBOX
            </h1>
            <span style={{color:"#1a5858",fontSize:12}}>EC401 · Analog Communication · MAKAUT</span>
          </div>
          <span style={{color:"#1a5858",fontSize:11}}>v5.1 — Full Width · Signal Shapes · Zoom · Noise</span>
        </div>

        {/* ── BODY: sidebar + main ── */}
        <div style={{display:"flex",gap:16,alignItems:"flex-start"}}>

          {/* ════ LEFT SIDEBAR ════ */}
          <div style={{
            width:256, flexShrink:0,
            background:"#040f0f",borderRadius:9,border:"1px solid #0a2424",
            padding:14, overflowY:"auto",
            maxHeight:"calc(100vh - 90px)", position:"sticky", top:12,
            boxSizing:"border-box",
          }}>

            {/* Mode */}
            <div style={{marginBottom:13}}>
              <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,marginBottom:7,fontWeight:"bold"}}>MODULATION MODE</div>
              {[["dsbfc","DSB-FC  (full carrier)"],["dsbsc","DSB-SC  (suppressed)"],["ssb","SSB-USB  (single side)"],["vsb","VSB  (vestigial)"]].map(([v,l])=>(
                <button key={v} onClick={()=>setMode(v)}
                  style={{...btnStyle(mode===v),display:"block",width:"100%",marginBottom:4,textAlign:"left"}}>{l}</button>
              ))}
            </div>

            {/* Tone */}
            <div style={{marginBottom:13}}>
              <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,marginBottom:7,fontWeight:"bold"}}>TONE TYPE</div>
              <div style={{display:"flex",gap:5}}>
                {[["single","Single Tone"],["double","Double Tone"]].map(([v,l])=>(
                  <button key={v} onClick={()=>setTone(v)} style={{...btnStyle(tone===v),flex:1,textAlign:"center",fontSize:10}}>{l}</button>
                ))}
              </div>
            </div>

            {/* Animation */}
            <div style={{marginBottom:13,background:"#020a0a",border:"1px solid #0c3030",borderRadius:6,padding:"10px 10px 6px"}}>
              <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,marginBottom:7,fontWeight:"bold"}}>ANIMATION</div>
              <Slider label="Scroll Speed" val={animSpeed} min={0} max={10} step={0.5} unit="×"
                onChange={setAnimSpeed} color={animSpeed===0?"#ffcc44":"#00ff88"} />
              <div style={{fontSize:10,color:animSpeed===0?"#ffcc44":"#00ff88",marginTop:-3,marginBottom:2}}>
                {animSpeed===0?"⏸ FROZEN — stable view":`▶ LIVE — speed ${animSpeed}×`}
              </div>
            </div>

            {/* Carrier */}
            <div style={{borderTop:"1px solid #0a2424",paddingTop:10,marginBottom:8}}>
              <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,marginBottom:7,fontWeight:"bold"}}>CARRIER</div>
              <Slider label="Ac — Amplitude" val={Ac} min={0.5} max={5} step={0.1} unit=" V" onChange={setAc} />
              <Slider label="fc — Frequency"  val={fc} min={2000} max={50000} step={500} unit=" Hz" onChange={setFc} color="#6bf5ff" />
            </div>

            {/* Message 1 */}
            <div style={{borderTop:"1px solid #0a2424",paddingTop:10,marginBottom:8}}>
              <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,marginBottom:7,fontWeight:"bold"}}>MESSAGE 1</div>
              <Slider label="Am₁ — Amplitude" val={Am1} min={0.1} max={5} step={0.1} unit=" V" onChange={setAm1} color="#ff6b6b" />
              <Slider label="fm₁ — Frequency"  val={fm1} min={100} max={5000} step={50} unit=" Hz" onChange={setFm1} color="#ff6b6b" />
              {mode==="dsbfc"&&<Slider label="μ₁ — Mod. Index" val={mu1} min={0.01} max={2} step={0.01} unit="" onChange={setMu1} color="#ff6b6b" />}
              <Slider label="φ₁ — Phase" val={phi1} min={-180} max={180} step={5} unit="°" onChange={setPhi1} color="#ff6b6b" />
            </div>

            {/* Message 2 */}
            {tone==="double"&&(
              <div style={{borderTop:"1px solid #0a2424",paddingTop:10,marginBottom:8}}>
                <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,marginBottom:7,fontWeight:"bold"}}>MESSAGE 2</div>
                <Slider label="Am₂ — Amplitude" val={Am2} min={0.1} max={5} step={0.1} unit=" V" onChange={setAm2} color="#ffcc44" />
                <Slider label="fm₂ — Frequency"  val={fm2} min={100} max={5000} step={50} unit=" Hz" onChange={setFm2} color="#ffcc44" />
                {mode==="dsbfc"&&<Slider label="μ₂ — Mod. Index" val={mu2} min={0.01} max={2} step={0.01} unit="" onChange={setMu2} color="#ffcc44" />}
                <Slider label="φ₂ — Phase" val={phi2} min={-180} max={180} step={5} unit="°" onChange={setPhi2} color="#ffcc44" />
              </div>
            )}

            {/* Display */}
            <div style={{borderTop:"1px solid #0a2424",paddingTop:10}}>
              <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,marginBottom:7,fontWeight:"bold"}}>DISPLAY</div>
              <Slider label="Cycles Shown" val={cycles} min={1} max={10} step={1} unit="" onChange={setCycles} color="#b86bff" />
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginTop:7}}>
                <input type="checkbox" checked={showEnv} onChange={e=>setShowEnv(e.target.checked)} style={{accentColor:"#ffcc44"}} />
                <span style={{color:"#4a9090",fontSize:11}}>Show envelope trace</span>
              </label>
            </div>
          </div>

          {/* ════ MAIN PANEL ════ */}
          <div style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",gap:12}}>

            {/* ── Signal Type + Noise row ── */}
            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"stretch"}}>

              {/* Signal Shape */}
              <div style={{background:"#040f0f",border:"1px solid #0a2828",borderRadius:8,padding:"12px 16px",flex:"2 1 400px"}}>
                <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,marginBottom:10,fontWeight:"bold"}}>MESSAGE SIGNAL SHAPE</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                  {SIG_TYPES.map(({id,label,color})=>(
                    <div key={id} onClick={()=>setSigType(id)} style={{
                      cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:5,
                      background:sigType===id?`${color}15`:"transparent",
                      border:`1px solid ${sigType===id?color+"66":"#0d2828"}`,
                      borderRadius:6,padding:"8px 10px",transition:"all 0.15s",
                    }}>
                      <SignalPreview type={id} color={color} dutyCycle={dutyCycle} />
                      <span style={{color:sigType===id?color:"#2a6868",fontSize:11,fontWeight:"bold",fontFamily:"monospace"}}>{label}</span>
                    </div>
                  ))}
                </div>
                {sigType==="pulse"&&(
                  <div style={{marginTop:10,maxWidth:360}}>
                    <Slider label="Duty Cycle" val={dutyCycle} min={0.05} max={0.95} step={0.05} unit="" onChange={setDutyCycle} color="#6bf5ff" />
                  </div>
                )}
              </div>

              {/* Noise */}
              <div style={{background:"#040f0f",border:`1px solid ${noiseOn?"#ff6b6b44":"#0a2828"}`,borderRadius:8,padding:"12px 16px",flex:"1 1 220px"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                  <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,fontWeight:"bold"}}>AWGN NOISE</div>
                  <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer"}}>
                    <input type="checkbox" checked={noiseOn} onChange={e=>setNoiseOn(e.target.checked)} style={{accentColor:"#ff6b6b"}} />
                    <span style={{color:noiseOn?"#ff6b6b":"#2a6868",fontSize:11,fontWeight:"bold"}}>{noiseOn?"ENABLED":"OFF"}</span>
                  </label>
                </div>
                {noiseOn&&(
                  <>
                    <Slider label="SNR (dB)" val={snrDb} min={0} max={40} step={1} unit=" dB" onChange={setSnrDb} color="#ff6b6b" />
                    <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
                      {[0,5,10,20,30,40].map(v=>(
                        <button key={v} onClick={()=>setSnrDb(v)} style={{...btnStyle(snrDb===v,"#ff6b6b"),fontSize:10,padding:"3px 9px"}}>{v}dB</button>
                      ))}
                    </div>
                    <div style={{fontSize:11,color:snrDb<5?"#ff4444":snrDb<15?"#ffcc44":"#00ff88",fontWeight:"bold"}}>
                      {snrDb<5?"⚠ Severe noise":snrDb<10?"⚠ Very noisy":snrDb<20?"△ Moderate noise":snrDb<30?"◎ Acceptable":"✓ Clean channel"}
                    </div>
                  </>
                )}
                {!noiseOn&&<div style={{color:"#1a4444",fontSize:11,marginTop:4,lineHeight:1.6}}>
                  Enable to inject Additive White<br/>Gaussian Noise into s(t)
                </div>}
              </div>
            </div>

            {/* ── Metrics row ── */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <MCard label="Total Power"   val={metrics.Pt+" W"}   sub="Pt = Pc + Psb" />
              <MCard label="Carrier Power" val={metrics.Pc+" W"}   color="#6bf5ff" sub="Pc = Ac²/2" />
              <MCard label="Efficiency"    val={metrics.eff+"%"}   color={parseFloat(metrics.eff)<50?"#ff6b6b":"#00ffcc"} sub="η = Psb / Pt" />
              <MCard label="Bandwidth"     val={metrics.bw}        color="#ffcc44" sub={mode==="ssb"?"BW = fm":mode==="vsb"?"BW ≈ 1.25·fm":"BW = 2·fm"} />
              {mode==="dsbfc"&&<MCard label="Mod. Index μ" val={metrics.muTot} color={metrics.overmod?"#ff4444":"#b86bff"} sub={metrics.overmod?"⚠ OVERMOD!":"μ < 1  ✓"} />}
              <MCard label="Signal Shape"  val={SIG_TYPES.find(s=>s.id===sigType)?.label} color={sigColor} sub={noiseOn?`SNR = ${snrDb} dB`:"No noise"} />
            </div>

            {/* Overmod warning */}
            {mode==="dsbfc"&&metrics.overmod&&(
              <div style={{background:"#1a0208",border:"1px solid #ff4444",borderRadius:6,padding:"9px 16px",fontSize:12,color:"#ff8080",lineHeight:1.7}}>
                ⚠  <strong>OVERMODULATION</strong>  —  μ = {metrics.muTot} &gt; 1  &nbsp;
                <span style={{fontSize:11,color:"#aa5555"}}>The envelope crosses zero → envelope detector output is clipped and distorted.</span>
              </div>
            )}

            {/* ── Tab bar ── */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {[["time","⟟ TIME DOMAIN"],["spectrum","⟝ SPECTRUM"],["phasor","⊙ PHASOR"],["demod","⟒ DEMOD LAB"]].map(([v,l])=>(
                <button key={v} onClick={()=>setTab(v)} style={btnStyle(tab===v)}>{l}</button>
              ))}
            </div>

            {/* ══ TIME DOMAIN ══ */}
            {tab==="time"&&(
              <div>
                {/* Zoom toolbar */}
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,flexWrap:"wrap",
                  background:"#040f0f",border:"1px solid #0a2828",borderRadius:6,padding:"8px 14px"}}>
                  <span style={{color:"#1e6060",fontSize:10,letterSpacing:1,fontWeight:"bold"}}>TIME DOMAIN  ·  THREE SIGNAL VIEW</span>
                  <div style={{flex:1,height:1,background:"#0a2424",minWidth:20}} />
                  <span style={{fontSize:10,color:"#1a5858"}}>🖱 scroll to zoom</span>

                  {/* Zoom buttons */}
                  <div style={{display:"flex",gap:4,alignItems:"center"}}>
                    <button onClick={handleZoomOut}  style={{...btnStyle(false),padding:"4px 12px",fontSize:16,lineHeight:1}}>−</button>
                    <div style={{background:"#021616",border:"1px solid #0a3030",borderRadius:4,
                      padding:"4px 14px",minWidth:60,textAlign:"center",
                      color:"#00ffcc",fontSize:13,fontFamily:"monospace",fontWeight:"bold"}}>
                      {zoomLevel.toFixed(1)}×
                    </div>
                    <button onClick={handleZoomIn}   style={{...btnStyle(false),padding:"4px 12px",fontSize:16,lineHeight:1}}>+</button>
                    <button onClick={handleZoomReset} style={{...btnStyle(zoomLevel===1),padding:"4px 12px",fontSize:10}}>RESET</button>
                  </div>

                  {/* Pan buttons (only when zoomed) */}
                  {zoomLevel>1&&(
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <span style={{color:"#2a6868",fontSize:10}}>PAN</span>
                      <button onClick={handlePanLeft}  style={{...btnStyle(false),padding:"4px 12px",fontSize:14}}>◀</button>
                      <div style={{background:"#021616",border:"1px solid #0a3030",borderRadius:4,
                        padding:"4px 10px",minWidth:50,textAlign:"center",
                        color:"#4a9090",fontSize:10,fontFamily:"monospace"}}>
                        {(panOffset*100).toFixed(0)}%
                      </div>
                      <button onClick={handlePanRight} style={{...btnStyle(false),padding:"4px 12px",fontSize:14}}>▶</button>
                    </div>
                  )}

                  <span style={{fontSize:10,color:animSpeed===0?"#ffcc44":"#00ff88",marginLeft:"auto"}}>
                    {animSpeed===0?"⏸ FROZEN":`▶ SCROLLING ${animSpeed}×`}
                  </span>
                </div>

                <div ref={zoomContainerRef}>
                  <AnimatedWaves params={params} speed={animSpeed} showEnv={showEnv}
                    waveConfigs={timeWaves} zoomLevel={zoomLevel} panOffset={panOffset} />
                </div>
              </div>
            )}

            {/* ══ SPECTRUM ══ */}
            {tab==="spectrum"&&(
              <div>
                <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,marginBottom:10,fontWeight:"bold"}}>
                  FREQUENCY DOMAIN  ·  SPECTRAL LINE DIAGRAM
                </div>
                <SpecCanvas lines={specLines} />
                <div style={{marginTop:10,display:"flex",gap:8,flexWrap:"wrap"}}>
                  {specLines.map((l,i)=>(
                    <div key={i} style={{background:"#040e0e",border:`1px solid ${l.color}30`,borderRadius:5,padding:"8px 14px",fontSize:11}}>
                      <span style={{color:l.color,fontWeight:"bold"}}>{l.label}</span>
                      <span style={{color:"#4a9090",marginLeft:10}}>{(l.f/1000).toFixed(2)} kHz</span>
                      <span style={{color:"#2a7070",marginLeft:10}}>A = {l.amp.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:10,fontSize:12,color:"#2a7070",lineHeight:1.8,
                  background:"#040e0e",border:"1px solid #0d2828",borderRadius:5,padding:"10px 14px"}}>
                  <strong style={{color:"#1e6060"}}>Bandwidth:</strong>{" "}
                  {mode==="dsbfc"&&`DSB-FC  BW = 2 × fm = ${(2*fm1/1000).toFixed(2)} kHz`}
                  {mode==="dsbsc"&&`DSB-SC  BW = 2 × fm = ${(2*fm1/1000).toFixed(2)} kHz  (no carrier power)`}
                  {mode==="ssb"  &&`SSB  BW = fm = ${(fm1/1000).toFixed(2)} kHz  (half of DSB)`}
                  {mode==="vsb"  &&`VSB  BW ≈ 1.25 × fm = ${(1.25*fm1/1000).toFixed(2)} kHz`}
                  {noiseOn&&<span style={{color:"#ff6b6b",marginLeft:16}}>⚠ SNR = {snrDb} dB</span>}
                </div>
              </div>
            )}

            {/* ══ PHASOR ══ */}
            {tab==="phasor"&&(
              <div style={{display:"flex",gap:24,alignItems:"flex-start",flexWrap:"wrap"}}>
                <PhasorCanvas mu={muDisp} mode={mode} />
                <div style={{flex:1,minWidth:260}}>
                  <div style={{color:"#1e6060",fontSize:10,letterSpacing:2,marginBottom:12,fontWeight:"bold"}}>PHASOR REPRESENTATION</div>
                  <div style={{fontSize:13,color:"#4a9090",lineHeight:2.1}}>
                    {mode==="dsbfc"&&<>
                      <div style={{color:"#00ffcc",fontWeight:"bold",marginBottom:6}}>DSB-FC  =  Carrier + USB + LSB</div>
                      <div>s(t) = Ac·cos(2πfc·t)</div>
                      <div style={{paddingLeft:20,color:"#ff8080"}}>+  (μ·Ac/2)·cos(2π(fc+fm)·t)  ←  Upper Sideband</div>
                      <div style={{paddingLeft:20,color:"#7aeeff"}}>+  (μ·Ac/2)·cos(2π(fc−fm)·t)  ←  Lower Sideband</div>
                      <div style={{marginTop:10,color:muDisp>1?"#ff4444":"#b86bff",fontWeight:"bold"}}>
                        μ = {muDisp.toFixed(3)}  {muDisp>1?"⚠  OVERMODULATION":"✓  Normal"}
                      </div>
                    </>}
                    {mode==="dsbsc"&&<>
                      <div style={{color:"#6bf5ff",fontWeight:"bold",marginBottom:6}}>DSB-SC  =  USB + LSB  (no carrier)</div>
                      <div>s(t) = m(t) · cos(2πfc·t)</div>
                      <div style={{paddingLeft:20,color:"#ff8080"}}>=  (Am/2)·cos(2π(fc+fm)·t)  ←  USB</div>
                      <div style={{paddingLeft:20,color:"#7aeeff"}}>+  (Am/2)·cos(2π(fc−fm)·t)  ←  LSB</div>
                      <div style={{marginTop:10,color:"#4a7070",fontSize:12}}>Carrier suppressed → 100% power efficiency</div>
                    </>}
                    {mode==="ssb"&&<>
                      <div style={{color:"#ff6b6b",fontWeight:"bold",marginBottom:6}}>SSB-USB  =  Upper Sideband Only</div>
                      <div>s(t) = (Am/2)·cos(2π(fc+fm)·t)</div>
                      <div style={{marginTop:10,color:"#4a7070",fontSize:12}}>Half the bandwidth of DSB · Coherent demodulation required</div>
                    </>}
                    {mode==="vsb"&&<>
                      <div style={{color:"#ffcc44",fontWeight:"bold",marginBottom:6}}>VSB  =  USB + Vestigial LSB</div>
                      <div>s(t) = (Am/2)·cos(2π(fc+fm)·t)</div>
                      <div style={{paddingLeft:20,color:"#7aeeff"}}>+  (Am/8)·cos(2π(fc−fm)·t)  ←  Vestige</div>
                      <div style={{marginTop:10,color:"#4a7070",fontSize:12}}>BW ≈ 1.25·fm · Used in TV broadcast (NTSC/PAL)</div>
                    </>}
                  </div>
                  <div style={{marginTop:16,background:"#040e0e",border:"1px solid #0d2828",borderRadius:6,padding:12}}>
                    <div style={{color:"#1e6060",fontSize:10,letterSpacing:1,marginBottom:8,fontWeight:"bold"}}>SIGNAL SHAPE — HARMONIC CONTENT</div>
                    <div style={{fontSize:12,color:"#4a8080",lineHeight:1.8}}>
                      <div><span style={{color:sigColor}}>▸ {SIG_TYPES.find(s=>s.id===sigType)?.label} wave</span> — currently selected</div>
                      {sigType==="sine"     &&<div>Pure single tone — only the fundamental frequency. Minimal spectral spread.</div>}
                      {sigType==="square"   &&<div>Fundamental + <strong style={{color:"#ffcc44"}}>odd harmonics only</strong> (3rd, 5th, 7th…) with 1/n amplitude rolloff. Significant bandwidth.</div>}
                      {sigType==="triangle" &&<div>Odd harmonics with <strong style={{color:"#ffcc44"}}>1/n² rolloff</strong>. Smoother than square — softer corners.</div>}
                      {sigType==="sawtooth" &&<div><strong style={{color:"#ffcc44"}}>All harmonics</strong> present (1/n rolloff). Very wide spectrum — sharp rising/falling edges.</div>}
                      {sigType==="pulse"    &&<div>Duty cycle = {(dutyCycle*100).toFixed(0)}%. <strong style={{color:"#ffcc44"}}>Sinc-envelope</strong> spectrum — harmonics at null every 1/τ Hz.</div>}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ══ DEMOD LAB ══ */}
            {tab==="demod"&&(
              <div>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10,
                  background:"#040f0f",border:"1px solid #0a2828",borderRadius:6,padding:"8px 14px",flexWrap:"wrap"}}>
                  <span style={{color:"#1e6060",fontSize:10,letterSpacing:1,fontWeight:"bold"}}>
                    DEMODULATION LAB  ·  {
                      mode==="dsbfc"?"ENVELOPE DETECTION":
                      mode==="dsbsc"?"SYNCHRONOUS DETECTION":
                      mode==="ssb" ?"COHERENT DETECTION":
                      "COHERENT + VSB FILTER"}
                  </span>
                  <div style={{flex:1,height:1,background:"#0a2424",minWidth:20}} />
                  <span style={{fontSize:10,color:animSpeed===0?"#ffcc44":"#00ff88"}}>
                    {animSpeed===0?"⏸ FROZEN":`▶ LIVE`}
                  </span>
                </div>
                <AnimatedWaves params={params} speed={animSpeed} showEnv={showEnv}
                  waveConfigs={demodWaves} zoomLevel={1} panOffset={0} />
                <DemodTheory mode={mode} />
              </div>
            )}

          </div>{/* end main panel */}
        </div>{/* end body */}
      </div>{/* end inner wrapper */}
    </div>   /* end outermost shell */
  );
}
import { useState, useEffect, useRef, useCallback } from "react";

/*
  MISTR SLÁDEK v5 — dotykový kiosek (Czech Beer Museum)
  Přidáno oproti v4 (feedback Martin):
   • Nindža: výskok škálovaný výškou plátna → chmel létá vysoko (ne jen 30–50 % plochy).
   • Stáčení: přepracováno na jasnou zelenou cílovou ZÓNU + cue "PUSŤ!".
   • Instrukční karta před KAŽDOU minihrou (co mám dělat).
   • Countdown 3-2-1 před časovkami (nindža / kvasnice / tlak).
*/

const C = {
  bg: "#241405", bg2: "#34200C", panel: "#3E2810",
  copper: "#C8852F", brass: "#E0A745", gold: "#F5C542",
  beer: "#E8A23E", beerDeep: "#B5701C", foam: "#F5EFE0", cream: "#EFE3CE",
  ink: "#1A0E03", green: "#7FB04A", greenDeep: "#4C7A28", wrong: "#A8432E",
  blue: "#4FA3D1", ale: "#C9772A", line: "rgba(245,239,224,0.14)",
};

const STEPS = [
  { id: "rmutovani", name: "Rmutování", icon: "🔥", verb: "DRHNI KOTEL!", timed: false,
    how: "Jezdi prstem po kotli sem a tam a vyhřej ho. Drž teplotu v zelené zóně (62–72 °C).",
    fact: "Při 62–72 °C dělají enzymy ze sladu zkvasitelný cukr." },
  { id: "scezovani", name: "Scezování", icon: "🪣", verb: "PUMPUJ!", timed: false,
    how: "Mačkej tlačítko PUMPUJ co nejrychleji, dokud nádobu nenaplníš až nahoru.",
    fact: "Protlačením přes mláto získáš sladinu. Mláto jde dobytku jako krmivo." },
  { id: "chmelovar", name: "Chmelovar", icon: "🌿", verb: "SEKEJ CHMEL!", timed: true,
    how: "Přejížděj prstem přes letící chmel 🌿 a sekej ho. Ponožkám 🧦 se vyhni!",
    fact: "Chmel dodá pivu hořkost a vůni. Ponožky do várky fakt nepatří." },
  { id: "kvaseni", name: "Kvašení", icon: "🫧", verb: "CHYTEJ KVASNICE!", timed: true,
    how: "Klepej na padající kvasnice. Čeho chytíš víc — modrých (ležák) nebo oranžových (ale) — takový styl piva uvaříš.",
    fact: "Kvasnice mění cukr na alkohol a CO₂. Chladné = ležák, teplé = ale." },
  { id: "zrani", name: "Zrání", icon: "💥", verb: "KROŤ TLAK!", timed: true,
    how: "Klepej na bubliny a propichuj je dřív, než prasknou samy a zvednou tlak v kádi.",
    fact: "Při zrání vzniká CO₂. V sklepě se tlak musí hlídat, ať káď nevybuchne." },
];

const IDLE_MS = 30000;

// ---------- procedural Web Audio ----------
const Sfx = (() => {
  let ctx = null, master = null, enabled = true;
  const ensure = () => {
    if (typeof window === "undefined") return;
    if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.32; master.connect(ctx.destination); }
    if (ctx.state === "suspended") ctx.resume();
  };
  const tone = (freq, dur, type = "sine", vol = 0.3, slideTo) => {
    if (!enabled || !ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur);
  };
  const noise = (dur, vol = 0.3, freq = 1000, type = "lowpass") => {
    if (!enabled || !ctx) return;
    const n = ctx.createBufferSource(); const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; n.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    n.connect(f); f.connect(g); g.connect(master); n.start(); n.stop(ctx.currentTime + dur);
  };
  return {
    resume: ensure, setEnabled: (v) => { enabled = v; }, isEnabled: () => enabled,
    click: () => tone(660, 0.06, "square", 0.18),
    beep: (hi) => tone(hi ? 780 : 520, 0.12, "square", 0.25),
    heat: () => noise(0.05, 0.05, 2600, "highpass"),
    pump: () => tone(170, 0.1, "square", 0.22, 95),
    splash: () => { tone(520, 0.16, "triangle", 0.28, 900); noise(0.1, 0.12, 1300); },
    sock: () => { tone(120, 0.25, "sawtooth", 0.28, 60); noise(0.18, 0.18, 400); },
    plink: (hi) => tone(hi ? 720 : 430, 0.12, "sine", 0.28, hi ? 920 : 560),
    pop: () => tone(880, 0.08, "sine", 0.3, 300),
    success: () => [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, "triangle", 0.26), i * 70)),
    fail: () => tone(190, 0.3, "sawtooth", 0.22, 80),
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.24, "triangle", 0.28), i * 95)),
  };
})();

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy, ex = px - cx, ey = py - cy; return Math.sqrt(ex * ex + ey * ey);
}
function useShake() {
  const ref = useRef(null);
  const shake = useCallback(() => { const el = ref.current; if (!el) return; el.classList.remove("shk"); void el.offsetWidth; el.classList.add("shk"); }, []);
  return [ref, shake];
}

// ===================================================================
export default function App() {
  const [phase, setPhase] = useState("attract");
  const [idx, setIdx] = useState(0);
  const [scores, setScores] = useState({});
  const [style, setStyle] = useState("lezak");
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const l = document.createElement("link"); l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Inter:wght@600;700;900&display=swap";
    document.head.appendChild(l); return () => { try { document.head.removeChild(l); } catch (e) {} };
  }, []);

  const qv = Object.values(scores);
  const quality = qv.length ? Math.round(qv.reduce((a, b) => a + b, 0) / qv.length) : 0;
  const progress = phase === "result" ? 1 : phase === "step" ? idx / STEPS.length : 0;

  const finish = (id, s) => setScores((p) => ({ ...p, [id]: Math.round(Math.max(0, Math.min(100, s))) }));
  const advance = () => { if (idx + 1 >= STEPS.length) setPhase("result"); else setIdx((i) => i + 1); };
  const skip = () => { if (phase === "step") { finish(STEPS[idx].id, 70); advance(); } };
  const reset = () => { setScores({}); setIdx(0); setStyle("lezak"); setPhase("attract"); };
  const toggleMute = () => { setMuted((m) => { const nm = !m; Sfx.setEnabled(!nm); if (!nm) Sfx.resume(); return nm; }); };

  useEffect(() => {
    if (phase === "attract") return;
    let last = Date.now(); const bump = () => (last = Date.now());
    window.addEventListener("pointerdown", bump, true);
    const iv = setInterval(() => { if (Date.now() - last > IDLE_MS) reset(); }, 1000);
    return () => { window.removeEventListener("pointerdown", bump, true); clearInterval(iv); };
  }, [phase]); // eslint-disable-line

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", height: "100%", minHeight: 560, width: "100%", background: `radial-gradient(120% 90% at 50% -10%, ${C.bg2}, ${C.bg} 62%)`, color: C.cream, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}>
      <GlobalCSS />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: `1px solid ${C.line}`, zIndex: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ fontSize: 20 }}>🍺</span>
          <span style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 17, color: C.gold }}>Mistr Sládek</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onPointerUp={toggleMute} title="Zvuk" style={{ fontSize: 16, background: "rgba(0,0,0,0.25)", border: `1px solid ${C.line}`, borderRadius: 20, padding: "5px 10px", cursor: "pointer", touchAction: "manipulation", lineHeight: 1 }}>{muted ? "🔇" : "🔊"}</button>
          <Dots idx={phase === "result" ? STEPS.length : phase === "step" ? idx : -1} />
          {phase === "step" && (
            <button onPointerUp={skip} style={{ fontSize: 12.5, fontWeight: 700, color: C.brass, background: "rgba(0,0,0,0.25)", border: `1px solid ${C.line}`, borderRadius: 20, padding: "6px 12px", cursor: "pointer", touchAction: "manipulation", whiteSpace: "nowrap" }}>Přeskočit ▸</button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0, zIndex: 2 }}>
        {phase !== "attract" && <BeerRail progress={progress} quality={quality} style={style} />}
        <div style={{ flex: 1, position: "relative", display: "flex", minWidth: 0 }}>
          {phase === "attract" && <Attract onStart={() => { Sfx.resume(); Sfx.click(); setPhase("step"); }} />}
          {phase === "step" && (
            <StepStage key={STEPS[idx].id} step={STEPS[idx]} onStyle={setStyle} onDone={(s) => finish(STEPS[idx].id, s)} onNext={advance} />
          )}
          {phase === "result" && <Result quality={quality} style={style} onAgain={reset} />}
        </div>
      </div>
    </div>
  );
}

function GlobalCSS() {
  return <style>{`
    @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
    @keyframes pop{0%{transform:scale(.5);opacity:0}100%{transform:scale(1);opacity:1}}
    @keyframes cd{0%{transform:scale(1.6);opacity:0}30%{transform:scale(1);opacity:1}100%{transform:scale(.7);opacity:0}}
    @keyframes bubble{from{transform:translateY(0);opacity:.8}to{transform:translateY(-60px);opacity:0}}
    @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
    @keyframes shk{0%,100%{transform:translate(0,0)}15%{transform:translate(-9px,4px) rotate(-1deg)}35%{transform:translate(9px,-4px) rotate(1deg)}55%{transform:translate(-7px,3px)}75%{transform:translate(7px,-2px)}}
    .shk{animation:shk .42s ease-in-out}
  `}</style>;
}

function Dots({ idx }) {
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {STEPS.map((s, i) => (<div key={s.id} style={{ width: 8, height: 8, borderRadius: "50%", background: i < idx ? C.gold : i === idx ? C.brass : "rgba(245,239,224,0.18)", boxShadow: i === idx ? `0 0 8px ${C.brass}` : "none", transition: "all .3s" }} />))}
    </div>
  );
}

function bigBtn(extra = {}) {
  return { fontFamily: "Inter, sans-serif", fontWeight: 900, fontSize: 18, letterSpacing: 0.3, padding: "16px 32px", borderRadius: 16, border: "none", cursor: "pointer", background: `linear-gradient(180deg, ${C.gold}, ${C.brass})`, color: C.ink, boxShadow: "0 6px 0 rgba(0,0,0,0.3), 0 12px 24px rgba(0,0,0,0.4)", touchAction: "manipulation", userSelect: "none", ...extra };
}

function Attract({ onStart }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 26 }}>
      <div style={{ fontSize: 84, animation: "bob 3s ease-in-out infinite" }}>🍺</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 54, lineHeight: 1, color: C.foam }}>Mistr Sládek</div>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 21, color: C.brass, marginTop: 8 }}>Zvládneš uvařit pivo?</div>
      <div style={{ maxWidth: 340, color: "rgba(239,227,206,0.7)", marginTop: 12, fontSize: 15 }}>Šest rychlovek od kotle po naražený půllitr. Drhni, sekej, chytej, mlať a čepuj.</div>
      <button style={bigBtn({ marginTop: 28, fontSize: 20 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onStart(); }}>🔥 Začít vařit</button>
    </div>
  );
}

function BeerRail({ progress, quality, style }) {
  const fill = Math.max(0.08, progress);
  const beerColor = style === "ale" ? C.ale : C.beer;
  const qColor = quality >= 72 ? C.green : quality >= 50 ? C.gold : C.wrong;
  return (
    <div style={{ width: 122, padding: "16px 10px", borderRight: `1px solid ${C.line}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, background: "rgba(0,0,0,0.12)" }}>
      <div style={{ fontSize: 10, letterSpacing: 1.4, color: C.brass, fontWeight: 800 }}>VÁRKA</div>
      <div style={{ position: "relative", width: 72, height: 168, borderRadius: "9px 9px 14px 14px", border: "3px solid rgba(245,239,224,0.32)", overflow: "hidden", background: "rgba(255,255,255,0.04)" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${fill * 100}%`, background: `linear-gradient(180deg, ${beerColor}, ${C.beerDeep})`, transition: "height .6s cubic-bezier(.2,.8,.2,1)" }}>
          <div style={{ position: "absolute", top: -7, left: 0, right: 0, height: 12, background: C.foam, borderRadius: "50%", opacity: 0.95 }} />
          {[24, 54, 76].map((x, i) => (<span key={i} style={{ position: "absolute", bottom: 5, left: `${x}%`, width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.5)", animation: `bubble ${2 + i * 0.6}s linear infinite`, animationDelay: `${i * 0.5}s` }} />))}
        </div>
      </div>
      <div style={{ width: "100%" }}>
        <div style={{ fontSize: 9.5, color: "rgba(239,227,206,0.6)", textAlign: "center", marginBottom: 3 }}>KVALITA</div>
        <div style={{ height: 9, borderRadius: 6, background: "rgba(0,0,0,0.3)", overflow: "hidden" }}><div style={{ height: "100%", width: `${quality}%`, background: qColor, transition: "width .5s, background .5s" }} /></div>
        <div style={{ textAlign: "center", marginTop: 3, fontWeight: 900, color: qColor, fontSize: 15 }}>{quality}%</div>
      </div>
    </div>
  );
}

// ---------- STEP STAGE: intro → (countdown) → play → result ----------
function StepStage({ step, onStyle, onDone, onNext }) {
  const [sub, setSub] = useState("intro");
  const [score, setScore] = useState(null);
  const done = (s) => { setScore(s); onDone(s); setSub("result"); };
  useEffect(() => { if (sub === "result") { const t = setTimeout(onNext, 2600); return () => clearTimeout(t); } }, [sub]); // eslint-disable-line
  const begin = () => setSub(step.timed ? "countdown" : "play");

  return (
    <div style={{ flex: 1, padding: 18, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 26 }}>{step.icon}</span>
        <div>
          <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 21, color: C.foam, lineHeight: 1 }}>{step.name}</div>
          <div style={{ color: C.brass, fontWeight: 900, fontSize: 14, letterSpacing: 0.5 }}>{step.verb}</div>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0, position: "relative" }}>
        {sub === "intro" && <Intro step={step} onBegin={begin} />}
        {sub === "countdown" && <Countdown onGo={() => setSub("play")} />}
        {sub === "play" && (
          <>
            {step.id === "rmutovani" && <ScrubGame onDone={done} />}
            {step.id === "scezovani" && <PumpGame onDone={done} />}
            {step.id === "chmelovar" && <NinjaGame onDone={done} />}
            {step.id === "kvaseni" && <CatchGame onDone={done} onStyle={onStyle} />}
            {step.id === "zrani" && <WhackGame onDone={done} />}
          </>
        )}
        {sub === "result" && <StepResult step={step} score={score} onNext={onNext} />}
      </div>
    </div>
  );
}

function Intro({ step, onBegin }) {
  return (
    <div style={{ textAlign: "center", maxWidth: 460, animation: "pop .3s" }}>
      <div style={{ fontSize: 66 }}>{step.icon}</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 28, color: C.foam, marginTop: 2 }}>{step.verb}</div>
      <div style={{ background: "rgba(0,0,0,0.22)", borderRadius: 14, padding: "16px 18px", margin: "16px 0", fontSize: 16, lineHeight: 1.5, color: C.cream, borderLeft: `3px solid ${C.brass}`, textAlign: "left" }}>
        {step.how}
      </div>
      <button style={bigBtn({ fontSize: 19 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; Sfx.click(); onBegin(); }}>Jdeme! ▸</button>
    </div>
  );
}

function Countdown({ onGo }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    Sfx.beep(false);
    let cur = 3;
    const iv = setInterval(() => {
      cur -= 1;
      if (cur > 0) { setN(cur); Sfx.beep(false); }
      else if (cur === 0) { setN(0); Sfx.beep(true); }
      else { clearInterval(iv); onGo(); }
    }, 750);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line
  return (
    <div style={{ textAlign: "center" }}>
      <div key={n} style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: n > 0 ? 130 : 84, color: n > 0 ? C.gold : C.green, animation: "cd .75s ease-out", lineHeight: 1 }}>
        {n > 0 ? n : "START!"}
      </div>
    </div>
  );
}

function sc(s) { return s >= 80 ? C.green : s >= 55 ? C.gold : C.wrong; }

function StepResult({ step, score, onNext }) {
  useEffect(() => { if (score >= 80) Sfx.success(); else if (score < 55) Sfx.fail(); }, []); // eslint-disable-line
  return (
    <div onPointerUp={onNext} style={{ textAlign: "center", maxWidth: 460, animation: "pop .3s", cursor: "pointer" }}>
      <div style={{ fontSize: 50 }}>{score >= 80 ? "🎉" : score >= 55 ? "👍" : "💧"}</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 30, color: sc(score) }}>{score >= 80 ? "Paráda!" : score >= 55 ? "Ujde to" : "Mohlo být líp"} · {score}%</div>
      <div style={{ background: "rgba(0,0,0,0.22)", borderRadius: 12, padding: "12px 16px", margin: "14px 0", fontSize: 14, lineHeight: 1.5, textAlign: "left", borderLeft: `3px solid ${C.brass}` }}><b style={{ color: C.brass }}>Věděl jsi?</b> {step.fact}</div>
      <div style={{ fontSize: 12.5, color: "rgba(239,227,206,0.5)" }}>klepni pro další ▸</div>
    </div>
  );
}

// ---------- 1) SCRUB ----------
function ScrubGame({ onDone }) {
  const [temp, setTemp] = useState(20);
  const [shakeRef, shake] = useShake();
  const tempRef = useRef(20); const last = useRef(null); const lastHeatSnd = useRef(0); const inZoneMs = useRef(0); const rafRef = useRef(null);
  useEffect(() => {
    let prev = performance.now();
    const loop = (t) => {
      const dt = t - prev; prev = t;
      tempRef.current = Math.max(20, tempRef.current - dt * 0.012);
      const inZone = tempRef.current >= 62 && tempRef.current <= 72;
      if (inZone) { inZoneMs.current += dt; if (inZoneMs.current > 1100) { cancelAnimationFrame(rafRef.current); Sfx.success(); onDone(95); return; } }
      else inZoneMs.current = Math.max(0, inZoneMs.current - dt * 0.6);
      setTemp(tempRef.current); rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // eslint-disable-line
  const move = (e) => {
    if (e.buttons === 0 && e.pointerType === "mouse") return;
    const x = e.clientX;
    if (last.current != null) { const d = Math.abs(x - last.current); if (d > 1) { tempRef.current = Math.min(90, tempRef.current + d * 0.05); const now = performance.now(); if (now - lastHeatSnd.current > 70) { Sfx.heat(); lastHeatSnd.current = now; } if (tempRef.current > 78) shake(); } }
    last.current = x;
  };
  const inZone = temp >= 62 && temp <= 72; const heat = Math.min(1, (temp - 20) / 70);
  return (
    <div ref={shakeRef} style={{ width: "100%", maxWidth: 480, textAlign: "center" }}>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 60, color: inZone ? C.green : C.foam, lineHeight: 1 }}>{Math.round(temp)}<span style={{ fontSize: 28, color: C.brass }}>°C</span></div>
      <div style={{ height: 20, color: inZone ? C.green : "rgba(239,227,206,0.55)", fontWeight: 800 }}>{inZone ? "✓ drž to v zóně!" : temp > 72 ? "moc horké!" : "drhni rychleji!"}</div>
      <div onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = e.clientX; }} onPointerMove={move} onPointerUp={() => (last.current = null)} onPointerCancel={() => (last.current = null)}
        style={{ marginTop: 14, height: "min(200px, 30vh)", borderRadius: 20, touchAction: "none", cursor: "grab", position: "relative", overflow: "hidden", background: `radial-gradient(circle at 50% 120%, rgba(255,${120 - heat * 80},40,${0.25 + heat * 0.5}), ${C.panel} 70%)`, border: `2px solid ${inZone ? C.green : C.line}` }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 80, filter: `drop-shadow(0 0 ${heat * 20}px rgba(255,120,40,${heat}))` }}>🫕</div>
        <div style={{ position: "absolute", left: 14, top: 14, bottom: 14, width: 16, borderRadius: 8, background: "rgba(0,0,0,0.4)", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${((62 - 20) / 70) * 100}%`, height: `${((72 - 62) / 70) * 100}%`, background: "rgba(127,176,74,0.6)" }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${heat * 100}%`, background: inZone ? C.green : C.brass }} />
        </div>
        <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, fontSize: 13, color: "rgba(239,227,206,0.7)", fontWeight: 700 }}>⇆ jezdi prstem sem a tam</div>
      </div>
    </div>
  );
}

// ---------- 2) PUMP ----------
function PumpGame({ onDone }) {
  const [fill, setFill] = useState(0); const [pumps, setPumps] = useState(0); const [shakeRef, shake] = useShake();
  const fillRef = useRef(0); const startT = useRef(performance.now()); const rafRef = useRef(null);
  useEffect(() => { const loop = () => { fillRef.current = Math.max(0, fillRef.current - 0.006); setFill(fillRef.current); rafRef.current = requestAnimationFrame(loop); }; rafRef.current = requestAnimationFrame(loop); return () => cancelAnimationFrame(rafRef.current); }, []);
  const pump = () => { fillRef.current = Math.min(1, fillRef.current + 0.085); setPumps((p) => p + 1); shake(); Sfx.pump(); if (fillRef.current >= 1) { cancelAnimationFrame(rafRef.current); const secs = (performance.now() - startT.current) / 1000; setTimeout(() => onDone(Math.max(45, Math.min(100, 130 - secs * 9))), 250); } };
  return (
    <div ref={shakeRef} style={{ width: "100%", maxWidth: 440, textAlign: "center" }}>
      <div style={{ position: "relative", width: 130, height: 150, margin: "0 auto" }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "10px 10px 16px 16px", border: "3px solid rgba(245,239,224,0.32)", overflow: "hidden", background: "rgba(255,255,255,0.04)" }}>
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${fill * 100}%`, background: `linear-gradient(180deg, ${C.beer}, ${C.beerDeep})`, transition: "height .08s" }}><div style={{ position: "absolute", top: -6, left: 0, right: 0, height: 11, background: C.foam, borderRadius: "50%", opacity: 0.9 }} /></div>
        </div>
      </div>
      <div style={{ height: 22, marginTop: 10, fontWeight: 800, color: C.brass }}>{Math.round(fill * 100)} % · {pumps}× pumpnuto</div>
      <button onPointerDown={(e) => { e.preventDefault(); pump(); }} style={bigBtn({ marginTop: 14, fontSize: 22, padding: "20px 40px", width: "80%" })}>⤓⤒ PUMPUJ!</button>
    </div>
  );
}

// ---------- 3) NINJA — higher arcs (height-scaled velocity) ----------
function NinjaGame({ onDone }) {
  const wrapRef = useRef(null); const canvasRef = useRef(null);
  const [hud, setHud] = useState({ score: 0, time: 12 });
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current, ctx = canvas.getContext("2d");
    let W = 0, H = 0; const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; canvas.width = W; canvas.height = H; }; resize(); window.addEventListener("resize", resize);
    const G = 0.42;
    const s = { items: [], parts: [], trail: [], down: false, good: 0, bad: 0, combo: 0, score: 0, running: true };
    let lastSpawn = 0, t0 = performance.now(), raf;
    const spawn = () => {
      const bad = Math.random() > 0.78;
      const rise = (0.62 + Math.random() * 0.26) * H;       // 62–88 % výšky plátna
      const vy = -Math.sqrt(2 * G * rise);                  // tak akorát síla výskoku
      s.items.push({ x: 0.15 * W + Math.random() * 0.7 * W, y: H + 30, vx: (Math.random() - 0.5) * 3.0, vy, type: bad ? "bad" : "good", emoji: bad ? "🧦" : "🌿", rot: Math.random() * 6, vrot: (Math.random() - 0.5) * 0.3, r: 40, dead: false });
    };
    const splash = (x, y, color, txt) => { for (let i = 0; i < 8; i++) s.parts.push({ x, y, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8 - 2, life: 1, color }); if (txt) s.parts.push({ x, y, vx: 0, vy: -1.5, life: 1, color, txt }); };
    const loop = (t) => {
      if (!s.running) return;
      const left = Math.max(0, 12 - (t - t0) / 1000);
      if (t - lastSpawn > 430) { spawn(); lastSpawn = t; }
      s.items.forEach((it) => { it.x += it.vx; it.y += it.vy; it.vy += G; it.rot += it.vrot; });
      s.items = s.items.filter((it) => it.y < H + 80 && !it.dead);
      s.parts.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life -= 0.035; });
      s.parts = s.parts.filter((p) => p.life > 0);
      if (s.trail.length) s.trail.shift();
      ctx.clearRect(0, 0, W, H);
      s.items.forEach((it) => { ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(it.rot); ctx.font = "62px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(it.emoji, 0, 0); ctx.restore(); });
      s.parts.forEach((p) => { ctx.globalAlpha = Math.max(0, p.life); if (p.txt) { ctx.fillStyle = p.color; ctx.font = "900 26px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillText(p.txt, p.x, p.y); } else { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 7); ctx.fill(); } });
      ctx.globalAlpha = 1;
      if (s.trail.length > 1) { ctx.strokeStyle = C.green; ctx.lineWidth = 11; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.shadowColor = C.green; ctx.shadowBlur = 14; ctx.beginPath(); ctx.moveTo(s.trail[0].x, s.trail[0].y); for (let i = 1; i < s.trail.length; i++) ctx.lineTo(s.trail[i].x, s.trail[i].y); ctx.stroke(); ctx.shadowBlur = 0; }
      setHud({ score: s.score, time: Math.ceil(left) });
      if (left <= 0) { s.running = false; setTimeout(() => onDone(Math.max(0, Math.min(100, s.good * 7 - s.bad * 10))), 200); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const pt = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const onD = (e) => { s.down = true; canvas.setPointerCapture(e.pointerId); s.trail = [pt(e)]; };
    const onM = (e) => {
      if (!s.down) return; const p = pt(e); const prev = s.trail.length ? s.trail[s.trail.length - 1] : p; s.trail.push(p); if (s.trail.length > 9) s.trail.shift();
      s.items.forEach((it) => { if (it.dead) return; if (segDist(it.x, it.y, prev.x, prev.y, p.x, p.y) < it.r) { it.dead = true; if (it.type === "good") { s.good++; s.combo++; s.score += 100 * Math.max(1, Math.floor(s.combo / 3) + 1); Sfx.splash(); splash(it.x, it.y, C.green, s.combo >= 4 ? `KOMBO x${s.combo}` : "+100"); } else { s.bad++; s.combo = 0; s.score = Math.max(0, s.score - 80); Sfx.sock(); splash(it.x, it.y, C.wrong, "HNUS!"); wrap.classList.remove("shk"); void wrap.offsetWidth; wrap.classList.add("shk"); } } });
    };
    const onU = () => { s.down = false; s.trail = []; };
    canvas.addEventListener("pointerdown", onD); canvas.addEventListener("pointermove", onM); canvas.addEventListener("pointerup", onU); canvas.addEventListener("pointercancel", onU);
    return () => { s.running = false; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); canvas.removeEventListener("pointerdown", onD); canvas.removeEventListener("pointermove", onM); canvas.removeEventListener("pointerup", onU); canvas.removeEventListener("pointercancel", onU); };
  }, []); // eslint-disable-line
  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, touchAction: "none", overflow: "hidden", borderRadius: 14 }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", cursor: "crosshair" }} />
      <div style={{ position: "absolute", top: 8, left: 12, right: 12, display: "flex", justifyContent: "space-between", pointerEvents: "none" }}>
        <div style={{ fontWeight: 900, fontSize: 24, color: C.gold, textShadow: "0 2px 6px #000" }}>{hud.score}</div>
        <div style={{ fontWeight: 900, fontSize: 26, color: hud.time <= 3 ? C.wrong : C.foam, textShadow: "0 2px 6px #000", animation: hud.time <= 3 ? "pulse .5s infinite" : "none" }}>⏱ {hud.time}s</div>
      </div>
      <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", fontSize: 12.5, color: "rgba(239,227,206,0.7)", pointerEvents: "none", fontWeight: 700 }}>sekej 🌿 · vyhni se 🧦</div>
    </div>
  );
}

// ---------- 4) CATCH ----------
function CatchGame({ onDone, onStyle }) {
  const wrapRef = useRef(null); const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current, ctx = canvas.getContext("2d");
    let W = 0, H = 0; const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; canvas.width = W; canvas.height = H; }; resize(); window.addEventListener("resize", resize);
    const s = { drops: [], lez: 0, ale: 0, missed: 0, run: true }; let t0 = performance.now(), raf, lastSpawn = 0;
    const loop = (t) => {
      if (!s.run) return; const left = Math.max(0, 7 - (t - t0) / 1000);
      if (t - lastSpawn > 360) { s.drops.push({ x: (0.08 + Math.random() * 0.84) * W, y: -20, vy: 2.4 + Math.random() * 1.6, kind: Math.random() > 0.5 ? "ale" : "lez", r: 26 }); lastSpawn = t; }
      s.drops.forEach((d) => (d.y += d.vy)); s.drops = s.drops.filter((d) => { if (d.y > H + 30) { s.missed++; return false; } return true; });
      ctx.clearRect(0, 0, W, H);
      s.drops.forEach((d) => { ctx.fillStyle = d.kind === "ale" ? C.ale : C.blue; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill(); ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.arc(d.x - 8, d.y - 8, 7, 0, 7); ctx.fill(); });
      ctx.textBaseline = "top"; ctx.font = "900 18px Inter, sans-serif"; ctx.fillStyle = C.blue; ctx.textAlign = "left"; ctx.fillText(`🔵 Ležák ${s.lez}`, 12, 8); ctx.fillStyle = C.ale; ctx.textAlign = "right"; ctx.fillText(`Ale ${s.ale} 🟠`, W - 12, 8); ctx.fillStyle = left <= 2 ? C.wrong : C.foam; ctx.textAlign = "center"; ctx.font = "900 22px Inter, sans-serif"; ctx.fillText(`⏱ ${Math.ceil(left)}s`, W / 2, 6);
      if (left <= 0) { s.run = false; const style = s.ale > s.lez ? "ale" : "lez"; onStyle(style === "ale" ? "ale" : "lezak"); const caught = s.lez + s.ale; setTimeout(() => onDone(Math.max(40, Math.min(100, caught * 9))), 150); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onD = (e) => { const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top; let hit = null, hd = 1e9; s.drops.forEach((d) => { const dx = d.x - px, dy = d.y - py, dist = Math.sqrt(dx * dx + dy * dy); if (dist < d.r + 14 && dist < hd) { hd = dist; hit = d; } }); if (hit) { s.drops = s.drops.filter((d) => d !== hit); if (hit.kind === "ale") s.ale++; else s.lez++; Sfx.plink(hit.kind === "ale"); } };
    canvas.addEventListener("pointerdown", onD);
    return () => { s.run = false; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); canvas.removeEventListener("pointerdown", onD); };
  }, []); // eslint-disable-line
  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 14, touchAction: "none", background: "rgba(0,0,0,0.12)" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", fontSize: 12.5, color: "rgba(239,227,206,0.7)", pointerEvents: "none", fontWeight: 700 }}>chytej kvasnice · čeho víc, takový styl piva</div>
    </div>
  );
}

// ---------- 5) WHACK ----------
function WhackGame({ onDone }) {
  const wrapRef = useRef(null); const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current, wrap = wrapRef.current, ctx = canvas.getContext("2d");
    let W = 0, H = 0; const resize = () => { W = wrap.clientWidth; H = wrap.clientHeight; canvas.width = W; canvas.height = H; }; resize(); window.addEventListener("resize", resize);
    const s = { bubbles: [], popped: 0, burst: 0, pressure: 0, run: true }; let t0 = performance.now(), raf, lastSpawn = 0;
    const loop = (t) => {
      if (!s.run) return; const left = Math.max(0, 10 - (t - t0) / 1000); const rate = 520 - (10 - left) * 35;
      if (t - lastSpawn > rate) { s.bubbles.push({ x: (0.1 + Math.random() * 0.8) * W, y: (0.2 + Math.random() * 0.6) * H, born: t, ttl: 1400 }); lastSpawn = t; }
      s.bubbles = s.bubbles.filter((b) => { if (t - b.born > b.ttl) { s.burst++; s.pressure = Math.min(1, s.pressure + 0.08); return false; } return true; });
      s.pressure = Math.max(0, s.pressure - 0.002);
      if (s.pressure > 0.85) { wrap.classList.remove("shk"); void wrap.offsetWidth; wrap.classList.add("shk"); }
      ctx.clearRect(0, 0, W, H);
      s.bubbles.forEach((b) => { const age = (t - b.born) / b.ttl; const r = 18 + age * 30; ctx.fillStyle = `rgba(127,176,74,${0.22 + age * 0.4})`; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 7); ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(b.x - r * 0.3, b.y - r * 0.3, r * 0.18, 0, 7); ctx.fill(); b._r = r; });
      ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.font = "900 20px Inter, sans-serif"; ctx.fillStyle = left <= 3 ? C.wrong : C.foam; ctx.fillText(`⏱ ${Math.ceil(left)}s`, 12, 8);
      const bx = 70, bw = W - 120; ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(bx, 12, bw, 12); ctx.fillStyle = s.pressure > 0.7 ? C.wrong : C.brass; ctx.fillRect(bx, 12, bw * s.pressure, 12); ctx.fillStyle = s.pressure > 0.7 ? C.wrong : C.brass; ctx.textAlign = "right"; ctx.font = "900 12px Inter, sans-serif"; ctx.fillText("TLAK", W - 12, 14);
      if (left <= 0) { s.run = false; const total = s.popped + s.burst; const score = total === 0 ? 70 : Math.max(20, Math.min(100, (s.popped / total) * 100 - s.pressure * 20)); setTimeout(() => onDone(score), 150); return; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onD = (e) => { const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top; let hit = null, hd = 1e9; s.bubbles.forEach((b) => { const dx = b.x - px, dy = b.y - py, dist = Math.sqrt(dx * dx + dy * dy); if (dist < (b._r || 24) + 10 && dist < hd) { hd = dist; hit = b; } }); if (hit) { s.bubbles = s.bubbles.filter((b) => b !== hit); s.popped++; Sfx.pop(); } };
    canvas.addEventListener("pointerdown", onD);
    return () => { s.run = false; cancelAnimationFrame(raf); window.removeEventListener("resize", resize); canvas.removeEventListener("pointerdown", onD); };
  }, []); // eslint-disable-line
  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: 14, touchAction: "none", background: "rgba(0,0,0,0.12)" }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", fontSize: 12.5, color: "rgba(239,227,206,0.7)", pointerEvents: "none", fontWeight: 700 }}>propichuj bubliny, než prasknou samy</div>
    </div>
  );
}


// ---------- RESULT ----------
function Result({ quality, style, onAgain }) {
  useEffect(() => { Sfx.win(); }, []); // eslint-disable-line
  const ranks = [
    { min: 90, name: "Mistr sládek", note: "Tohle pivo by ti záviděl i Prazdroj." },
    { min: 72, name: "Zkušený sladovník", note: "Poctivá várka. Hospoda ji prodá do večera." },
    { min: 50, name: "Učeň u kádě", note: "Pít se to dá — ale sládek kroutí hlavou." },
    { min: 0, name: "Ochutnávač", note: "Začátek je vždycky kalný. Zkus to znovu!" },
  ];
  const rank = ranks.find((r) => quality >= r.min);
  const beer = style === "ale" ? (quality >= 72 ? "Svrchně kvašená 13°" : "Mladá Ale") : (quality >= 85 ? "Český ležák 12°" : quality >= 60 ? "Světlý ležák 10°" : "Domácí výčepní");
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 26 }}>
      <div style={{ fontSize: 14, color: C.brass, letterSpacing: 2, fontWeight: 800 }}>NARAŽENO!</div>
      <div style={{ fontSize: 76, margin: "6px 0", animation: "pop .4s" }}>🍺</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 24, color: C.foam }}>{beer}</div>
      <div style={{ fontFamily: "Fraunces, serif", fontWeight: 900, fontSize: 44, color: sc(quality), marginTop: 8, lineHeight: 1 }}>{rank.name}</div>
      <div style={{ fontSize: 54, fontWeight: 900, color: sc(quality) }}>{quality}%</div>
      <div style={{ maxWidth: 360, color: "rgba(239,227,206,0.75)", marginTop: 6, fontSize: 15 }}>{rank.note}</div>
      <button style={bigBtn({ marginTop: 24, fontSize: 19 })} onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(3px)")} onPointerUp={(e) => { e.currentTarget.style.transform = ""; onAgain(); }}>↻ Vařit znovu</button>
    </div>
  );
}

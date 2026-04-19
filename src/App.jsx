import { useState, useEffect, useRef, useCallback } from "react";
import jsQR from "jsqr"; 



// ── Supabase ─────────────────────────────────────────
const SUPABASE_URL = "https://tyesaqhtiqkakguimsdi.supabase.co";
const SUPABASE_KEY = "sb_publishable_njutNAXOpPS8ueQNykDNLA_OKUOCyXj";

const registrarLog = async (usuario, acao, descricao) => {
  try {
    const token = usuario?.accessToken || SUPABASE_KEY;
    const res = await fetch(SUPABASE_URL + "/rest/v1/logs", {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + token, "Content-Type": "application/json", "Prefer": "return=minimal" },
      body: JSON.stringify({
        usuario_nome: usuario?.nome || "—",
        usuario_perfil: usuario?.perfil || "—",
        estabelecimento: usuario?.estabelecimentos?.nome || "—",
        estabelecimento_id: usuario?.estabelecimento_id || null,
        acao,
        descricao,
      })
    });
    if (!res.ok) { const err = await res.text(); console.warn("Log error:", res.status, err); }
  } catch (e) { console.warn("Log error:", e); }
};
const SUPABASE_SERVICE_KEY = process.env.REACT_APP_SUPABASE_SERVICE_KEY || "";

const sb = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": opts.prefer || "return=representation", ...opts.headers },
    ...opts,
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Erro"); }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
};

const api = {
  get: (table, query = "") => sb(`${table}?${query}`),
  post: (table, body) => sb(table, { method: "POST", body: JSON.stringify(body) }),
  patch: (table, query, body) => sb(`${table}?${query}`, { method: "PATCH", body: JSON.stringify(body), prefer: "return=minimal" }),
  delete: (table, query) => sb(`${table}?${query}`, { method: "DELETE", prefer: "return=minimal" }),
};

// ── Supabase Auth ─────────────────────────────────────
const authLogin = async (email, senha) => {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Credenciais inválidas");
  return data; // { access_token, user: { id, email } }
};

const authLogout = async (accessToken) => {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${accessToken}` },
  });
};

// ── Cache local ───────────────────────────────────────
const cache = {
  set: (k, d) => { try { localStorage.setItem(`frota_${k}`, JSON.stringify(d)); } catch (_) {} },
  get: (k) => { try { const d = localStorage.getItem(`frota_${k}`); return d ? JSON.parse(d) : null; } catch (_) { return null; } },
  del: (k) => { try { localStorage.removeItem(`frota_${k}`); } catch (_) {} },
};

const getQueue = () => cache.get("queue") || [];
const addToQueue = (item) => { const q = getQueue(); q.push(item); cache.set("queue", q); };
const clearQueue = () => cache.del("queue");

const COMBUSTIVEIS = ["Gasolina Comum", "Gasolina Aditivada", "Etanol", "Diesel S10", "Diesel S500", "GNV", "Elétrico"];
const now = () => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16); };
const fmtBRL = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v, d = 2) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: d });
const qrUrl = (data) => `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`;

// ── Helpers de vencimento ─────────────────────────────
const diasParaVencer = (dataStr) => {
  if (!dataStr) return null;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const venc = new Date(dataStr + "T00:00:00");
  return Math.ceil((venc - hoje) / (1000 * 60 * 60 * 24));
};

const statusVenc = (dataStr) => {
  const dias = diasParaVencer(dataStr);
  if (dias === null) return null;
  if (dias < 0) return { cor: "#ef4444", bg: "#2d0f0f", border: "#ef4444", texto: `Vencido há ${Math.abs(dias)} dia(s)`, icone: "🔴" };
  if (dias <= 30) return { cor: "#fbbf24", bg: "#2d1f0a", border: "#b45309", texto: `Vence em ${dias} dia(s)`, icone: "🟡" };
  return { cor: "#4ade80", bg: "#14532d", border: "#16a34a", texto: `Válido por ${dias} dia(s)`, icone: "🟢" };
};


function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

function useQRScanner(onResult) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef(null); const streamRef = useRef(null);
  const intervalRef = useRef(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    setScanning(false);
  }, []);

  const start = useCallback(async () => {
    setError(""); setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      setTimeout(() => {
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      }, 100);

      // Usa jsQR — funciona em todos os navegadores (Chrome, Safari, Firefox)
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      intervalRef.current = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 2 || !video.videoWidth) return;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
        if (code) { stop(); onResult(code.data); }
      }, 300);

    } catch (e) {
      setError("Câmera não disponível. Verifique as permissões e tente novamente.");
      setScanning(false);
    }
  }, [onResult, stop]);

  useEffect(() => () => stop(), [stop]);
  return { scanning, error, videoRef, start, stop };
}

// ── Dashboard ─────────────────────────────────────────
function Dashboard({ registros, motoristas, veiculos, estNome, isAdmin, estabelecimentos, isDark, totalAlertas, alertasVeic, alertasMot, filtroEst }) {
  const [periodo, setPeriodo] = useState("mes");
  const hoje = new Date();
  const bg = "#1a1c27";
  const bg2 = isDark ? "#0f1117" : "#0f1117";
  const border = isDark ? "#2a2c3a" : "#2a2c3a";
  const txt = isDark ? "#e8e4d9" : "#e8e4d9";
  const txt2 = isDark ? "#8a8a9a" : "#8a8a9a";

  const filtrar = (regs) => {
    return regs.filter((r) => {
      if (periodo === "hoje" && !(r.data_hora||"").startsWith(hoje.toISOString().slice(0,10))) return false;
      if (periodo === "mes" && !(r.data_hora||"").startsWith(hoje.toISOString().slice(0,7))) return false;
      if (periodo === "ano" && !(r.data_hora||"").startsWith(String(hoje.getFullYear()))) return false;
      if (filtroEst && r.operador !== filtroEst) return false;
      return true;
    });
  };

  const regs = filtrar(registros);
  const totalLitros = regs.reduce((a,b) => a+Number(b.quantidade||0), 0);
  const totalCusto = regs.reduce((a,b) => a+Number(b.custo||0), 0);
  const totalReg = regs.length;
  const precioMedio = totalLitros > 0 ? totalCusto/totalLitros : 0;

  const porVeiculo = {};
  regs.forEach((r) => {
    const k = r.placa||"—";
    if (!porVeiculo[k]) porVeiculo[k] = { litros:0, custo:0, count:0 };
    porVeiculo[k].litros += Number(r.quantidade||0);
    porVeiculo[k].custo += Number(r.custo||0);
    porVeiculo[k].count++;
  });
  const topVeiculos = Object.entries(porVeiculo).sort((a,b) => b[1].custo-a[1].custo).slice(0,5);

  const porComb = {};
  regs.forEach((r) => {
    const k = r.combustivel||"—";
    if (!porComb[k]) porComb[k] = { litros:0, custo:0 };
    porComb[k].litros += Number(r.quantidade||0);
    porComb[k].custo += Number(r.custo||0);
  });
  const topComb = Object.entries(porComb).sort((a,b) => b[1].litros-a[1].litros).slice(0,4);

  const porDepto = {};
  regs.forEach((r) => {
    const k = r.departamento||"—";
    if (!porDepto[k]) porDepto[k] = { litros:0, custo:0, count:0 };
    porDepto[k].litros += Number(r.quantidade||0);
    porDepto[k].custo += Number(r.custo||0);
    porDepto[k].count++;
  });
  const topDepto = Object.entries(porDepto).sort((a,b) => b[1].custo-a[1].custo).slice(0,5);

  const porEst = {};
  if (isAdmin) regs.forEach((r) => {
    const k = r.operador||"—";
    if (!porEst[k]) porEst[k] = { litros:0, custo:0, count:0 };
    porEst[k].litros += Number(r.quantidade||0);
    porEst[k].custo += Number(r.custo||0);
    porEst[k].count++;
  });
  const topEst = Object.entries(porEst).sort((a,b) => b[1].custo-a[1].custo);

  const ultimos7 = [];
  for (let i=6; i>=0; i--) {
    const d = new Date(hoje); d.setDate(d.getDate()-i);
    const key = d.toISOString().slice(0,10);
    const label = d.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
    const dayRegs = registros.filter((r) => (r.data_hora||"").startsWith(key));
    ultimos7.push({ label, custo: dayRegs.reduce((a,b)=>a+Number(b.custo||0),0) });
  }
  const maxCusto = Math.max(...ultimos7.map((d)=>d.custo), 1);
  const COLORS = ["#f97316","#38bdf8","#4ade80","#a78bfa","#fb7185","#fbbf24"];

  return (
    <div className="fade-in" style={{ display:"flex", flexDirection:"column", gap:16 }}>




      {/* Seletor de período — pill style */}
      <div style={{ display:"flex", background:"#1a1c27", borderRadius:12, padding:4, border:"1px solid #2a2c3a" }}>
        {[["hoje","Hoje"],["mes","Mês"],["ano","Ano"],["todos","Tudo"]].map(([id,label]) => (
          <button key={id} onClick={() => setPeriodo(id)} style={{
            flex:1, padding:"8px 4px", background: periodo===id?"#f97316":"transparent",
            border:"none", borderRadius:8, color: periodo===id?"#fff":"#8a8a9a",
            fontFamily:"inherit", fontSize:12, cursor:"pointer", fontWeight: periodo===id?600:400,
            transition:"all 0.2s"
          }}>{label}</button>
        ))}
      </div>



      {/* Cards 2x2 */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, gridAutoRows:"1fr" }}>
        {[
          ["Registros", totalReg, "", "#f97316", "📋"],
          ["Total Litros", fmtNum(totalLitros), "L", "#38bdf8", "💧"],
          ["Total Gasto", fmtBRL(totalCusto), "", "#4ade80", "💰"],
          ["Preço/Litro", fmtBRL(precioMedio), "", "#a78bfa", "⛽"],
        ].map(([label, val, unit, color, icon]) => (
          <div key={label} style={{ background:bg, border:`1px solid ${border}`, borderRadius:14, padding:"14px 16px", position:"relative", overflow:"hidden", minHeight:80, display:"flex", flexDirection:"column", justifyContent:"space-between", boxShadow: isDark?"none":"0 1px 4px rgba(0,0,0,0.08)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div style={{ fontSize:10, color:txt2, letterSpacing:1, fontWeight:500 }}>{label.toUpperCase()}</div>
              <span style={{ fontSize:18, opacity:0.6 }}>{icon}</span>
            </div>
            <div style={{ fontSize:20, fontFamily:"'DM Mono',monospace", fontWeight:500, color, lineHeight:1, marginTop:8, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {val}{unit && <span style={{ fontSize:12, marginLeft:3, color:txt2 }}>{unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Gráfico 7 dias */}
      <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:14, padding:"16px 14px" }}>
        <div style={{ fontSize:11, color:txt2, fontWeight:600, marginBottom:14, letterSpacing:0.5 }}>EVOLUÇÃO — 7 DIAS</div>
        <div style={{ display:"flex", alignItems:"flex-end", gap:6, height:80 }}>
          {ultimos7.map((d,i) => {
            const h = maxCusto > 0 ? (d.custo/maxCusto)*70 : 0;
            const isHoje = i === 6;
            return (
              <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                <div style={{ width:"100%", height:Math.max(h, d.custo>0?3:0), background: isHoje?"#f97316":"#2a3a5a", borderRadius:"4px 4px 0 0", minHeight:d.custo>0?3:0 }} />
                <div style={{ fontSize:8, color: isHoje?"#f97316":txt2, fontWeight: isHoje?700:400 }}>{d.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="dash-sections" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
      {/* Top Veículos */}
      {topVeiculos.length > 0 && (
        <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:14, padding:"16px" }}>
          <div style={{ fontSize:11, color:txt2, fontWeight:600, marginBottom:12, letterSpacing:0.5 }}>🚗 TOP VEÍCULOS</div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {topVeiculos.map(([placa,d],i) => {
              const pct = totalCusto > 0 ? (d.custo/totalCusto)*100 : 0;
              return (
                <div key={placa}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:24, height:24, borderRadius:6, background:COLORS[i%COLORS.length]+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:COLORS[i%COLORS.length] }}>{i+1}</div>
                      <div style={{ fontSize:13, fontWeight:500, color:txt, fontFamily:"'DM Mono',monospace" }}>{placa}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:13, fontWeight:500, fontFamily:"'DM Mono',monospace", color:COLORS[i%COLORS.length] }}>{fmtBRL(d.custo)}</div>
                      <div style={{ fontSize:10, color:txt2 }}>{fmtNum(d.litros)} L · {d.count} abast.</div>
                    </div>
                  </div>
                  <div style={{ height:3, background:isDark?"#2a2c3a":"#eee", borderRadius:2 }}>
                    <div style={{ height:3, background:COLORS[i%COLORS.length], borderRadius:2, width:`${pct}%`, transition:"width 0.5s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Combustíveis */}
      {topComb.length > 0 && (
        <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:14, padding:"16px" }}>
          <div style={{ fontSize:11, color:txt2, fontWeight:600, marginBottom:12, letterSpacing:0.5 }}>⛽ COMBUSTÍVEIS</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
            {topComb.map(([comb,d],i) => (
              <div key={comb} style={{ background:bg2, borderRadius:10, padding:"10px 12px", borderLeft:`4px solid ${COLORS[i%COLORS.length]}`, border:`1px solid ${border}`, borderLeftWidth:4, borderLeftColor:COLORS[i%COLORS.length] }}>
                <div style={{ fontSize:11, fontWeight:500, color:txt, marginBottom:3, fontFamily:"'DM Mono',monospace" }}>{comb}</div>
                <div style={{ fontSize:14, fontWeight:500, fontFamily:"'DM Mono',monospace", color:COLORS[i%COLORS.length] }}>{fmtNum(d.litros)} L</div>
                <div style={{ fontSize:10, color:txt2 }}>{fmtBRL(d.custo)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      </div>
      {/* Top Secretarias */}
      {topDepto.length > 0 && (
        <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:14, padding:"16px" }}>
          <div style={{ fontSize:11, color:txt2, fontWeight:600, marginBottom:12, letterSpacing:0.5 }}>🏢 SECRETARIAS</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {topDepto.map(([depto,d],i) => {
              const pct = totalCusto > 0 ? (d.custo/totalCusto)*100 : 0;
              return (
                <div key={depto}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                    <div style={{ fontSize:12, fontWeight:500, color:txt, fontFamily:"'DM Mono',monospace" }}>{depto}</div>
                    <div style={{ fontSize:12, fontWeight:500, fontFamily:"'DM Mono',monospace", color:COLORS[i%COLORS.length] }}>{fmtBRL(d.custo)} <span style={{ fontSize:10, color: isDark?"#5a5a6a":"#666677" }}>({pct.toFixed(0)}%)</span></div>
                  </div>
                  <div style={{ height:4, background:isDark?"#2a2c3a":"#eee", borderRadius:2 }}>
                    <div style={{ height:4, background:COLORS[i%COLORS.length], borderRadius:2, width:`${pct}%`, transition:"width 0.5s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin: Por estabelecimento */}
      {isAdmin && topEst.length > 0 && (
        <div style={{ background:bg, border:`1px solid ${border}`, borderRadius:14, padding:"16px" }}>
          <div style={{ fontSize:11, color:txt2, fontWeight:600, marginBottom:12, letterSpacing:0.5 }}>🏪 ESTABELECIMENTOS</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {topEst.map(([est,d],i) => {
              const pct = totalCusto > 0 ? (d.custo/totalCusto)*100 : 0;
              return (
                <div key={est}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
                    <div style={{ fontSize:12, fontWeight:500, color:txt, fontFamily:"'DM Mono',monospace" }}>{est}</div>
                    <div style={{ fontSize:12, fontWeight:500, fontFamily:"'DM Mono',monospace", color:COLORS[i%COLORS.length] }}>{fmtBRL(d.custo)}</div>
                  </div>
                  <div style={{ height:4, background:isDark?"#2a2c3a":"#eee", borderRadius:2 }}>
                    <div style={{ height:4, background:COLORS[i%COLORS.length], borderRadius:2, width:`${pct}%`, transition:"width 0.5s" }} />
                  </div>
                  <div style={{ fontSize:10, color:txt2, marginTop:2 }}>{fmtNum(d.litros)} L · {d.count} abast.</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── ScanBlock ─────────────────────────────────────────
function ScanBlock({ icon, label, scanned, onClear, onStart, onManual, manualOptions, manualValue, manualError, scanning, scanError, videoRef, onStop, accentColor = "#f97316" }) {
  return (
    <div style={{ background: "#1a1c27", border: `1px solid ${scanned ? "#16a34a" : "#2a2c3a"}`, borderRadius: 12, padding: "16px 18px", transition: "border-color 0.3s" }}>
      <div style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2, marginBottom: 12 }}>{label}</div>
      {scanned ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 9, background: accentColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{icon}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "#fff" }}>{scanned.linha1}</div>
              <div style={{ fontSize: 11, color: "#8a8a9a", marginTop: 2 }}>{scanned.linha2}</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "#4ade80" }}>✓</span>
            <button onClick={onClear} style={{ background: "none", border: "1px solid #3a2020", borderRadius: 6, color: "#ef4444", cursor: "pointer", padding: "4px 10px", fontSize: 11, fontFamily: "inherit" }}>Trocar</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {scanError && <div style={{ background: "#2d1f0a", border: "1px solid #b45309", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#fbbf24" }}>{scanError}</div>}
          {scanning ? (
            <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: "#000", minHeight: 200 }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", maxHeight: 220, display: "block", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                <div style={{ width: 140, height: 140, border: `2px solid ${accentColor}`, borderRadius: 12, animation: "pulse 1.5s infinite" }} />
              </div>
              <button onClick={onStop} style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.7)", border: "1px solid #5a5a6a", borderRadius: 6, color: "#e8e4d9", cursor: "pointer", padding: "4px 10px", fontSize: 11, fontFamily: "inherit" }}>Cancelar</button>
            </div>
          ) : (
            <button onClick={onStart} style={{ padding: "12px", background: "#0f1117", border: `1px solid ${accentColor}`, borderRadius: 9, color: accentColor, fontFamily: "inherit", fontSize: 12, letterSpacing: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              📷 ESCANEAR QR {label.split(" ").pop()}
            </button>
          )}

        </div>
      )}
    </div>
  );
}

// ── Login ─────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState(""); const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const online = useOnline();

  const handleLogin = async () => {
    if (!email.trim() || !senha.trim()) { setError("Preencha e-mail e senha"); return; }
    setLoading(true); setError("");
    if (online) {
      try {
        // 1. Autenticar via Supabase Auth (senha criptografada)
        const authData = await authLogin(email.trim(), senha.trim());
        const authId = authData.user?.id;
        // 2. Buscar perfil na tabela usuarios pelo auth_id
        const users = await api.get("usuarios", `auth_id=eq.${authId}&select=*,estabelecimentos(*)`);
        if (users.length === 0) {
          // Fallback: buscar por email (para usuários antigos ainda não migrados)
          const usersByEmail = await api.get("usuarios", `email=eq.${encodeURIComponent(email.trim())}&select=*,estabelecimentos(*)`);
          if (usersByEmail.length === 0) { setError("Usuário não encontrado."); setLoading(false); return; }
          const u = { ...usersByEmail[0], accessToken: authData.access_token };
          cache.set("usuario_sessao", u);
          onLogin(u); return;
        }
        const u = { ...users[0], accessToken: authData.access_token };
        // Verificar se estabelecimento está ativo
        if (u.estabelecimentos?.ativo === false) {
          setError("Acesso suspenso. Entre em contato com o administrador.");
          setLoading(false); return;
        }
        cache.set("usuario_sessao", u);
        onLogin(u); return;
      } catch (e) { setError(e.message || "E-mail ou senha incorretos"); setLoading(false); return; }
    }
    // Offline: usar cache
    const cached = cache.get("usuario_sessao");
    if (cached && cached.email === email.trim()) { onLogin(cached); }
    else { setError("Sem conexão. Faça login online primeiro."); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:"#0f1117", fontFamily:"'DM Mono','Courier New',monospace", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap'); *{box-sizing:border-box} input{outline:none}`}</style>
      <div style={{ width:"100%", maxWidth:400 }}>
        {!online && <div style={{ background:"#2d1f0a", border:"1px solid #b45309", borderRadius:10, padding:"10px 16px", marginBottom:16, fontSize:12, color:"#fbbf24", textAlign:"center" }}>📡 Sem conexão — modo offline</div>}
        <div style={{ textAlign:"center", marginBottom:36 }}>
          <div style={{ width:64, height:64, borderRadius:18, background:"#f97316", display:"flex", alignItems:"center", justifyContent:"center", fontSize:34, margin:"0 auto 18px", boxShadow:"0 8px 32px rgba(249,115,22,0.3)" }}>⛽</div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:28, fontWeight:800, color:"#fff", letterSpacing:-0.5 }}>AbastecePro</div>
          <div style={{ fontSize:11, color:"#5a5a6a", letterSpacing:2, marginTop:6 }}>GESTÃO DE FROTA PROFISSIONAL</div>
        </div>
        <div style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:16, padding:28 }}>
          <div style={{ fontSize:13, color:"#fff", fontWeight:600, marginBottom:20, textAlign:"center" }}>Acesse sua conta</div>
          {error && <div style={{ background:"#2d0f0f", border:"1px solid #ef4444", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#ef4444", marginBottom:16 }}>{error}</div>}
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div><label style={{ fontSize:10, color:"#5a5a6a", letterSpacing:2, display:"block", marginBottom:6 }}>E-MAIL</label><input type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} style={{ ...iS(), width:"100%" }} /></div>
            <div><label style={{ fontSize:10, color:"#5a5a6a", letterSpacing:2, display:"block", marginBottom:6 }}>SENHA</label><input type="password" placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} style={{ ...iS(), width:"100%" }} /></div>
            <button onClick={handleLogin} disabled={loading} style={{ padding:"14px", background:"#f97316", border:"none", borderRadius:10, color:"#fff", fontFamily:"inherit", fontSize:13, fontWeight:500, letterSpacing:1.5, cursor:loading?"not-allowed":"pointer", marginTop:4, opacity:loading?0.7:1 }}>{loading ? "ENTRANDO..." : "ENTRAR"}</button>
          </div>
        </div>
        <div style={{ textAlign:"center", marginTop:20, fontSize:11, color:"#3a3a4a" }}>
          Precisa de acesso? Entre em contato com o administrador.
        </div>
      </div>
    </div>
  );
}

// ── Comprovante ───────────────────────────────────────
function Comprovante({ registro, estabelecimento, onClose }) {
  const handleShare = async () => {
    const texto = `⛽ COMPROVANTE\n${estabelecimento}\n─────────\nData: ${(registro.data_hora || "").replace("T", " ").slice(0, 16)}\nMotorista: ${registro.motorista_nome}\nVeículo: ${registro.placa}\nDepto: ${registro.departamento}\n${registro.hodometro ? "Hodômetro: " + fmtNum(registro.hodometro, 0) + " km\n" : ""}─────────\nCombustível: ${registro.combustivel}\nQtd: ${fmtNum(registro.quantidade)} L\nTotal: ${fmtBRL(registro.custo)}`;
    if (navigator.share) await navigator.share({ title: "Comprovante", text: texto });
    else { await navigator.clipboard.writeText(texto); alert("Copiado!"); }
  };
  return (
    <div className="qr-overlay" onClick={onClose}>
      <style>{`@media print{body *{visibility:hidden}.comprovante,.comprovante *{visibility:visible}.comprovante{position:fixed;inset:0;padding:20px}.no-print{display:none!important}}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, maxWidth: 340, width: "90%", color: "#111", fontFamily: "'DM Mono',monospace" }}>
        <div className="comprovante">
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 28 }}>⛽</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: 1, marginTop: 4 }}>COMPROVANTE DE AbastecePro</div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{estabelecimento}</div>
          </div>
          <Divider />
          <Row label="Data" value={(registro.data_hora || "").replace("T", " ").slice(0, 16)} />
          <Row label="Motorista" value={registro.motorista_nome} />
          {registro.motorista_cnh && <Row label="CNH" value={registro.motorista_cnh} />}
          <Row label="Veículo" value={registro.placa} />
          {registro.modelo && <Row label="Modelo" value={registro.modelo} />}
          <Row label="Depto" value={registro.departamento} />
          {registro.hodometro && <Row label="Hodômetro" value={`${fmtNum(registro.hodometro, 0)} km`} />}
          {registro.cupom_fiscal && <Row label="Cupom Fiscal" value={registro.cupom_fiscal} />}
          <Divider />
          <Row label="Combustível" value={registro.combustivel} />
          <Row label="Quantidade" value={`${fmtNum(registro.quantidade)} L`} />
          <Row label="Preço/litro" value={fmtBRL(registro.custo / registro.quantidade)} />
          <Divider />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>TOTAL</span>
            <span style={{ fontSize: 20, fontFamily: "'DM Mono',monospace", fontWeight: 500 }}>{fmtBRL(registro.custo)}</span>
          </div>
          {registro._offline && <div style={{ marginTop: 8, fontSize: 10, color: "#b45309", textAlign: "center" }}>⏳ Pendente de sincronização</div>}
          <Divider />
        </div>
        <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleShare} style={{ flex: 1, padding: "11px", background: "#f97316", border: "none", borderRadius: 8, color: "#fff", fontFamily: "inherit", fontSize: 12, cursor: "pointer", letterSpacing: 1 }}>📱 COMPARTILHAR</button>
          <button onClick={() => window.print()} style={{ flex: 1, padding: "11px", background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 8, color: "#e8e4d9", fontFamily: "inherit", fontSize: 12, cursor: "pointer", letterSpacing: 1 }}>🖨️ IMPRIMIR</button>
        </div>
        <button className="no-print" onClick={onClose} style={{ width: "100%", marginTop: 8, padding: "9px", background: "none", border: "1px solid #ddd", borderRadius: 8, color: "#888", fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>FECHAR</button>
      </div>
    </div>
  );
}

function Divider() { return <div style={{ borderTop: "1px dashed #ccc", margin: "8px 0" }} />; }
function Row({ label, value }) { return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}><span style={{ color: "#666" }}>{label}:</span><span style={{ fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{value}</span></div>; }

// ── Relatórios ────────────────────────────────────────
function Relatorios({ registros, isAdmin, veiculos, podeRelatorios, podeCSV, podePDF, podeKmL, podeFinanceiro, filtroEstDashProp }) {
  const [aba, setAba] = useState("resumo"); // resumo | secretaria | historico | consumo | financeiro
  const [tipo, setTipo] = useState("departamento");
  const [periodo, setPeriodo] = useState("todos");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const filtroEst = filtroEstDashProp || "";

  const [filtroSecretaria, setFiltroSecretaria] = useState("");
  const [comparativoMeses, setComparativoMeses] = useState(6);
  const [filtroHistorico, setFiltroHistorico] = useState("veiculo");
  const [filtroHistoricoValor, setFiltroHistoricoValor] = useState("");
  const hoje = new Date();

  const filtrarPeriodo = (regs) => {
    return regs.filter((r) => {
      const dt = (r.data_hora || "").slice(0, 10);
      if (periodo === "hoje" && dt !== hoje.toISOString().slice(0, 10)) return false;
      if (periodo === "mes" && !dt.startsWith(hoje.toISOString().slice(0, 7))) return false;
      if (periodo === "periodo" && dataInicio && dt < dataInicio) return false;
      if (periodo === "periodo" && dataFim && dt > dataFim) return false;
      if (filtroEst && r.operador !== filtroEst) return false;

      return true;
    });
  };

  const regs = filtrarPeriodo(registros);
  const estabelecimentosUnicos = [...new Set(registros.map((r) => r.operador).filter(Boolean))];
  const secretariasUnicas = [...new Set(registros.map((r) => r.departamento).filter(Boolean))];
  const placasUnicas = [...new Set(registros.map((r) => r.placa).filter(Boolean))];
  const motoristasUnicos = [...new Set(registros.map((r) => r.motorista_nome).filter(Boolean))];

  // Resumo agrupado
  const campos = { departamento: "departamento", veiculo: "placa", motorista: "motorista_nome", combustivel: "combustivel", estabelecimento: "operador" };
  const grupos = {};
  regs.forEach((r) => {
    const chave = r[campos[tipo]] || "—";
    if (!grupos[chave]) grupos[chave] = { litros: 0, custo: 0, count: 0 };
    grupos[chave].litros += Number(r.quantidade || 0);
    grupos[chave].custo += Number(r.custo || 0);
    grupos[chave].count++;
  });
  const lista = Object.entries(grupos).sort((a, b) => b[1].custo - a[1].custo);
  const totalCusto = regs.reduce((a, b) => a + Number(b.custo || 0), 0);

  // Secretaria detalhado
  const regsSecretaria = filtrarPeriodo(registros).filter((r) => !filtroSecretaria || r.departamento === filtroSecretaria);

  // Histórico por veículo ou motorista
  const regsHistorico = filtrarPeriodo(registros).filter((r) => {
    if (!filtroHistoricoValor) return false;
    return filtroHistorico === "veiculo" ? r.placa === filtroHistoricoValor : r.motorista_nome === filtroHistoricoValor;
  });

  // Consumo médio km/litro por veículo
  const consumoVeiculos = veiculos.map((v) => {
    const regsV = regs.filter((r) => r.placa === v.placa && r.hodometro);
    if (regsV.length < 2) return { ...v, kmL: null, alerta: false };
    const sorted = [...regsV].sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));
    const kmTotal = sorted[sorted.length - 1].hodometro - sorted[0].hodometro;
    const litrosTotal = sorted.slice(1).reduce((a, b) => a + Number(b.quantidade || 0), 0);
    const kmL = litrosTotal > 0 ? kmTotal / litrosTotal : null;
    // Calcular média histórica para alertas
    const mediasAnteriores = [];
    for (let i = 1; i < sorted.length; i++) {
      const km = sorted[i].hodometro - sorted[i-1].hodometro;
      const lit = Number(sorted[i].quantidade || 0);
      if (lit > 0 && km > 0) mediasAnteriores.push(km / lit);
    }
    const mediaHist = mediasAnteriores.length > 0 ? mediasAnteriores.reduce((a, b) => a + b, 0) / mediasAnteriores.length : null;
    const ultimaMedia = mediasAnteriores[mediasAnteriores.length - 1] || null;
    const alerta = mediaHist && ultimaMedia && ultimaMedia < mediaHist * 0.8;
    return { ...v, kmL, mediaHist, ultimaMedia, alerta, totalRegs: regsV.length };
  }).filter((v) => v.kmL !== null);

  // PDF export
  const exportPDF = () => {
    const mes = hoje.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const regsM = registros.filter((r) => (r.data_hora || "").startsWith(hoje.toISOString().slice(0, 7)));
    const totalL = regsM.reduce((a, b) => a + Number(b.quantidade || 0), 0);
    const totalC = regsM.reduce((a, b) => a + Number(b.custo || 0), 0);
    const porDepto = {};
    regsM.forEach((r) => {
      const k = r.departamento || "—";
      if (!porDepto[k]) porDepto[k] = { litros: 0, custo: 0, count: 0 };
      porDepto[k].litros += Number(r.quantidade || 0);
      porDepto[k].custo += Number(r.custo || 0);
      porDepto[k].count++;
    });
    const linhasDepto = Object.entries(porDepto).sort((a, b) => b[1].custo - a[1].custo)
      .map(([d, v]) => `<tr><td>${d}</td><td>${v.count}</td><td>${fmtNum(v.litros)} L</td><td>${fmtBRL(v.custo)}</td></tr>`).join("");
    const linhasRegs = regsM.map((r) =>
      `<tr><td>${(r.data_hora || "").slice(0,16).replace("T"," ")}</td><td>${r.placa}</td><td>${r.motorista_nome}</td><td>${r.departamento}</td><td>${r.combustivel}</td><td>${fmtNum(r.quantidade)} L</td><td>${fmtBRL(r.custo)}</td></tr>`
    ).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Relatório ${mes}</title>
    <style>body{font-family:Arial,sans-serif;padding:20px;color:#111}h1{color:#f97316}h2{color:#333;border-bottom:2px solid #f97316;padding-bottom:6px}table{width:100%;border-collapse:collapse;margin-bottom:24px}th{background:#f97316;color:#fff;padding:8px;text-align:left;font-size:12px}td{padding:7px 8px;border-bottom:1px solid #eee;font-size:12px}tr:nth-child(even){background:#f9f9f9}.resumo{display:flex;gap:20px;margin-bottom:24px}.card{background:#fff3e0;border:1px solid #f97316;border-radius:8px;padding:12px 20px;text-align:center}.card-label{font-size:10px;color:#888;letter-spacing:2px}.card-val{font-size:22px;font-weight:bold;color:#f97316}</style></head>
    <body><h1>⛽ Relatório de Abastecimento</h1><p>${mes}</p>
    <div class="resumo">
      <div class="card"><div class="card-label">REGISTROS</div><div class="card-val">${regsM.length}</div></div>
      <div class="card"><div class="card-label">TOTAL LITROS</div><div class="card-val">${fmtNum(totalL)} L</div></div>
      <div class="card"><div class="card-label">TOTAL GASTO</div><div class="card-val">${fmtBRL(totalC)}</div></div>
    </div>
    <h2>Por Secretaria/Departamento</h2>
    <table><thead><tr><th>Secretaria</th><th>Registros</th><th>Litros</th><th>Custo</th></tr></thead><tbody>${linhasDepto}</tbody></table>
    <h2>Registros Detalhados</h2>
    <table><thead><tr><th>Data/Hora</th><th>Placa</th><th>Motorista</th><th>Secretaria</th><th>Combustível</th><th>Quantidade</th><th>Custo</th></tr></thead><tbody>${linhasRegs}</tbody></table>
    </body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (w) setTimeout(() => w.print(), 800);
  };

  const exportPDFAtual = () => {
    const filtros = [];
    if (dataInicio || dataFim) filtros.push(`Período: ${dataInicio || "..."} até ${dataFim || "..."}`);

    if (filtroEst) filtros.push(`Posto: ${filtroEst}`);

    const totalL = regs.reduce((a,b) => a+Number(b.quantidade||0), 0);
    const totalC = regs.reduce((a,b) => a+Number(b.custo||0), 0);

    // Agrupar por tipo selecionado
    const campos = { departamento:"departamento", veiculo:"placa", motorista:"motorista_nome", combustivel:"combustivel", estabelecimento:"operador" };
    const campo = campos[tipo] || "departamento";
    const grupos = {};
    regs.forEach((r) => {
      const k = r[campo] || "—";
      if (!grupos[k]) grupos[k] = { litros:0, custo:0, count:0 };
      grupos[k].litros += Number(r.quantidade||0);
      grupos[k].custo += Number(r.custo||0);
      grupos[k].count++;
    });
    const linhasResumo = Object.entries(grupos)
      .sort((a,b) => b[1].custo - a[1].custo)
      .map(([k,v]) => `<tr><td>${k}</td><td>${v.count}</td><td>${fmtNum(v.litros)} L</td><td><strong>${fmtBRL(v.custo)}</strong></td></tr>`).join("");

    const linhasRegs = regs.sort((a,b) => new Date(b.data_hora) - new Date(a.data_hora)).map((r) =>
      `<tr><td>${(r.data_hora||"").slice(0,16).replace("T"," ")}</td><td>${r.motorista_nome||"—"}</td><td>${r.placa||"—"}</td><td>${r.departamento||"—"}</td><td>${r.combustivel||"—"}</td><td>${fmtNum(r.quantidade)} L</td><td><strong>${fmtBRL(r.custo)}</strong></td></tr>`
    ).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Relatório AbastecePro</title>
    <style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111;font-size:13px}
      h1{color:#f97316;margin-bottom:4px;font-size:22px}
      .sub{color:#666;font-size:12px;margin-bottom:16px}
      .filtros{background:#fff8f0;border:1px solid #f97316;border-radius:6px;padding:10px 16px;margin-bottom:16px;font-size:12px;color:#333}
      .cards{display:flex;gap:16px;margin-bottom:20px}
      .card{background:#fff8f0;border:1px solid #f97316;border-radius:8px;padding:10px 16px;text-align:center;flex:1}
      .card-label{font-size:10px;color:#888;letter-spacing:1px}
      .card-val{font-size:20px;font-weight:bold;color:#f97316}
      table{width:100%;border-collapse:collapse;margin-bottom:24px}
      th{background:#f97316;color:#fff;padding:8px;text-align:left;font-size:12px}
      td{padding:7px 8px;border-bottom:1px solid #eee;font-size:12px}
      tr:nth-child(even){background:#fafafa}
      h2{color:#333;border-bottom:2px solid #f97316;padding-bottom:4px;margin:20px 0 10px;font-size:15px}
      @media print{body{padding:0}}
    </style></head>
    <body>
      <h1>⛽ AbastecePro — Relatório de Abastecimento</h1>
      <div class="sub">Gerado em ${new Date().toLocaleString("pt-BR")}</div>
      ${filtros.length > 0 ? `<div class="filtros">🔍 <strong>Filtros aplicados:</strong> ${filtros.join(" &nbsp;|&nbsp; ")}</div>` : ""}
      <div class="cards">
        <div class="card"><div class="card-label">REGISTROS</div><div class="card-val">${regs.length}</div></div>
        <div class="card"><div class="card-label">TOTAL LITROS</div><div class="card-val">${fmtNum(totalL)} L</div></div>
        <div class="card"><div class="card-label">TOTAL GASTO</div><div class="card-val">${fmtBRL(totalC)}</div></div>
      </div>
      <h2>Resumo por ${tipo==="departamento"?"Secretaria":tipo==="veiculo"?"Veículo":tipo==="motorista"?"Motorista":tipo==="combustivel"?"Combustível":"Posto"}</h2>
      <table><thead><tr><th>Nome</th><th>Registros</th><th>Litros</th><th>Custo</th></tr></thead><tbody>${linhasResumo}</tbody></table>
      <h2>Registros Detalhados (${regs.length})</h2>
      <table><thead><tr><th>Data/Hora</th><th>Motorista</th><th>Placa</th><th>Secretaria</th><th>Combustível</th><th>Qtd</th><th>Custo</th></tr></thead><tbody>${linhasRegs}</tbody></table>
    </body></html>`;
    const blob = new Blob([html], { type:"text/html" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (w) setTimeout(() => w.print(), 800);
  };

  const exportCSVAtual = () => {
    // Respeita a aba ativa e os filtros aplicados
    let dadosExport = regs;
    let nomeArq = "relatorio";

    if (aba === "secretaria" && filtroSecretaria) {
      dadosExport = regsSecretaria;
      nomeArq = "secretaria_" + filtroSecretaria.replace(/\s+/g,"_");
    } else if (aba === "historico" && filtroHistoricoValor) {
      dadosExport = regsHistorico;
      nomeArq = (filtroHistorico === "veiculo" ? "veiculo_" : "motorista_") + filtroHistoricoValor.replace(/\s+/g,"_");
    }

    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    script.onload = () => {
      const XLSX = window.XLSX;
      const wb = XLSX.utils.book_new();

      const fmtData = (dt) => {
        if (!dt) return "";
        const d = new Date(dt);
        const dia = String(d.getDate()).padStart(2,"0");
        const mes = String(d.getMonth()+1).padStart(2,"0");
        const ano = d.getFullYear();
        const h = String(d.getHours()).padStart(2,"0");
        const m = String(d.getMinutes()).padStart(2,"0");
        return dia + "/" + mes + "/" + ano + " " + h + ":" + m;
      };

      const rows = dadosExport.sort((a,b) => new Date(b.data_hora)-new Date(a.data_hora)).map((r) => {
        const totalL = Number(r.quantidade||0);
        const totalC = Number(r.custo||0);
        const precoL = totalL > 0 ? Math.round((totalC/totalL)*100)/100 : 0;
        return [
          r.placa||"",
          r.modelo||"",
          r.departamento||"",
          fmtData(r.data_hora),
          r.combustivel||"",
          Math.round(totalL*100)/100,
          r.hodometro ? Number(r.hodometro) : "",
          precoL,
          Math.round(totalC*100)/100,
          r.motorista_nome||"",
          r.cupom_fiscal||"",
        ];
      });

      const nomeEst = dadosExport.length > 0 ? (dadosExport[0].operador || "") : "";
      const wsData = [
        ["Listagem dos abastecimentos"],
        [nomeEst ? "Estabelecimento: " + nomeEst : ""],
        [],
        ["Placa","Marca/Modelo","Centro Custo","Data","Tipo","Litros","Odômetro","Preço Litro","Valor R$","Agente","Cupom Fiscal"],
        ...rows,
      ];

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = [
        {wch:12},{wch:18},{wch:22},{wch:20},{wch:18},
        {wch:10},{wch:12},{wch:12},{wch:12},{wch:24},{wch:14},
      ];

      const nRows = rows.length;
      for (let i = 0; i < nRows; i++) {
        const row = i + 5;
        ["F","H","I"].forEach((col) => {
          const cell = ws[col + row];
          if (cell && cell.t === "n") cell.z = "#,##0.00";
        });
      }

      ws["!merges"] = [{ s:{r:0,c:0}, e:{r:0,c:10} }];
      XLSX.utils.book_append_sheet(wb, ws, "Abastecimentos");
      XLSX.writeFile(wb, nomeArq + "_" + new Date().toISOString().slice(0,10) + ".xlsx");
    };
    document.head.appendChild(script);
  };

  const exportCSVSecretaria = () => {
    const h = ["Data/Hora","Secretaria","Placa","Motorista","Combustível","Qtd (L)","Custo (R$)","Hodômetro","Operador"];
    const rows = regsSecretaria.map((r) => [(r.data_hora||"").slice(0,16).replace("T"," "),r.departamento,r.placa,r.motorista_nome,r.combustivel,r.quantidade,r.custo,r.hodometro||"",r.operador]);
    const csv = [h,...rows].map((r)=>r.map((c)=>`"${c??''}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href=url; a.download=`secretaria_${filtroSecretaria||"todas"}_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="fade-in" style={{ paddingBottom:80 }}>
      {/* Abas internas — scroll horizontal */}
      <div className="tabs-scroll" style={{ overflowX:"auto", marginBottom:16, paddingBottom:4 }}>
        <div style={{ display:"flex", gap:6, minWidth:"max-content" }}>
          {[["resumo","📊 Resumo"],["secretaria","🏢 Secretaria"],["historico","📋 Histórico"],["consumo","⛽ km/L"],["financeiro","💰 Financeiro"],["comparativo","📈 Comparativo"]].map(([id,label]) => {
            const bloqueado = (!podeRelatorios && id === "secretaria") || (!podeKmL && id === "consumo") || (!podeFinanceiro && id === "financeiro") || (!podeRelatorios && id === "comparativo");
            return (
              <button key={id} onClick={() => { if (bloqueado) { alert(label + " disponivel no Plano Profissional. Faca upgrade!"); } else { setAba(id); } }} style={{
                padding:"9px 14px", background: bloqueado ? "#1a1c27" : aba===id?"#f97316":"#1a1c27",
                border:`1px solid ${bloqueado ? "#2a2c3a" : aba===id?"#f97316":"#2a2c3a"}`,
                borderRadius:20, color: bloqueado ? "#3a3a4a" : aba===id?"#fff":"#8a8a9a",
                fontFamily:"inherit", fontSize:12, cursor: bloqueado ? "not-allowed" : "pointer",
                fontWeight:aba===id?600:400, whiteSpace:"nowrap", transition:"all 0.2s"
              }}>{label}{bloqueado ? " 🔒" : ""}</button>
            );
          })}
          {podePDF
            ? <button onClick={exportPDFAtual} style={{ padding:"9px 14px", background:"#1e2535", border:"1px solid #a78bfa", borderRadius:20, color:"#a78bfa", fontFamily:"inherit", fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}>🖨️ Imprimir</button>
            : <div style={{ padding:"9px 14px", background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:20, color:"#3a3a4a", fontSize:12, whiteSpace:"nowrap", cursor:"not-allowed" }} title="Disponível no Plano Profissional">🖨️ Imprimir 🔒</div>
          }
          {podeCSV
            ? <button onClick={exportCSVAtual} style={{ padding:"9px 14px", background:"#1a3a2a", border:"1px solid #16a34a", borderRadius:20, color:"#4ade80", fontFamily:"inherit", fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}>↓ XLSX</button>
            : <div style={{ padding:"9px 14px", background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:20, color:"#3a3a4a", fontSize:12, whiteSpace:"nowrap", cursor:"not-allowed" }} title="Disponível no Plano Profissional">↓ XLSX 🔒</div>
          }
        </div>
      </div>

      {/* Filtros de período */}
      <div className="period-btns" style={{ display:"flex", gap:6, marginBottom: periodo==="periodo" ? 8 : 16, background:"#1a1c27", borderRadius:10, padding:4 }}>
        {[["todos","Todos"],["mes","Este mês"],["hoje","Hoje"],["periodo","Por data"]].map(([id,label]) => (
          <button key={id} onClick={() => setPeriodo(id)} style={{ flex:1, padding:"7px 6px", background:periodo===id?"#16a34a":"transparent", border:"none", borderRadius:8, color:periodo===id?"#fff":"#8a8a9a", fontFamily:"inherit", fontSize:11, cursor:"pointer", fontWeight:periodo===id?600:400, whiteSpace:"nowrap" }}>{label}</button>
        ))}

      </div>

      {/* Filtro por data específica */}
      {periodo === "periodo" && (
        <div style={{ display:"flex", gap:8, marginBottom:8, alignItems:"center", flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, flex:1 }}>
            <label style={{ fontSize:10, color:"#5a5a6a", letterSpacing:1, whiteSpace:"nowrap" }}>DE</label>
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={{ ...iS(), flex:1, fontSize:12 }} />
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:6, flex:1 }}>
            <label style={{ fontSize:10, color:"#5a5a6a", letterSpacing:1, whiteSpace:"nowrap" }}>ATÉ</label>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={{ ...iS(), flex:1, fontSize:12 }} />
          </div>
          {(dataInicio || dataFim) && (
            <button onClick={() => { setDataInicio(""); setDataFim(""); }} style={{ padding:"10px 14px", background:"none", border:"1px solid #3a2020", borderRadius:8, color:"#ef4444", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>✕ Limpar</button>
          )}
        </div>
      )}



      {/* Cards resumo */}
      <div className="stats-3" style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:20 }}>
        {[["REGISTROS", regs.length, "", "#f97316"], ["TOTAL LITROS", fmtNum(regs.reduce((a,b)=>a+Number(b.quantidade||0),0)), "L", "#38bdf8"], ["TOTAL GASTO", fmtBRL(regs.reduce((a,b)=>a+Number(b.custo||0),0)), "", "#4ade80"]].map(([label,val,unit,cor]) => (
          <div key={label} style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:10, padding:"12px 14px", overflow:"hidden", minHeight:72, display:"flex", flexDirection:"column", justifyContent:"space-between" }}>
            <div style={{ fontSize:9, color:"#5a5a6a", letterSpacing:1, fontWeight:500 }}>{label}</div>
            <div style={{ fontSize:18, fontFamily:"'DM Mono',monospace", fontWeight:500, color:cor, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:6 }}>{val}{unit&&<span style={{fontSize:11,marginLeft:2,color:"#5a5a6a"}}>{unit}</span>}</div>
          </div>
        ))}
      </div>

      {/* ABA: RESUMO */}
      {aba === "resumo" && (
        <div>
          <div style={{ display:"flex", gap:8, marginBottom:14, flexWrap:"wrap" }}>
            {[["departamento","🏢 Depto"],["veiculo","🚗 Veículo"],["motorista","👤 Motorista"],["combustivel","⛽ Combustível"],...(isAdmin?[["estabelecimento","🏪 Posto"]]:[])].map(([id,label]) => (
              <button key={id} onClick={() => setTipo(id)} style={{ padding:"8px 14px", background:tipo===id?"#f97316":"#1a1c27", border:`1px solid ${tipo===id?"#f97316":"#2a2c3a"}`, borderRadius:8, color:tipo===id?"#fff":"#8a8a9a", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>{label}</button>
            ))}
          </div>
          {lista.length === 0 ? <EmptyState>Nenhum dado.</EmptyState> : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {lista.map(([chave, dados]) => {
                const pct = totalCusto > 0 ? (dados.custo / totalCusto) * 100 : 0;
                return (
                  <div key={chave} style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:10, padding:"14px 18px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
                      <div>
                        <div style={{ fontSize:14, fontWeight:500, color:"#fff", fontFamily:"'DM Mono',monospace" }}>{chave}</div>
                        <div style={{ fontSize:11, color:"#5a5a6a", marginTop:2 }}>{dados.count} registro{dados.count!==1?"s":""} · {fmtNum(dados.litros)} L</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:16, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#f97316" }}>{fmtBRL(dados.custo)}</div>
                        <div style={{ fontSize:11, color:"#5a5a6a" }}>{pct.toFixed(1)}%</div>
                      </div>
                    </div>
                    <div style={{ height:4, background:"#2a2c3a", borderRadius:2 }}><div style={{ height:4, background:"#f97316", borderRadius:2, width:`${pct}%`, transition:"width 0.5s ease" }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ABA: POR SECRETARIA */}
      {aba === "secretaria" && (
        <div>
          <div style={{ display:"flex", gap:10, marginBottom:16, alignItems:"center", flexWrap:"wrap" }}>
            <select value={filtroSecretaria} onChange={(e) => setFiltroSecretaria(e.target.value)} style={{ ...iS(), width:"auto", fontSize:13 }}>
              <option value="">— Selecione a secretaria —</option>
              {secretariasUnicas.map((s) => <option key={s}>{s}</option>)}
            </select>

          </div>
          {!filtroSecretaria ? (
            <EmptyState>Selecione uma secretaria para ver os detalhes.</EmptyState>
          ) : regsSecretaria.length === 0 ? (
            <EmptyState>Nenhum registro para esta secretaria no período.</EmptyState>
          ) : (
            <div>
              <div className="stats-3" style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
                {[["REGISTROS",regsSecretaria.length,""],["LITROS",fmtNum(regsSecretaria.reduce((a,b)=>a+Number(b.quantidade||0),0)),"L"],["GASTO",fmtBRL(regsSecretaria.reduce((a,b)=>a+Number(b.custo||0),0)),""]].map(([label,val,unit]) => (
                  <div key={label} style={{ background:"#1e3a2a", border:"1px solid #16a34a", borderRadius:10, padding:"12px 14px", overflow:"hidden", minHeight:72, display:"flex", flexDirection:"column", justifyContent:"space-between" }}>
                    <div style={{ fontSize:9, color:"#4ade80", letterSpacing:1, fontWeight:500 }}>{label}</div>
                    <div style={{ fontSize:18, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#4ade80", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:6 }}>{val}{unit&&<span style={{fontSize:11,marginLeft:2}}>{unit}</span>}</div>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {regsSecretaria.map((r) => (
                  <div key={r.id||r._localId} style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:8, padding:"12px 16px", display:"grid", gridTemplateColumns:"1.2fr 1fr 1fr 1fr", gap:10, alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:12, fontWeight:500, color:"#fff" }}>{r.motorista_nome}</div>
                      <div style={{ fontSize:10, color:"#5a5a6a", marginTop:1 }}>{(r.data_hora||"").slice(0,16).replace("T"," ")}</div>
                    </div>
                    <div style={{ fontSize:12, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#fff" }}>{r.placa}</div>
                    <div style={{ fontSize:11, color:"#f97316" }}>{r.combustivel}</div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:13, fontWeight:500 }}>{fmtNum(r.quantidade)} L</div>
                      <div style={{ fontSize:11, color:"#4ade80" }}>{fmtBRL(r.custo)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA: HISTÓRICO */}
      {aba === "historico" && (
        <div>
          <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
            <div style={{ display:"flex", gap:6 }}>
              {[["veiculo","🚗 Por Veículo"],["motorista","👤 Por Motorista"]].map(([id,label]) => (
                <button key={id} onClick={() => { setFiltroHistorico(id); setFiltroHistoricoValor(""); }} style={{ padding:"8px 14px", background:filtroHistorico===id?"#f97316":"#1a1c27", border:`1px solid ${filtroHistorico===id?"#f97316":"#2a2c3a"}`, borderRadius:8, color:filtroHistorico===id?"#fff":"#8a8a9a", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>{label}</button>
              ))}
            </div>
            <select value={filtroHistoricoValor} onChange={(e) => setFiltroHistoricoValor(e.target.value)} style={{ ...iS(), width:"auto", fontSize:13 }}>
              <option value="">— Selecione —</option>
              {(filtroHistorico === "veiculo" ? placasUnicas : motoristasUnicos).map((v) => <option key={v}>{v}</option>)}
            </select>
          </div>
          {!filtroHistoricoValor ? (
            <EmptyState>Selecione um {filtroHistorico === "veiculo" ? "veículo" : "motorista"} para ver o histórico.</EmptyState>
          ) : regsHistorico.length === 0 ? (
            <EmptyState>Nenhum registro encontrado.</EmptyState>
          ) : (
            <div>
              <div className="stats-3" style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
                {[["REGISTROS",regsHistorico.length,""],["LITROS",fmtNum(regsHistorico.reduce((a,b)=>a+Number(b.quantidade||0),0)),"L"],["GASTO",fmtBRL(regsHistorico.reduce((a,b)=>a+Number(b.custo||0),0)),""]].map(([label,val,unit]) => (
                  <div key={label} style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:10, padding:"12px 14px", overflow:"hidden", minHeight:72, display:"flex", flexDirection:"column", justifyContent:"space-between" }}>
                    <div style={{ fontSize:9, color:"#5a5a6a", letterSpacing:1, fontWeight:500 }}>{label}</div>
                    <div style={{ fontSize:18, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#38bdf8", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginTop:6 }}>{val}{unit&&<span style={{fontSize:11,marginLeft:2,color:"#5a5a6a"}}>{unit}</span>}</div>
                  </div>
                ))}
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {regsHistorico.sort((a,b) => new Date(b.data_hora) - new Date(a.data_hora)).map((r) => (
                  <div key={r.id||r._localId} style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:8, padding:"10px 14px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div>
                        <div style={{ fontSize:12, fontWeight:500, color:"#fff" }}>{filtroHistorico==="veiculo" ? r.motorista_nome : r.placa}</div>
                        <div style={{ fontSize:10, color:"#5a5a6a", marginTop:1 }}>{(r.data_hora||"").slice(0,16).replace("T"," ")} · {r.combustivel}</div>
                        {r.hodometro && <div style={{ fontSize:10, color:"#8a8a9a", marginTop:1 }}>Hodômetro: {fmtNum(r.hodometro,0)} km</div>}
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:14, fontWeight:500 }}>{fmtNum(r.quantidade)} L</div>
                        <div style={{ fontSize:11, color:"#4ade80" }}>{fmtBRL(r.custo)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA: CONSUMO KM/L */}
      {aba === "consumo" && (
        <div style={{ paddingBottom:40 }}>
          <div style={{ background:"#1e2535", border:"1px solid #38bdf8", borderRadius:10, padding:"12px 16px", marginBottom:16, fontSize:12, color:"#38bdf8" }}>
            ℹ️ O consumo km/L é calculado automaticamente a partir do hodômetro. Registre o hodômetro nos abastecimentos para ativar esta função.
          </div>
          {consumoVeiculos.length === 0 ? (
            <EmptyState>Nenhum veículo com dados de hodômetro suficientes.</EmptyState>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {consumoVeiculos.sort((a,b) => (b.kmL||0) - (a.kmL||0)).map((v) => (
                <div key={v.id} style={{ background:"#1a1c27", border:`1px solid ${v.alerta?"#ef4444":"#2a2c3a"}`, borderRadius:10, padding:"14px 18px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <div style={{ fontSize:14, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#fff" }}>{v.placa}</div>
                        {v.alerta && <span style={{ fontSize:9, background:"#2d0f0f", border:"1px solid #ef4444", borderRadius:4, padding:"2px 6px", color:"#ef4444" }}>⚠️ CONSUMO ANORMAL</span>}
                      </div>
                      <div style={{ fontSize:11, color:"#8a8a9a", marginTop:2 }}>{v.departamento}{v.modelo?" · "+v.modelo:""} · {v.totalRegs} registros com hodômetro</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:20, fontFamily:"'DM Mono',monospace", fontWeight:500, color: v.alerta?"#ef4444":"#4ade80" }}>{v.kmL.toFixed(1)}</div>
                      <div style={{ fontSize:10, color:"#5a5a6a" }}>km/L</div>
                    </div>
                  </div>
                  {v.mediaHist && (
                    <div style={{ marginTop:10, display:"flex", gap:8 }}>
                      <div style={{ flex:1, background:"#0f1117", borderRadius:6, padding:"6px 10px" }}>
                        <div style={{ fontSize:9, color:"#5a5a6a", letterSpacing:1 }}>MÉDIA HISTÓRICA</div>
                        <div style={{ fontSize:14, color:"#8a8a9a", fontWeight:600 }}>{v.mediaHist.toFixed(1)} km/L</div>
                      </div>
                      <div style={{ flex:1, background:"#0f1117", borderRadius:6, padding:"6px 10px" }}>
                        <div style={{ fontSize:9, color:"#5a5a6a", letterSpacing:1 }}>ÚLTIMO INTERVALO</div>
                        <div style={{ fontSize:14, color: v.alerta?"#ef4444":"#4ade80", fontWeight:600 }}>{v.ultimaMedia?.toFixed(1)} km/L</div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ABA: FINANCEIRO */}
      {aba === "financeiro" && (
        <div>
          {/* Custo por km */}
          <div style={{ marginBottom:24 }}>
            <div style={{ fontSize:11, color:"#5a5a6a", letterSpacing:2, marginBottom:14 }}>💰 CUSTO POR KM RODADO (R$/KM)</div>
            <div style={{ background:"#1e2535", border:"1px solid #38bdf8", borderRadius:10, padding:"12px 16px", marginBottom:14, fontSize:12, color:"#38bdf8" }}>
              ℹ️ Calculado a partir do hodômetro registrado nos abastecimentos.
            </div>
            {(() => {
              const custoPorKm = veiculos.map((v) => {
                const regsV = registros.filter((r) => r.placa === v.placa && r.hodometro && r.custo);
                if (regsV.length < 2) return null;
                const sorted = [...regsV].sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));
                const kmTotal = sorted[sorted.length-1].hodometro - sorted[0].hodometro;
                const custoTotal = sorted.slice(1).reduce((a, b) => a + Number(b.custo||0), 0);
                if (kmTotal <= 0) return null;
                return { ...v, custoPorKm: custoTotal / kmTotal, kmTotal, custoTotal };
              }).filter(Boolean).sort((a, b) => b.custoPorKm - a.custoPorKm);

              return custoPorKm.length === 0 ? (
                <EmptyState>Nenhum veículo com dados suficientes de hodômetro.</EmptyState>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {custoPorKm.map((v) => (
                    <div key={v.id} style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:10, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ fontSize:14, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#fff" }}>{v.placa}</div>
                        </div>
                        <div style={{ fontSize:11, color:"#8a8a9a", marginTop:2 }}>{v.departamento}{v.modelo?" · "+v.modelo:""} · {fmtNum(v.kmTotal,0)} km rodados</div>
                        <div style={{ fontSize:11, color:"#5a5a6a", marginTop:1 }}>Total gasto: {fmtBRL(v.custoTotal)}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:18, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#38bdf8" }}>{fmtBRL(v.custoPorKm)}</div>
                        <div style={{ fontSize:10, color:"#5a5a6a" }}>por km</div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Comparativo mês a mês */}
          <div>
            <div style={{ fontSize:11, color:"#5a5a6a", letterSpacing:2, marginBottom:14 }}>📅 COMPARATIVO MÊS A MÊS</div>
            {(() => {
              const hoje = new Date();
              const meses = [];
              for (let i = 5; i >= 0; i--) {
                const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
                const key = d.toISOString().slice(0, 7);
                const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
                const regsM = registros.filter((r) => (r.data_hora||"").startsWith(key));
                meses.push({
                  key, label,
                  custo: regsM.reduce((a, b) => a + Number(b.custo||0), 0),
                  litros: regsM.reduce((a, b) => a + Number(b.quantidade||0), 0),
                  count: regsM.length,
                });
              }
              const maxCusto = Math.max(...meses.map((m) => m.custo), 1);
              const mesAtual = meses[meses.length-1];
              const mesAnterior = meses[meses.length-2];
              const variacao = mesAnterior.custo > 0 ? ((mesAtual.custo - mesAnterior.custo) / mesAnterior.custo) * 100 : 0;

              return (
                <div>
                  {/* Cards comparativos */}
                  <div className="stats-3" style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:20 }}>
                    <div style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:10, padding:"14px 18px" }}>
                      <div style={{ fontSize:9, color:"#5a5a6a", letterSpacing:1, fontWeight:500 }}>MÊS ATUAL</div>
                      <div style={{ fontSize:18, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#f97316", marginTop:6, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fmtBRL(mesAtual.custo)}</div>
                      <div style={{ fontSize:10, color:"#5a5a6a", marginTop:2 }}>{fmtNum(mesAtual.litros)} L · {mesAtual.count} abast.</div>
                    </div>
                    <div style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:10, padding:"14px 18px" }}>
                      <div style={{ fontSize:9, color:"#5a5a6a", letterSpacing:1, fontWeight:500 }}>MÊS ANTERIOR</div>
                      <div style={{ fontSize:18, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#8a8a9a", marginTop:6, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fmtBRL(mesAnterior.custo)}</div>
                      <div style={{ fontSize:10, color:"#5a5a6a", marginTop:2 }}>{fmtNum(mesAnterior.litros)} L · {mesAnterior.count} abast.</div>
                    </div>
                    <div style={{ background: variacao > 0 ? "#2d0f0f" : "#14532d", border:`1px solid ${variacao > 0 ? "#ef4444" : "#16a34a"}`, borderRadius:10, padding:"14px 18px" }}>
                      <div style={{ fontSize:9, color:"#5a5a6a", letterSpacing:1, fontWeight:500 }}>VARIAÇÃO</div>
                      <div style={{ fontSize:18, fontFamily:"'DM Mono',monospace", fontWeight:500, color: variacao > 0 ? "#ef4444" : "#4ade80", marginTop:6, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {variacao > 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1)}%
                      </div>
                      <div style={{ fontSize:10, color:"#5a5a6a", marginTop:2 }}>{variacao > 0 ? "aumento" : "redução"} vs mês anterior</div>
                    </div>
                  </div>

                  {/* Gráfico de barras dos 6 meses */}
                  <div style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:12, padding:"20px 24px" }}>
                    <div style={{ fontSize:10, color:"#5a5a6a", letterSpacing:2, marginBottom:16 }}>ÚLTIMOS 6 MESES — GASTO (R$)</div>
                    <div style={{ display:"flex", alignItems:"flex-end", gap:8, height:120 }}>
                      {meses.map((m, i) => {
                        const h = maxCusto > 0 ? (m.custo / maxCusto) * 100 : 0;
                        const isAtual = i === meses.length - 1;
                        return (
                          <div key={m.key} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                            {m.custo > 0 && <div style={{ fontSize:8, color:"#5a5a6a", textAlign:"center" }}>{fmtBRL(m.custo).replace("R$ ","")}</div>}
                            <div style={{ width:"100%", height:`${Math.max(h, m.custo > 0 ? 4 : 0)}%`, background: isAtual ? "#f97316" : "#38bdf8", borderRadius:"4px 4px 0 0", transition:"height 0.5s ease", opacity: isAtual ? 1 : 0.6, minHeight: m.custo > 0 ? 4 : 0 }} />
                            <div style={{ fontSize:9, color: isAtual ? "#f97316" : "#5a5a6a", fontWeight: isAtual ? 600 : 400 }}>{m.label}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tabela mensal */}
                  <div style={{ marginTop:16, display:"flex", flexDirection:"column", gap:6 }}>
                    {[...meses].reverse().map((m) => (
                      <div key={m.key} style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:8, padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <div style={{ fontSize:13, fontWeight:500, color:"#fff", textTransform:"capitalize" }}>{new Date(m.key+"-15").toLocaleDateString("pt-BR",{month:"long",year:"numeric"})}</div>
                          <div style={{ fontSize:11, color:"#5a5a6a", marginTop:1 }}>{m.count} abastecimento{m.count!==1?"s":""} · {fmtNum(m.litros)} L</div>
                        </div>
                        <div style={{ fontSize:15, fontFamily:"'DM Mono',monospace", fontWeight:500, color: m.key===hoje.toISOString().slice(0,7)?"#f97316":"#8a8a9a" }}>{fmtBRL(m.custo)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {aba === "comparativo" && (
        <div>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, color:"#5a5a6a", letterSpacing:1, marginBottom:8 }}>PERÍODO</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {[["3","Últimos 3 meses"],["6","Últimos 6 meses"],["12","Últimos 12 meses"]].map(([v,l]) => (
                <button key={v} onClick={() => setComparativoMeses(Number(v))} style={{ padding:"7px 14px", background: comparativoMeses===Number(v)?"#f97316":"#1a1c27", border:`1px solid ${comparativoMeses===Number(v)?"#f97316":"#2a2c3a"}`, borderRadius:8, color: comparativoMeses===Number(v)?"#fff":"#8a8a9a", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>{l}</button>
              ))}
            </div>
          </div>

          {(() => {
            const meses = [];
            const hoje2 = new Date();
            for (let i = comparativoMeses - 1; i >= 0; i--) {
              const d = new Date(hoje2.getFullYear(), hoje2.getMonth() - i, 1);
              meses.push({ key: d.toISOString().slice(0,7), label: d.toLocaleString("pt-BR", { month:"short", year:"2-digit" }).toUpperCase() });
            }
            const secretarias = [...new Set(registros.map((r) => r.departamento).filter(Boolean))].sort();
            const dados = secretarias.map((sec) => ({
              nome: sec,
              meses: meses.map((m) => ({
                mes: m.label,
                valor: registros.filter((r) => r.departamento === sec && (r.data_hora||"").startsWith(m.key)).reduce((a,b) => a + Number(b.custo||0), 0)
              }))
            }));
            const cores = ["#f97316","#38bdf8","#4ade80","#a78bfa","#fbbf24","#f472b6","#34d399","#60a5fa"];
            const maxValor = Math.max(...dados.flatMap((d) => d.meses.map((m) => m.valor)), 1);

            return (
              <div>
                {/* Gráfico de barras */}
                <div style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:12, padding:16, marginBottom:16, overflowX:"auto" }}>
                  <div style={{ fontSize:10, color:"#5a5a6a", letterSpacing:1, marginBottom:12 }}>GASTO POR SECRETARIA (R$)</div>
                  <div style={{ display:"flex", gap:4, alignItems:"flex-end", minWidth: meses.length * 80 + "px", height:180 }}>
                    {meses.map((m, mi) => (
                      <div key={m.key} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        <div style={{ width:"100%", display:"flex", gap:2, alignItems:"flex-end", height:150 }}>
                          {dados.map((sec, si) => {
                            const val = sec.meses[mi].valor;
                            const h = maxValor > 0 ? Math.max((val/maxValor)*140, val > 0 ? 4 : 0) : 0;
                            return (
                              <div key={sec.nome} title={`${sec.nome}: ${fmtBRL(val)}`} style={{ flex:1, height:h+"px", background:cores[si % cores.length], borderRadius:"3px 3px 0 0", transition:"height 0.3s", opacity:0.85, cursor:"pointer" }} />
                            );
                          })}
                        </div>
                        <div style={{ fontSize:9, color:"#5a5a6a", letterSpacing:0.5 }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Legenda */}
                  <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginTop:12 }}>
                    {dados.map((sec, si) => (
                      <div key={sec.nome} style={{ display:"flex", alignItems:"center", gap:5 }}>
                        <div style={{ width:10, height:10, borderRadius:2, background:cores[si % cores.length] }} />
                        <span style={{ fontSize:10, color:"#8a8a9a" }}>{sec.nome}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tabela comparativa */}
                <div style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:12, padding:16, overflowX:"auto" }}>
                  <div style={{ fontSize:10, color:"#5a5a6a", letterSpacing:1, marginBottom:12 }}>TABELA COMPARATIVA</div>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, fontFamily:"'DM Mono',monospace" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign:"left", padding:"6px 8px", color:"#5a5a6a", borderBottom:"1px solid #2a2c3a" }}>SECRETARIA</th>
                        {meses.map((m) => <th key={m.key} style={{ textAlign:"right", padding:"6px 8px", color:"#5a5a6a", borderBottom:"1px solid #2a2c3a", whiteSpace:"nowrap" }}>{m.label}</th>)}
                        <th style={{ textAlign:"right", padding:"6px 8px", color:"#f97316", borderBottom:"1px solid #2a2c3a" }}>TOTAL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.sort((a,b) => b.meses.reduce((s,m)=>s+m.valor,0) - a.meses.reduce((s,m)=>s+m.valor,0)).map((sec, si) => {
                        const total = sec.meses.reduce((s,m) => s+m.valor, 0);
                        return (
                          <tr key={sec.nome} style={{ borderBottom:"1px solid #1a1c27" }}>
                            <td style={{ padding:"8px", color:"#e8e4d9" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                <div style={{ width:8, height:8, borderRadius:2, background:cores[si % cores.length], flexShrink:0 }} />
                                {sec.nome}
                              </div>
                            </td>
                            {sec.meses.map((m, mi) => {
                              const prev = mi > 0 ? sec.meses[mi-1].valor : null;
                              const diff = prev !== null && prev > 0 ? ((m.valor - prev) / prev * 100) : null;
                              return (
                                <td key={m.mes} style={{ padding:"8px", textAlign:"right", color: m.valor > 0 ? "#e8e4d9" : "#3a3a4a" }}>
                                  {m.valor > 0 ? fmtBRL(m.valor) : "—"}
                                  {diff !== null && m.valor > 0 && (
                                    <div style={{ fontSize:9, color: diff > 0 ? "#ef4444" : "#4ade80" }}>{diff > 0 ? "▲" : "▼"}{Math.abs(diff).toFixed(0)}%</div>
                                  )}
                                </td>
                              );
                            })}
                            <td style={{ padding:"8px", textAlign:"right", color:"#f97316", fontWeight:600 }}>{fmtBRL(total)}</td>
                          </tr>
                        );
                      })}
                      {/* Total geral */}
                      <tr style={{ borderTop:"2px solid #2a2c3a" }}>
                        <td style={{ padding:"8px", color:"#f97316", fontWeight:600 }}>TOTAL GERAL</td>
                        {meses.map((m) => (
                          <td key={m.key} style={{ padding:"8px", textAlign:"right", color:"#f97316", fontWeight:600 }}>
                            {fmtBRL(dados.reduce((s,sec) => s + (sec.meses.find(x=>x.mes===m.label)?.valor||0), 0))}
                          </td>
                        ))}
                        <td style={{ padding:"8px", textAlign:"right", color:"#f97316", fontWeight:600 }}>
                          {fmtBRL(dados.reduce((s,sec) => s + sec.meses.reduce((ss,m2)=>ss+m2.valor,0), 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      )}

    </div>
  );
}

// ── App Principal ─────────────────────────────────────
export default function App() {
  const [usuario, setUsuario] = useState(() => cache.get("usuario_sessao"));
  const [tema, setTema] = useState(() => cache.get("tema") || "escuro");
  const isDark = tema === "escuro";
  const toggleTema = () => { const novo = tema === "escuro" ? "claro" : "escuro"; setTema(novo); cache.set("tema", novo); };
  const online = useOnline();
  const [activeTab, setActiveTab] = useState(usuario?.perfil === "operador" ? "registrar" : "dashboard");
  const [alertaModal, setAlertaModal] = useState(true); // mostra ao logar
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const [motoristas, setMotoristas] = useState(() => cache.get("motoristas") || []);
  const [veiculos, setVeiculos] = useState(() => cache.get("veiculos") || []);
  const [registros, setRegistros] = useState(() => cache.get("registros") || []);
  const [departamentos, setDepartamentos] = useState(() => cache.get("departamentos") || []);
  const [estabelecimentos, setEstabelecimentos] = useState([]);
  const [logs, setLogs] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(false);

  const [comprovante, setComprovante] = useState(null);
  const [minhaConta, setMinhaConta] = useState(false);
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [senhaOk, setSenhaOk] = useState(false);
  const [senhaErro, setSenhaErro] = useState("");
  const [editReg, setEditReg] = useState(null); // registro sendo editado pelo operador
  const [qrModal, setQrModal] = useState(null);
  const [search, setSearch] = useState("");
  
  const [filtroEstDash, setFiltroEstDash] = useState("");
  const [pagina, setPagina] = useState(1);
  const POR_PAGINA = 20;

  const [form, setForm] = useState({ dataHora: now(), combustivel: COMBUSTIVEIS[0], quantidade: "", custo: "", hodometro: "", cupom_fiscal: "" });
  const [ultimoMot, setUltimoMot] = useState(() => cache.get("ultimo_motorista"));
  const [ultimoVeic, setUltimoVeic] = useState(() => cache.get("ultimo_veiculo"));
  const [formErrors, setFormErrors] = useState({});
  const [scannedMot, setScannedMot] = useState(null);
  const [scannedVeic, setScannedVeic] = useState(null);
  const [motScanErr, setMotScanErr] = useState("");
  const [veicScanErr, setVeicScanErr] = useState("");

  const [motForm, setMotForm] = useState({ nome: "", cnh: "", departamento: "", venc_cnh: "" });
  const [motErrors, setMotErrors] = useState({});
  const [motOk, setMotOk] = useState(false);
  const [editMotorista, setEditMotorista] = useState(null);
  const [editVeiculo, setEditVeiculo] = useState(null);
  const [veicForm, setVeicForm] = useState({ placa: "", modelo: "", ano: "", departamento: "", status: "ativo", venc_crlv: "", venc_seguro_obrigatorio: "" });
  const [veicErrors, setVeicErrors] = useState({});
  const [veicOk, setVeicOk] = useState(false);
  const [novoDpto, setNovoDpto] = useState("");
  const [dptoError, setDptoError] = useState("");
  const [dptoOk, setDptoOk] = useState(false);
  const [estForm, setEstForm] = useState({ nome: "", cnpj: "", telefone: "", plano: "basico", ativo: true });
  const [estOk, setEstOk] = useState(false);
  const [editEst, setEditEst] = useState(null);
  const [editEstOk, setEditEstOk] = useState(false);
  const [userForm, setUserForm] = useState({ nome: "", email: "", perfil: "gestor", estabelecimento_id: "" });
  const [userOk, setUserOk] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [editUserOk, setEditUserOk] = useState(false);

  const isAdmin = usuario?.perfil === "admin";
  const isGestor = usuario?.perfil === "gestor";
  const isOperador = usuario?.perfil === "operador";
  const podeGerenciar = isAdmin || isGestor;
  const podeDashboard = isAdmin || isGestor;

  // ── Controle de Planos ─────────────────────────────
  const plano = usuario?.estabelecimentos?.plano || "basico";
  const PLANOS = {
    basico:       { label: "Básico",       maxVeiculos: 15, maxUsuarios: 2,  relatorios: false, csv: false, pdf: false, kmL: false, financeiro: false },
    profissional: { label: "Profissional", maxVeiculos: 50, maxUsuarios: 5,  relatorios: true,  csv: true,  pdf: true,  kmL: true,  financeiro: true  },
    enterprise:   { label: "Enterprise",   maxVeiculos: 999,maxUsuarios: 999,relatorios: true,  csv: true,  pdf: true,  kmL: true,  financeiro: true  },
  };
  const planoAtual = isAdmin ? PLANOS.enterprise : (PLANOS[plano] || PLANOS.basico);
  const podeRelatorios = isAdmin || planoAtual.relatorios;
  const podeCSV = isAdmin || planoAtual.csv;
  const podePDF = isAdmin || planoAtual.pdf;
  const podeKmL = isAdmin || planoAtual.kmL;
  const podeFinanceiro = isAdmin || planoAtual.financeiro;
  const limiteVeiculos = planoAtual.maxVeiculos;
  const limiteUsuarios = planoAtual.maxUsuarios;
  const estId = usuario?.estabelecimento_id;
  const estNome = usuario?.estabelecimentos?.nome || "";

  const handleLogin = (u) => { cache.set("usuario_sessao", u); setUsuario(u); };
  const handleAlterarMinhaSenha = async () => {
    setSenhaErro("");
    if (!novaSenha.trim()) { setSenhaErro("Informe a nova senha"); return; }
    if (novaSenha.length < 6) { setSenhaErro("Senha deve ter pelo menos 6 caracteres"); return; }
    if (novaSenha !== confirmarSenha) { setSenhaErro("Senhas não conferem"); return; }
    if (!usuario?.auth_id) { setSenhaErro("Usuário sem auth_id. Contate o administrador."); return; }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/alterar_senha_usuario`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_auth_id: usuario.auth_id, p_nova_senha: novaSenha }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Erro ao alterar senha"); }
      setSenhaOk(true); setNovaSenha(""); setConfirmarSenha("");
      setTimeout(() => { setSenhaOk(false); setMinhaConta(false); }, 2000);
    } catch (err) { setSenhaErro(err.message); }
  };

  const handleLogout = async () => {
    const token = usuario?.accessToken;
    cache.del("usuario_sessao");
    setUsuario(null);
    if (token) { try { await authLogout(token); } catch (_) {} }
  };

  useEffect(() => { if (!usuario || !online) return; loadData(); }, [usuario, online]);
  useEffect(() => { if (activeTab === "logs" && isAdmin && online) { api.get("logs", "order=created_at.desc&limit=200").then(setLogs).catch(() => {}); } }, [activeTab]);
  useEffect(() => { if (!online || !usuario) return; syncQueue(); }, [online]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Isolamento: estabelecimento vê só os seus, admin vê tudo
      const q = isAdmin ? "" : `estabelecimento_id=eq.${estId}`;
      const [m, v, r, d] = await Promise.all([
        api.get("motoristas", q),
        api.get("veiculos", q),
        api.get("abastecimentos", `${q}${q ? "&" : ""}order=created_at.desc`),
        api.get("departamentos", q),
      ]);
      const offlineRegs = (cache.get("registros") || []).filter((r) => r._offline);
      const merged = [...offlineRegs, ...r];
      setMotoristas(m); cache.set("motoristas", m);
      setVeiculos(v); cache.set("veiculos", v);
      setRegistros(merged); cache.set("registros", merged);
      setDepartamentos(d); cache.set("departamentos", d);
      if (isAdmin) {
        const [ests, users] = await Promise.all([api.get("estabelecimentos"), api.get("usuarios", "select=*,estabelecimentos(*)")]);
        setEstabelecimentos(ests); setUsuarios(users);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const syncQueue = async () => {
    const queue = getQueue();
    if (queue.length === 0) return;
    setSyncing(true); setSyncMsg(`Sincronizando ${queue.length} registro(s)...`);
    let sucesso = 0;
    for (const item of queue) {
      try { const { _offline, _localId, id, ...data } = item; await api.post("abastecimentos", data); sucesso++; } catch (e) { console.error(e); }
    }
    clearQueue(); await loadData();
    setSyncing(false); setSyncMsg(sucesso > 0 ? `✓ ${sucesso} registro(s) sincronizado(s)!` : "");
    setTimeout(() => setSyncMsg(""), 4000);
  };

  const handleMotQR = useCallback((raw) => {
    try { const d = JSON.parse(raw); const m = motoristas.find((x) => x.id === d.id && d.tipo === "motorista"); if (m) { setScannedMot(m); setFormErrors((e) => ({ ...e, motoristaId: undefined })); } else setMotScanErr("Motorista não encontrado."); } catch { setMotScanErr("QR inválido."); }
  }, [motoristas]);

  const handleVeicQR = useCallback((raw) => {
    try { const d = JSON.parse(raw); const v = veiculos.find((x) => x.id === d.id && d.tipo === "veiculo"); if (v) { setScannedVeic(v); setFormErrors((e) => ({ ...e, placaId: undefined })); } else setVeicScanErr("Veículo não encontrado."); } catch { setVeicScanErr("QR inválido."); }
  }, [veiculos]);

  const motScanner = useQRScanner(handleMotQR);
  const veicScanner = useQRScanner(handleVeicQR);
  const startMotScan = () => { veicScanner.stop(); setMotScanErr(""); motScanner.start(); };
  const startVeicScan = () => { motScanner.stop(); setVeicScanErr(""); veicScanner.start(); };

  const handleRegistrar = async () => {
    const e = {};
    if (!scannedMot) e.motoristaId = "Identifique o motorista";
    if (!scannedVeic) e.placaId = "Identifique o veículo";
    if (!form.quantidade || +form.quantidade <= 0) e.quantidade = "Inválido";
    if (!form.custo || +form.custo <= 0) e.custo = "Inválido";
    if (Object.keys(e).length > 0) { setFormErrors(e); return; }
    const novoReg = {
      data_hora: new Date(form.dataHora).toISOString(),
      motorista_id: scannedMot.id, motorista_nome: scannedMot.nome, motorista_cnh: scannedMot.cnh,
      veiculo_id: scannedVeic.id, placa: scannedVeic.placa, modelo: scannedVeic.modelo,
      departamento: scannedVeic.departamento, combustivel: form.combustivel,
      quantidade: parseFloat(form.quantidade), custo: parseFloat(form.custo),
      hodometro: form.hodometro ? parseFloat(form.hodometro) : null,
      cupom_fiscal: form.cupom_fiscal || null,
      operador: estNome, estabelecimento_id: estId,
    };
    if (online) {
      try { const salvo = await api.post("abastecimentos", novoReg); const atualizado = [salvo[0], ...registros]; setRegistros(atualizado); cache.set("registros", atualizado); setComprovante(salvo[0]); }
      catch { alert("Erro ao salvar."); return; }
    } else {
      const regOffline = { ...novoReg, _offline: true, _localId: Date.now(), id: `offline_${Date.now()}` };
      addToQueue(novoReg); const atualizado = [regOffline, ...registros]; setRegistros(atualizado); cache.set("registros", atualizado); setComprovante(regOffline);
    }
    // Salvar último motorista e veículo usados
    if (mot) { setUltimoMot(mot); cache.set("ultimo_motorista", mot); }
    if (veic) { setUltimoVeic(veic); cache.set("ultimo_veiculo", veic); }
    registrarLog(usuario, "ABASTECIMENTO_CRIADO", (veic?.placa||"") + " · " + (mot?.nome||"") + " · " + fmtBRL(parseFloat(form.custo)||0));
    setForm({ dataHora: now(), combustivel: COMBUSTIVEIS[0], quantidade: "", custo: "", hodometro: "", cupom_fiscal: "" });
  };

  const handleMotSubmit = async () => {
    const e = {}; if (!motForm.nome.trim()) e.nome = "Obrigatório"; if (!motForm.departamento) e.departamento = "Selecione";
    if (Object.keys(e).length > 0) { setMotErrors(e); return; }
    if (!online) { alert("Precisa de conexão."); return; }
    try { const novo = await api.post("motoristas", { ...motForm, estabelecimento_id: estId }); const atualizado = [...motoristas, novo[0]]; setMotoristas(atualizado); cache.set("motoristas", atualizado); setMotForm({ nome: "", cnh: "", departamento: "" }); setMotOk(true); setTimeout(() => setMotOk(false), 2200); } catch (err) { alert("Erro: " + err.message); }
  };

  const handleVeicSubmit = async () => {
    // Verificar limite do plano
    if (!isAdmin && veiculos.length >= limiteVeiculos) {
      alert(`Limite de ${limiteVeiculos} veículos atingido para o plano ${planoAtual.label}. Faça upgrade para continuar.`);
      return;
    }
    const e = {}; if (!veicForm.placa.trim()) e.placa = "Obrigatório"; else if (veiculos.some((v) => v.placa.toUpperCase() === veicForm.placa.toUpperCase())) e.placa = "Placa já cadastrada"; if (!veicForm.departamento) e.departamento = "Selecione";
    if (Object.keys(e).length > 0) { setVeicErrors(e); return; }
    if (!online) { alert("Precisa de conexão."); return; }
    try { const novo = await api.post("veiculos", { ...veicForm, placa: veicForm.placa.toUpperCase(), estabelecimento_id: estId }); const atualizado = [...veiculos, novo[0]]; setVeiculos(atualizado); cache.set("veiculos", atualizado); setVeicForm({ placa: "", modelo: "", ano: "", departamento: "" }); setVeicOk(true); setTimeout(() => setVeicOk(false), 2200); } catch (err) { alert("Erro: " + err.message); }
  };

  const handleAddDpto = async () => {
    if (!novoDpto.trim()) { setDptoError("Informe o nome"); return; } if (departamentos.includes(novoDpto.trim())) { setDptoError("Já cadastrado"); return; }
    if (!online) { alert("Precisa de conexão."); return; }
    try { await api.post("departamentos", { nome: novoDpto.trim(), estabelecimento_id: estId }); const atualizado = [...departamentos, novoDpto.trim()]; setDepartamentos(atualizado); cache.set("departamentos", atualizado); setNovoDpto(""); setDptoError(""); setDptoOk(true); setTimeout(() => setDptoOk(false), 2000); } catch (err) { alert("Erro: " + err.message); }
  };

  const handleEstSubmit = async () => {
    if (!estForm.nome.trim()) return;
    try { const novo = await api.post("estabelecimentos", estForm); setEstabelecimentos((e) => [...e, novo[0]]); setEstForm({ nome: "", cnpj: "", telefone: "" }); setEstOk(true); setTimeout(() => setEstOk(false), 2200); } catch (err) { alert("Erro: " + err.message); }
  };

  const handleDeleteEst = async (id) => {
    if (!window.confirm("Excluir este estabelecimento? Os usuários vinculados perderão o acesso.")) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/estabelecimentos?id=eq.${id}`, {
        method: "DELETE",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=minimal" },
      });
      setEstabelecimentos((e) => e.filter((x) => x.id !== id));
    } catch (err) { alert("Erro ao excluir: " + err.message); }
  };

  const handleUpdateEst = async () => {
    if (!editEst?.nome?.trim()) { alert("Informe o nome"); return; }
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/estabelecimentos?id=eq.${editEst.id}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ nome: editEst.nome, cnpj: editEst.cnpj, telefone: editEst.telefone, plano: editEst.plano || 'basico' }),
      });
      setEstabelecimentos((ests) => ests.map((e) => e.id === editEst.id ? { ...e, ...editEst } : e));
      setEditEst(null);
      setEditEstOk(true); setTimeout(() => setEditEstOk(false), 2200);
    } catch (err) { alert("Erro ao editar: " + err.message); }
  };

  const handleUserSubmit = async () => {
    if (!userForm.nome.trim() || !userForm.email.trim()) return;
    if (!userForm.estabelecimento_id) { alert("Selecione um estabelecimento"); return; }
    try {
      // Usar função SQL segura que cria no Auth + tabela usuarios
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/criar_usuario_auth`, {
        method: "POST",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_email: userForm.email.trim(),
          p_senha: "",
          p_nome: userForm.nome.trim(),
          p_perfil: userForm.perfil,
          p_estabelecimento_id: userForm.estabelecimento_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.hint || "Erro ao criar usuário");
      // Recarregar lista de usuários
      const users = await api.get("usuarios", "select=*,estabelecimentos(*)");
      setUsuarios(users);
      setUserForm({ nome: "", email: "", perfil: "gestor", estabelecimento_id: "" });
      setUserOk(true); setTimeout(() => setUserOk(false), 2200);
    } catch (err) { alert("Erro: " + err.message); }
  };

  const handleDeleteUser = async (id) => {
    if (!window.confirm("Excluir este usuário?")) return;
    try {
      const userToDelete = usuarios.find((u) => u.id === id);
      // Excluir da tabela usuarios
      await fetch(`${SUPABASE_URL}/rest/v1/usuarios?id=eq.${id}`, {
        method: "DELETE",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=minimal" },
      });
      // Excluir do Supabase Auth se tiver auth_id
      if (userToDelete?.auth_id) {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userToDelete.auth_id}`, {
          method: "DELETE",
          headers: { "apikey": SUPABASE_SERVICE_KEY, "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}` },
        });
      }
      setUsuarios((u) => u.filter((x) => x.id !== id));
    } catch (err) { alert("Erro: " + err.message); }
  };

  const handleEditUser = async () => {
    if (!editUser?.novaSenha?.trim()) { alert("Informe a nova senha"); return; }
    if (editUser.novaSenha.length < 6) { alert("Senha deve ter pelo menos 6 caracteres"); return; }
    try {
      if (editUser.auth_id) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/alterar_senha_usuario`, {
          method: "POST",
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ p_auth_id: editUser.auth_id, p_nova_senha: editUser.novaSenha }),
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.message || "Erro ao alterar senha"); }
      }
      setEditUser(null); setEditUserOk(true); setTimeout(() => setEditUserOk(false), 2200);
    } catch (err) { alert("Erro: " + err.message); }
  };

  const imprimirTodosQRMotoristas = () => {
    const lista = motoristasVisiveis;
    if (lista.length === 0) { alert("Nenhum motorista para imprimir."); return; }

    const qrItems = lista.map((m) => {
      const dados = JSON.stringify({ id: m.id, tipo: "motorista" });
      return `
        <div class="qr-item">
          <div class="qr-label-top">${m.nome}</div>
          <div class="qr-label-sub">${m.departamento || ""}</div>
          <div class="qr-label-sub">${m.cnh ? "CNH: " + m.cnh : ""}</div>
          <div id="qrm-${m.id}" class="qr-box"></div>
          <div class="qr-label-bottom">⛽ AbastecePro</div>
          <script>
            (function(){
              var d = document.getElementById('qrm-${m.id}');
              new QRCode(d, { text: '${dados.replace(/'/g,"\'")}', width:160, height:160, correctLevel: QRCode.CorrectLevel.H });
            })();
          <\/script>
        </div>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>QR Codes — Motoristas</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; background: #fff; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 20px; }
      .qr-item { border: 1px solid #ddd; border-radius: 10px; padding: 14px; text-align: center; break-inside: avoid; }
      .qr-label-top { font-size: 14px; font-weight: bold; color: #111; margin-bottom: 4px; }
      .qr-label-sub { font-size: 11px; color: #666; margin-bottom: 2px; }
      .qr-box { display: flex; justify-content: center; margin: 10px 0; }
      .qr-box img { width: 160px; height: 160px; }
      .qr-label-bottom { font-size: 10px; color: #f97316; font-weight: bold; margin-top: 6px; letter-spacing: 1px; }
      @media print {
        @page { size: A4; margin: 10mm; }
        .grid { gap: 10px; padding: 0; }
      }
    </style></head>
    <body>
      <div class="grid">${qrItems}</div>
      <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 1500); };<\/script>
    </body></html>`;

    const w = window.open("", "_blank");
    if (w) w.document.write(html);
  };

  const imprimirTodosQRVeiculos = () => {
    const lista = veiculosVisiveis.filter((v) => v.status !== "inativo");
    if (lista.length === 0) { alert("Nenhum veículo ativo para imprimir."); return; }

    const qrItems = lista.map((v) => {
      const dados = JSON.stringify({ id: v.id, tipo: "veiculo" });
      return `
        <div class="qr-item">
          <div class="qr-label-top">${v.placa}</div>
          <div class="qr-label-sub">${v.modelo || ""} ${v.ano ? "· " + v.ano : ""}</div>
          <div class="qr-label-sub">${v.departamento || ""}</div>
          <div id="qr-${v.id}" class="qr-box"></div>
          <div class="qr-label-bottom">⛽ AbastecePro</div>
          <script>
            (function(){
              var d = document.getElementById('qr-${v.id}');
              var qr = new QRCode(d, { text: '${dados.replace(/'/g,"\'")}', width:160, height:160, correctLevel: QRCode.CorrectLevel.H });
            })();
          <\/script>
        </div>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>QR Codes — Veículos</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; background: #fff; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 20px; }
      .qr-item { border: 1px solid #ddd; border-radius: 10px; padding: 14px; text-align: center; break-inside: avoid; }
      .qr-label-top { font-size: 16px; font-weight: bold; color: #111; margin-bottom: 4px; }
      .qr-label-sub { font-size: 11px; color: #666; margin-bottom: 2px; }
      .qr-box { display: flex; justify-content: center; margin: 10px 0; }
      .qr-box img { width: 160px; height: 160px; }
      .qr-label-bottom { font-size: 10px; color: #f97316; font-weight: bold; margin-top: 6px; letter-spacing: 1px; }
      @media print {
        @page { size: A4; margin: 10mm; }
        .grid { gap: 10px; padding: 0; }
      }
    </style></head>
    <body>
      <div class="grid">${qrItems}</div>
      <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 1500); };<\/script>
    </body></html>`;

    const w = window.open("", "_blank");
    if (w) w.document.write(html);
  };

  const handleDeleteReg = async (reg) => {
    if (!window.confirm("Excluir este abastecimento? Esta ação não pode ser desfeita.")) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/abastecimentos?id=eq.${reg.id}`, {
        method: "DELETE",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
      });
      setRegistros((prev) => prev.filter((r) => r.id !== reg.id));
      registrarLog(usuario, "ABASTECIMENTO_EXCLUIDO", (reg.placa||"") + " · " + (reg.motorista_nome||"") + " · " + fmtBRL(parseFloat(reg.custo)||0));
    } catch (err) { alert("Erro ao excluir: " + err.message); }
  };

  const handleSaveEditReg = async () => {
    if (!editReg) return;
    const criado = new Date(editReg.data_hora || 0);
    const diffMin = (Date.now() - criado.getTime()) / 60000;
    if (diffMin > 30) { alert("Prazo de 30 minutos expirado. Não é possível editar este registro."); setEditReg(null); return; }
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/abastecimentos?id=eq.${editReg.id}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({
          combustivel: editReg.combustivel,
          quantidade: parseFloat(editReg.quantidade),
          custo: parseFloat(editReg.custo),
          hodometro: editReg.hodometro ? parseFloat(editReg.hodometro) : null,
        }),
      });
      setRegistros((regs) => regs.map((r) => r.id === editReg.id ? { ...r, ...editReg, quantidade: parseFloat(editReg.quantidade), custo: parseFloat(editReg.custo) } : r));
      registrarLog(usuario, "ABASTECIMENTO_EDITADO", (editReg.placa||"") + " · " + fmtBRL(parseFloat(editReg.custo)||0));
      setEditReg(null);
    } catch (err) { alert("Erro ao salvar: " + err.message); }
  };

  const handleUpdateMotorista = async () => {
    if (!editMotorista) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/motoristas?id=eq.${editMotorista.id}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ nome: editMotorista.nome, cnh: editMotorista.cnh, departamento: editMotorista.departamento, venc_cnh: editMotorista.venc_cnh || null }),
      });
      const atualizado = motoristas.map((m) => m.id === editMotorista.id ? { ...m, ...editMotorista } : m);
      setMotoristas(atualizado); cache.set("motoristas", atualizado);
      setEditMotorista(null);
    } catch (err) { alert("Erro: " + err.message); }
  };

  const handleUpdateVeiculo = async () => {
    if (!editVeiculo) return;
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/veiculos?id=eq.${editVeiculo.id}`, {
        method: "PATCH",
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ modelo: editVeiculo.modelo, ano: editVeiculo.ano, departamento: editVeiculo.departamento, status: editVeiculo.status, venc_crlv: editVeiculo.venc_crlv || null, venc_seguro_obrigatorio: editVeiculo.venc_seguro_obrigatorio || null }),
      });
      const atualizado = veiculos.map((v) => v.id === editVeiculo.id ? { ...v, ...editVeiculo } : v);
      setVeiculos(atualizado); cache.set("veiculos", atualizado);
      setEditVeiculo(null);
    } catch (err) { alert("Erro: " + err.message); }
  };

  const exportCSV = () => {
    const regsExport = isAdmin && filtroEstDash ? registros.filter((r) => r.operador === filtroEstDash) : registros;
    const h = ["Data/Hora", "Estabelecimento", "Motorista", "CNH", "Placa", "Departamento", "Combustível", "Qtd (L)", "Hodômetro", "Custo (R$)", "Status"];
    const rows = regsExport.map((r) => [(r.data_hora || "").slice(0, 16).replace("T", " "), r.operador, r.motorista_nome, r.motorista_cnh, r.placa, r.departamento, r.combustivel, r.quantidade, r.hodometro || "", r.custo, r._offline ? "Pendente" : "Sincronizado"]);
    const csv = [h, ...rows].map((r) => r.map((c) => `"${c ?? ""}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `abastecimentos_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const pendentes = getQueue().length;

  // Registros filtrados para a lista
  const regsVisiveis = isAdmin && filtroEstDash ? registros.filter((r) => r.operador === filtroEstDash) : registros;
  const filtered = regsVisiveis.filter((r) =>
    r.placa?.toUpperCase().includes(search.toUpperCase()) ||
    r.motorista_nome?.toLowerCase().includes(search.toLowerCase()) ||
    r.departamento?.toLowerCase().includes(search.toLowerCase()) ||
    r.operador?.toLowerCase().includes(search.toLowerCase())
  );

  if (!usuario) return <LoginScreen onLogin={handleLogin} />;

  // Filtrar motoristas e veículos pelo estabelecimento selecionado no header
  const departamentosVisiveis = isAdmin && filtroEstDash
    ? departamentos.filter((d) => { const est = estabelecimentos.find((e) => e.nome === filtroEstDash); return est ? d.estabelecimento_id === est.id : true; }).map((d) => d.nome || d)
    : departamentos.map((d) => d.nome || d);

  const motoristasVisiveis = isAdmin && filtroEstDash
    ? motoristas.filter((m) => { const est = estabelecimentos.find((e) => e.nome === filtroEstDash); return est ? m.estabelecimento_id === est.id : true; })
    : motoristas;
  const veiculosVisiveis = isAdmin && filtroEstDash
    ? veiculos.filter((v) => { const est = estabelecimentos.find((e) => e.nome === filtroEstDash); return est ? v.estabelecimento_id === est.id : true; })
    : veiculos;

  // Calcular alertas usando listas filtradas
  const alertasVeic = veiculosVisiveis.filter((v) => {
    const ac = statusVenc(v.venc_crlv);
    const as = statusVenc(v.venc_seguro_obrigatorio);
    return (ac && ac.cor !== "#4ade80") || (as && as.cor !== "#4ade80");
  }).length;
  const alertasMot = motoristasVisiveis.filter((m) => {
    const s = statusVenc(m.venc_cnh);
    return s && s.cor !== "#4ade80";
  }).length;
  const totalAlertas = alertasVeic + alertasMot;

  const TABS = [
    ...(!isOperador ? [["dashboard", "📊 Dashboard"]] : []),
    ...(isOperador ? [["registrar", "Registrar"]] : []),
    ...(isOperador ? [["meus-registros", "Meus Registros Hoje"]] : [["registros", `Registros (${isAdmin && filtroEstDash ? registros.filter((r) => r.operador === filtroEstDash).length : registros.length})`]]),
    ...(!isOperador ? [["relatorios", "Relatórios"]] : []),
    ...(podeGerenciar ? [["motoristas", `Motoristas (${motoristasVisiveis.length})`], ["veiculos", `Veículos (${veiculosVisiveis.length})`]] : []),
    ...(isAdmin ? [["admin", "⚙️ Admin"], ["logs", "📋 Logs"]] : []),
  ];

  return (
    <div style={{ minHeight: "100vh", background: isDark ? "#0f1117" : "#b8b8cc", fontFamily: "'DM Mono','Courier New',monospace", color: "#e8e4d9" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{margin:0;padding:0;overflow-x:hidden;width:100%}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0f1117} ::-webkit-scrollbar-thumb{background:#f97316;border-radius:2px}
        input,select{outline:none} input::placeholder{color:#4a4a55}
        .field input:focus,.field select:focus{border-color:#f97316!important}
        .tab-btn{transition:all 0.2s} .tab-btn:hover{color:#f97316}
        .del-btn{opacity:0;transition:opacity 0.2s} .row-item:hover .del-btn{opacity:1}
        @media(max-width:768px){
          .mot-grid{grid-template-columns:1fr!important;gap:16px!important}
          .veic-grid{grid-template-columns:1fr!important;gap:16px!important}
          .admin-grid{grid-template-columns:1fr!important;gap:16px!important}
          .dash-sections{grid-template-columns:1fr!important;gap:12px!important}
          .stats-3{grid-template-columns:1fr 1fr!important}
          .tab-btn{padding:8px 10px!important}
          .row-item{padding:10px 12px!important}
          .log-row{grid-template-columns:1fr 1fr!important;gap:6px!important}
          .reg-row{grid-template-columns:1fr 1fr auto!important}
          .form-grid .field-label{font-size:12px!important;letter-spacing:1px!important}
          .form-grid input,.form-grid select{font-size:16px!important;padding:13px 12px!important;height:48px!important}
          .scan-grid{grid-template-columns:1fr!important}
        }
        .sbtn{transition:all 0.18s} .sbtn:hover:not(:disabled){filter:brightness(1.15);transform:translateY(-1px)}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} .fade-in{animation:fadeIn 0.3s ease}
        @keyframes pop{0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)}} .pop{animation:pop 0.35s ease}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,0.4)}50%{box-shadow:0 0 0 10px rgba(249,115,22,0)}}
        .qr-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px}
        @media(max-width:768px){
          .stats-3{grid-template-columns:1fr 1fr!important}
          .stats-3 > div:last-child{grid-column:1 / -1!important}
          .dash-cards{grid-template-columns:1fr 1fr!important}
          .dash-sections{grid-template-columns:1fr!important}
          .reg-row{grid-template-columns:1fr 1fr auto!important}
          .reg-col-hide{display:none!important}
          .form-grid{grid-template-columns:1fr!important}
          .scan-grid{grid-template-columns:1fr!important}
          .tabs-scroll{overflow-x:auto!important;-webkit-overflow-scrolling:touch}
          .tabs-scroll>div{min-width:max-content!important}
          .pad-main{padding:12px!important}
          .header-inner{padding:12px 12px 0!important}
          .period-btns button{padding:7px 10px!important;font-size:11px!important}
        }
        .tabs-scroll::-webkit-scrollbar{display:none}
        .nav-tabs::-webkit-scrollbar{display:none}
        .tabs-scroll{-ms-overflow-style:none;scrollbar-width:none}
        div[style*="overflowX"]::-webkit-scrollbar{display:none}
        @media(min-width:769px){
          .dash-cards{grid-template-columns:repeat(4,1fr)!important}
          .dash-sections{grid-template-columns:1fr 1fr!important}
          .mobile-pill{border-radius:8px!important}
        }
      `}</style>

      {/* Modal Minha Conta — alterar senha */}
      {minhaConta && (
        <div className="qr-overlay" onClick={() => setMinhaConta(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background:"#1a1c27", border:"1px solid #f97316", borderRadius:16, padding:28, maxWidth:380, width:"90%" }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:"#fff", marginBottom:4 }}>👤 Minha Conta</div>
            <div style={{ fontSize:12, color:"#8a8a9a", marginBottom:20 }}>{usuario?.email}</div>
            {senhaOk && <div style={{ background:"#14532d", border:"1px solid #16a34a", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#4ade80", marginBottom:16 }}>✓ Senha alterada com sucesso!</div>}
            {senhaErro && <div style={{ background:"#2d0f0f", border:"1px solid #ef4444", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#ef4444", marginBottom:16 }}>{senhaErro}</div>}
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <Field label="NOVA SENHA">
                <input type="password" placeholder="Mínimo 6 caracteres" value={novaSenha} onChange={(e) => { setNovaSenha(e.target.value); setSenhaErro(""); }} style={iS(senhaErro)} />
              </Field>
              <Field label="CONFIRMAR NOVA SENHA">
                <input type="password" placeholder="Repita a nova senha" value={confirmarSenha} onChange={(e) => { setConfirmarSenha(e.target.value); setSenhaErro(""); }} style={iS(senhaErro)} />
              </Field>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={handleAlterarMinhaSenha} style={{ flex:1, padding:"13px", background:"#f97316", border:"none", borderRadius:10, color:"#fff", fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:"pointer" }}>✓ SALVAR SENHA</button>
              <button onClick={() => { setMinhaConta(false); setNovaSenha(""); setConfirmarSenha(""); setSenhaErro(""); }} style={{ padding:"13px 16px", background:"none", border:"1px solid #3a2020", borderRadius:10, color:"#ef4444", fontFamily:"inherit", fontSize:13, cursor:"pointer" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal edição estabelecimento - admin */}
      {editEst && (
        <div className="qr-overlay" onClick={() => setEditEst(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background:"#1a1c27", border:"1px solid #f97316", borderRadius:16, padding:28, maxWidth:420, width:"90%" }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:"#fff", marginBottom:20 }}>✏️ Editar Estabelecimento</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <Field label="NOME"><input type="text" value={editEst.nome} onChange={(e) => setEditEst((x) => ({ ...x, nome: e.target.value }))} style={iS()} /></Field>
              <Field label="CNPJ"><input type="text" placeholder="00.000.000/0001-00" value={editEst.cnpj || ""} onChange={(e) => setEditEst((x) => ({ ...x, cnpj: e.target.value }))} style={iS()} /></Field>
              <Field label="TELEFONE"><input type="text" placeholder="(44) 99999-9999" value={editEst.telefone || ""} onChange={(e) => setEditEst((x) => ({ ...x, telefone: e.target.value }))} style={iS()} /></Field>
              <Field label="PLANO">
                <select value={editEst.plano || "basico"} onChange={(e) => setEditEst((x) => ({ ...x, plano: e.target.value }))} style={iS()}>
                  <option value="basico">Básico</option>
                  <option value="profissional">Profissional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </Field>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={handleUpdateEst} style={{ flex:1, padding:"13px", background:"#f97316", border:"none", borderRadius:10, color:"#fff", fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:"pointer" }}>✓ SALVAR</button>
              <button onClick={() => setEditEst(null)} style={{ padding:"13px 16px", background:"none", border:"1px solid #3a2020", borderRadius:10, color:"#ef4444", fontFamily:"inherit", fontSize:13, cursor:"pointer" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal edição motorista - gestor */}
      {editMotorista && (
        <div className="qr-overlay" onClick={() => setEditMotorista(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background:"#1a1c27", border:"1px solid #4ade80", borderRadius:16, padding:28, maxWidth:400, width:"90%" }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:"#fff", marginBottom:20 }}>✏️ Editar Motorista</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <Field label="NOME"><input type="text" value={editMotorista.nome} onChange={(e) => setEditMotorista((m) => ({ ...m, nome: e.target.value }))} style={iS()} /></Field>
              <Field label="CNH"><input type="text" value={editMotorista.cnh || ""} onChange={(e) => setEditMotorista((m) => ({ ...m, cnh: e.target.value }))} style={iS()} /></Field>
              <Field label="🪪 VENCIMENTO CNH"><input type="date" value={editMotorista.venc_cnh || ""} onChange={(e) => setEditMotorista((m) => ({ ...m, venc_cnh: e.target.value }))} style={iS()} /></Field>
              <Field label="DEPARTAMENTO">
                <select value={editMotorista.departamento} onChange={(e) => setEditMotorista((m) => ({ ...m, departamento: e.target.value }))} style={iS()}>
                  <option value="">— Selecione —</option>
                  {departamentosVisiveis.map((d) => <option key={d}>{d}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={handleUpdateMotorista} style={{ flex:1, padding:"13px", background:"#4ade80", border:"none", borderRadius:10, color:"#0f1117", fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:"pointer" }}>✓ SALVAR</button>
              <button onClick={() => setEditMotorista(null)} style={{ padding:"13px 16px", background:"none", border:"1px solid #3a2020", borderRadius:10, color:"#ef4444", fontFamily:"inherit", fontSize:13, cursor:"pointer" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal edição veículo - gestor */}
      {editVeiculo && (
        <div className="qr-overlay" onClick={() => setEditVeiculo(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background:"#1a1c27", border:"1px solid #38bdf8", borderRadius:16, padding:28, maxWidth:400, width:"90%" }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:"#fff", marginBottom:4 }}>✏️ Editar Veículo</div>
            <div style={{ fontSize:13, color:"#38bdf8", marginBottom:20, letterSpacing:2 }}>{editVeiculo.placa}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              <Field label="MODELO"><input type="text" value={editVeiculo.modelo || ""} onChange={(e) => setEditVeiculo((v) => ({ ...v, modelo: e.target.value }))} style={iS()} /></Field>
              <Field label="ANO"><input type="text" maxLength={4} value={editVeiculo.ano || ""} onChange={(e) => setEditVeiculo((v) => ({ ...v, ano: e.target.value }))} style={iS()} /></Field>
              <Field label="STATUS">
                <select value={editVeiculo.status || "ativo"} onChange={(e) => setEditVeiculo((v) => ({ ...v, status: e.target.value }))} style={iS()}>
                  <option value="ativo">🟢 Ativo</option>
                  <option value="inativo">🔴 Inativo</option>
                  <option value="manutencao">🟡 Manutenção</option>
                </select>
              </Field>
              <Field label="📋 VENCIMENTO CRLV"><input type="date" value={editVeiculo.venc_crlv || ""} onChange={(e) => setEditVeiculo((v) => ({ ...v, venc_crlv: e.target.value }))} style={iS()} /></Field>
              <Field label="🛡️ VENCIMENTO SEGURO OBRIGATÓRIO"><input type="date" value={editVeiculo.venc_seguro_obrigatorio || ""} onChange={(e) => setEditVeiculo((v) => ({ ...v, venc_seguro_obrigatorio: e.target.value }))} style={iS()} /></Field>
              <Field label="DEPARTAMENTO">
                <select value={editVeiculo.departamento} onChange={(e) => setEditVeiculo((v) => ({ ...v, departamento: e.target.value }))} style={iS()}>
                  <option value="">— Selecione —</option>
                  {departamentosVisiveis.map((d) => <option key={d}>{d}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={handleUpdateVeiculo} style={{ flex:1, padding:"13px", background:"#38bdf8", border:"none", borderRadius:10, color:"#0f1117", fontFamily:"inherit", fontSize:13, fontWeight:700, cursor:"pointer" }}>✓ SALVAR</button>
              <button onClick={() => setEditVeiculo(null)} style={{ padding:"13px 16px", background:"none", border:"1px solid #3a2020", borderRadius:10, color:"#ef4444", fontFamily:"inherit", fontSize:13, cursor:"pointer" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal edição de registro - operador - 30min */}
      {editReg && (
        <div className="qr-overlay" onClick={() => setEditReg(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background:"#1a1c27", border:"1px solid #38bdf8", borderRadius:16, padding:28, maxWidth:420, width:"90%" }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:16, color:"#fff", marginBottom:4 }}>✏️ Corrigir Abastecimento</div>
            <div style={{ fontSize:11, color:"#38bdf8", marginBottom:20 }}>
              {(() => {
                const criado = new Date(editReg.data_hora || 0);
                const diffMin = (Date.now() - criado.getTime()) / 60000;
                const restante = Math.max(0, Math.ceil(30 - diffMin));
                return restante > 0 ? `⏱ ${restante} minuto(s) restante(s) para editar` : "⚠ Prazo expirado";
              })()}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ fontSize:10, color:"#5a5a6a", letterSpacing:2, display:"block", marginBottom:6 }}>TIPO DE COMBUSTÍVEL</label>
                <select value={editReg.combustivel} onChange={(e) => setEditReg((r) => ({ ...r, combustivel: e.target.value }))} style={iS()}>
                  {COMBUSTIVEIS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize:10, color:"#5a5a6a", letterSpacing:2, display:"block", marginBottom:6 }}>QUANTIDADE (L)</label>
                <input type="number" min="0" step="0.01" value={editReg.quantidade} onChange={(e) => setEditReg((r) => ({ ...r, quantidade: e.target.value }))} style={iS()} />
              </div>
              <div>
                <label style={{ fontSize:10, color:"#5a5a6a", letterSpacing:2, display:"block", marginBottom:6 }}>CUSTO TOTAL (R$)</label>
                <input type="number" min="0" step="0.01" value={editReg.custo} onChange={(e) => setEditReg((r) => ({ ...r, custo: e.target.value }))} style={iS()} />
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={{ fontSize:10, color:"#5a5a6a", letterSpacing:2, display:"block", marginBottom:6 }}>HODÔMETRO (KM)</label>
                <input type="number" min="0" value={editReg.hodometro || ""} onChange={(e) => setEditReg((r) => ({ ...r, hodometro: e.target.value }))} style={iS()} />
              </div>
            </div>
            {editReg.quantidade > 0 && editReg.custo > 0 && (
              <div style={{ marginTop:12, padding:"10px 16px", background:"#0f1117", borderRadius:8, fontSize:12, color:"#8a8a9a" }}>
                Preço/litro: <strong style={{ color:"#f97316" }}>{fmtBRL(parseFloat(editReg.custo) / parseFloat(editReg.quantidade))}</strong>
              </div>
            )}
            <div style={{ display:"flex", gap:8, marginTop:20 }}>
              <button onClick={handleSaveEditReg} style={{ flex:1, padding:"13px", background:"#38bdf8", border:"none", borderRadius:10, color:"#0f1117", fontFamily:"inherit", fontSize:13, fontWeight:700, letterSpacing:1, cursor:"pointer" }}>✓ SALVAR CORREÇÃO</button>
              <button onClick={() => setEditReg(null)} style={{ padding:"13px 16px", background:"none", border:"1px solid #3a2020", borderRadius:10, color:"#ef4444", fontFamily:"inherit", fontSize:13, cursor:"pointer" }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {comprovante && <Comprovante registro={comprovante} estabelecimento={estNome} onClose={() => { setComprovante(null); setScannedMot(null); setScannedVeic(null); setForm({ dataHora: now(), combustivel: COMBUSTIVEIS[0], quantidade: "", custo: "", hodometro: "", cupom_fiscal: "" }); setFormErrors({}); }} />}

      {qrModal && (
        <div className="qr-overlay" onClick={() => setQrModal(null)}>
          <style>{`@media print{@page{size:A4 portrait;margin:0}body *{visibility:hidden!important}.qr-print-area,.qr-print-area *{visibility:visible!important}.qr-print-area{position:fixed!important;top:0!important;left:0!important;width:100vw!important;height:100vh!important;display:flex!important;align-items:center!important;justify-content:center!important;background:white!important}.no-print{display:none!important}}`}</style>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 16, padding: 28, textAlign: "center", maxWidth: 320, width: "90%" }}>
            <div className="qr-print-area">
              <div style={{ textAlign: "center", border: "2px solid #ddd", borderRadius: 12, padding: "24px 32px", background: "#fff", marginBottom: 16, minWidth: 220 }}>
                <div style={{ fontSize: 9, color: "#888", letterSpacing: 3, marginBottom: 8 }}>{qrModal.tipo === "motorista" ? "⛽ MOTORISTA" : "⛽ VEÍCULO"}</div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 22, color: "#111", marginBottom: 4, letterSpacing: qrModal.tipo === "veiculo" ? 3 : 0 }}>
                  {qrModal.tipo === "motorista" ? qrModal.item.nome : qrModal.item.placa}
                </div>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 16 }}>
                  {qrModal.tipo === "motorista" ? `${qrModal.item.departamento}${qrModal.item.cnh ? " · CNH " + qrModal.item.cnh : ""}` : `${qrModal.item.departamento}${qrModal.item.modelo ? " · " + qrModal.item.modelo : ""}${qrModal.item.ano ? " (" + qrModal.item.ano + ")" : ""}`}
                </div>
                <img src={qrUrl(JSON.stringify({ id: qrModal.item.id, tipo: qrModal.tipo }))} alt="QR" style={{ width: 180, height: 180, display: "block", margin: "0 auto" }} />
                <div style={{ fontSize: 9, color: "#aaa", marginTop: 12, letterSpacing: 2 }}>CONTROLE DE AbastecePro</div>
                <div style={{ fontSize: 11, color: "#333", marginTop: 4, fontWeight: 600 }}>{estNome}</div>
              </div>
            </div>
            <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button onClick={() => window.print()} style={{ flex: 1, padding: "11px", background: "#1e2535", border: "1px solid #f97316", borderRadius: 8, color: "#f97316", fontFamily: "inherit", fontSize: 12, letterSpacing: 1, cursor: "pointer" }}>🖨️ IMPRIMIR</button>
              <button onClick={() => setQrModal(null)} style={{ flex: 1, padding: "11px", background: "#f97316", border: "none", borderRadius: 8, color: "#fff", fontFamily: "inherit", fontSize: 12, letterSpacing: 1, cursor: "pointer" }}>FECHAR</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="header-inner" style={{ background: "linear-gradient(135deg,#1a1c27 0%,#0f1117 100%)", borderBottom: "1px solid #1e2030", padding: "20px 28px 0" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", width:"100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: "#f97316", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>⛽</div>
              <div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: "clamp(14px, 4vw, 20px)", fontWeight: 800, letterSpacing: -0.5, color: "#fff" }}>AbastecePro</div>
                <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:-2, flexWrap:"wrap" }}>
                  <div style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2 }}>{estNome.toUpperCase()}</div>
                  <span style={{ fontSize:9, padding:"1px 6px", borderRadius:4, background: isAdmin?"#2d1f0a":isGestor?"#1e3a2a":"#1e2535", color: isAdmin?"#fbbf24":isGestor?"#4ade80":"#38bdf8" }}>
                    {isAdmin?"ADMIN":isGestor?"GESTOR":"OPERADOR"}
                  </span>
                  {!isAdmin && (
                    <span style={{ fontSize:9, padding:"1px 6px", borderRadius:4, background: plano==="enterprise"?"#2d1a50":plano==="profissional"?"#1a2535":"#1a1c27", color: plano==="enterprise"?"#a78bfa":plano==="profissional"?"#38bdf8":"#5a5a6a", border:`1px solid ${plano==="enterprise"?"#a78bfa":plano==="profissional"?"#38bdf8":"#3a3a4a"}` }}>
                      {planoAtual.label}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {pendentes > 0 && <div style={{ background: "#92400e", borderRadius: 8, padding: "3px 8px", fontSize: 10, color: "#fbbf24" }}>{pendentes} pendente{pendentes > 1 ? "s" : ""}</div>}
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: online ? "#4ade80" : "#f97316" }} />
              <span style={{ fontSize: 10, color: online ? "#4ade80" : "#f97316" }}>{online ? "online" : "offline"}</span>
              {isAdmin && estabelecimentos.length > 0 && (
                <select value={filtroEstDash} onChange={(e) => setFiltroEstDash(e.target.value)} style={{ background: isDark?"#1a1c27":"#1a1c27", border:`1px solid ${filtroEstDash?"#f97316":isDark?"#2a2c3a":"#ccc"}`, borderRadius:8, color:filtroEstDash?"#f97316":isDark?"#8a8a9a":"#666", fontFamily:"inherit", fontSize:11, padding:"6px 10px", outline:"none", maxWidth:160, cursor:"pointer" }}>
                  <option value="">🏪 Todos</option>
                  {estabelecimentos.filter((e) => e.nome !== "Administrador").map((e) => (
                    <option key={e.id} value={e.nome}>{e.nome}</option>
                  ))}
                </select>
              )}
              <button onClick={toggleTema} title="Alternar tema" style={{ background: "none", border: `1px solid ${isDark ? "#2a2c3a" : "#ccc"}`, borderRadius: 8, color: isDark ? "#f97316" : "#666", cursor: "pointer", padding: "6px 10px", fontSize: 14 }}>{isDark ? "☀️" : "🌙"}</button>
              {!isOperador && <button onClick={() => setMinhaConta(true)} title="Minha conta" style={{ background: "none", border: `1px solid ${isDark ? "#2a2c3a" : "#ccc"}`, borderRadius: 8, color: isDark ? "#8a8a9a" : "#666", cursor: "pointer", padding: "6px 10px", fontSize: 14 }}>👤</button>}
              <button onClick={handleLogout} style={{ background: "none", border: `1px solid ${isDark ? "#2a2c3a" : "#ccc"}`, borderRadius: 8, color: isDark ? "#5a5a6a" : "#666", cursor: "pointer", padding: "6px 12px", fontSize: 11, fontFamily: "inherit" }}>Sair</button>
            </div>
          </div>
          <div className="nav-tabs" style={{ display: "flex", gap: 0, marginTop: 16, overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", msOverflowStyle: "none" }}>
            {TABS.map(([id, label]) => {
              const badgeCount = id === "veiculos" ? alertasVeic : id === "motoristas" ? alertasMot : 0;
              return (
                <button key={id} className="tab-btn" onClick={() => { setActiveTab(id); if (id === "registrar") { setScannedMot(null); setScannedVeic(null); setForm({ dataHora: now(), combustivel: COMBUSTIVEIS[0], quantidade: "", custo: "", hodometro: "", cupom_fiscal: "" }); } }} style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: 11, fontFamily: "inherit", whiteSpace: "nowrap", color: activeTab === id ? "#f97316" : "#5a5a6a", borderBottom: activeTab === id ? "2px solid #f97316" : "2px solid transparent", fontWeight: activeTab === id ? 500 : 400, letterSpacing: 0.5, position: "relative" }}>
                  {label}
                  {badgeCount > 0 && (
                    <span style={{ position:"absolute", top:6, right:4, background:"#ef4444", color:"#fff", fontSize:8, fontWeight:700, minWidth:14, height:14, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center", padding:"0 3px" }}>
                      {badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {!online && (
        <div style={{ background: "#2d1f0a", borderBottom: "1px solid #b45309", padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>📡</span>
            <div><div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 500 }}>Modo Offline</div><div style={{ fontSize: 10, color: "#92400e" }}>Dados sincronizados quando houver conexão</div></div>
          </div>
          {pendentes > 0 && <div style={{ fontSize: 11, color: "#fbbf24" }}>{syncing ? "Sincronizando..." : `${pendentes} pendente(s)`}</div>}
        </div>
      )}
      {syncMsg && (
        <div style={{ background:"#14532d", borderBottom:"1px solid #16a34a", padding:"12px 28px", fontSize:13, color:"#4ade80", display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:18 }}>✅</span>
          <div>
            <div style={{ fontWeight:500 }}>{syncMsg}</div>
            <div style={{ fontSize:10, color:"#16a34a", marginTop:2 }}>Dados sincronizados com o servidor</div>
          </div>
        </div>
      )}

      <div className="pad-main" style={{ maxWidth: 960, margin: "0 auto", padding: "24px 28px" }}>
        {loading && <div style={{ textAlign: "center", padding: 40, color: "#5a5a6a" }}>Carregando...</div>}

        {/* DASHBOARD */}
        {/* Modal de alertas ao logar */}
        {alertaModal && totalAlertas > 0 && !loading && (
          <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={() => setAlertaModal(false)}>
            <div style={{ background:"#1a1c27", border:"1px solid #f97316", borderRadius:16, padding:24, maxWidth:480, width:"100%", maxHeight:"80vh", overflowY:"auto" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ fontSize:20 }}>⚠️</span>
                  <span style={{ fontSize:14, fontWeight:600, color:"#fbbf24", fontFamily:"inherit" }}>ATENÇÃO — DOCUMENTOS</span>
                </div>
                <button onClick={() => setAlertaModal(false)} style={{ background:"none", border:"1px solid #2a2c3a", borderRadius:6, color:"#8a8a9a", cursor:"pointer", padding:"4px 10px", fontSize:12, fontFamily:"inherit" }}>✕ Fechar</button>
              </div>
              {alertasVeic > 0 && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:11, color:"#5a5a6a", letterSpacing:1, marginBottom:8 }}>🚗 VEÍCULOS</div>
                  {veiculosVisiveis.filter((v) => { const ac = statusVenc(v.venc_crlv); const as = statusVenc(v.venc_seguro_obrigatorio); return (ac && ac.cor !== "#4ade80") || (as && as.cor !== "#4ade80"); }).map((v) => {
                    const ac = statusVenc(v.venc_crlv);
                    const as = statusVenc(v.venc_seguro_obrigatorio);
                    return (
                      <div key={v.id} style={{ background:"#0f1117", border:"1px solid #2a2c3a", borderRadius:8, padding:"8px 12px", marginBottom:6 }}>
                        <div style={{ fontSize:13, fontWeight:500, color:"#fff" }}>{v.placa} — {v.modelo}</div>
                        {ac && ac.cor !== "#4ade80" && <div style={{ fontSize:11, color:ac.cor, marginTop:2 }}>📋 CRLV: {ac.texto}</div>}
                        {as && as.cor !== "#4ade80" && <div style={{ fontSize:11, color:as.cor, marginTop:2 }}>🛡️ Seguro: {as.texto}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
              {alertasMot > 0 && (
                <div>
                  <div style={{ fontSize:11, color:"#5a5a6a", letterSpacing:1, marginBottom:8 }}>👤 MOTORISTAS</div>
                  {motoristasVisiveis.filter((m) => { const s = statusVenc(m.venc_cnh); return s && s.cor !== "#4ade80"; }).map((m) => {
                    const s = statusVenc(m.venc_cnh);
                    return (
                      <div key={m.id} style={{ background:"#0f1117", border:"1px solid #2a2c3a", borderRadius:8, padding:"8px 12px", marginBottom:6 }}>
                        <div style={{ fontSize:13, fontWeight:500, color:"#fff" }}>{m.nome}</div>
                        <div style={{ fontSize:11, color:s.cor, marginTop:2 }}>🪪 CNH: {s.texto}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <button onClick={() => setAlertaModal(false)} style={{ width:"100%", marginTop:16, padding:"12px", background:"#f97316", border:"none", borderRadius:10, color:"#fff", fontFamily:"inherit", fontSize:13, fontWeight:500, cursor:"pointer", letterSpacing:1 }}>ENTENDIDO</button>
            </div>
          </div>
        )}

        {!loading && activeTab === "dashboard" && (
          <div className="fade-in">
            {/* Resumo do dia */}
            {(() => {
              const hoje = new Date().toISOString().slice(0,10);
              const hoje_regs = registros.filter((r) => (r.data_hora||"").startsWith(hoje));
              const hoje_litros = hoje_regs.reduce((a,b) => a+Number(b.quantidade||0), 0);
              const hoje_custo = hoje_regs.reduce((a,b) => a+Number(b.custo||0), 0);
              return hoje_regs.length > 0 ? (
                <div style={{ background: isDark?"#1a1c27":"#1a1c27", border:"1px solid #f97316", borderRadius:12, padding:"14px 20px", marginBottom:20, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
                  <div>
                    <div style={{ fontSize:10, color:"#f97316", letterSpacing:2, marginBottom:4 }}>HOJE</div>
                    <div style={{ fontSize:13, color: isDark?"#e8e4d9":"#1a1a2e" }}>
                      <strong>{hoje_regs.length}</strong> abastecimento{hoje_regs.length!==1?"s":""} · <strong>{fmtNum(hoje_litros)} L</strong> · <strong style={{ color:"#f97316" }}>{fmtBRL(hoje_custo)}</strong>
                    </div>
                  </div>
                  {ultimoMot && ultimoVeic && (
                    <div style={{ fontSize:11, color: isDark?"#5a5a6a":"#888" }}>
                      Último: <span style={{ color:"#f97316" }}>{ultimoVeic.placa}</span> · <span style={{ color:"#e8e4d9" }}>{ultimoMot.nome}</span>
                    </div>
                  )}
                </div>
              ) : null;
            })()}
            <Dashboard registros={registros} motoristas={motoristasVisiveis} veiculos={veiculosVisiveis} estNome={estNome} isAdmin={isAdmin} estabelecimentos={estabelecimentos} isDark={isDark} totalAlertas={totalAlertas} alertasVeic={alertasVeic} alertasMot={alertasMot} filtroEst={filtroEstDash} />
          </div>
        )}

        {/* REGISTRAR */}
        {!loading && activeTab === "registrar" && (
          <div className="fade-in">
            <div className="scan-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
              <ScanBlock icon="👤" label="IDENTIFICAÇÃO DO MOTORISTA"
                scanned={scannedMot ? { linha1: scannedMot.nome, linha2: `${scannedMot.departamento}${scannedMot.cnh ? " · CNH " + scannedMot.cnh : ""}` } : null}
                onClear={() => setScannedMot(null)} onStart={startMotScan} onStop={motScanner.stop}
                scanning={motScanner.scanning} scanError={motScanErr || motScanner.error} videoRef={motScanner.videoRef}
                manualOptions={motoristas.map((m) => ({ value: m.id, label: `${m.nome} · ${m.departamento}` }))}
                manualValue={scannedMot?.id || ""} manualError={formErrors.motoristaId}
                onManual={(e) => { const m = motoristas.find((x) => x.id === e.target.value); setScannedMot(m || null); setFormErrors((err) => ({ ...err, motoristaId: undefined })); }}
              />
              <ScanBlock icon="🚗" label="IDENTIFICAÇÃO DO VEÍCULO" accentColor="#38bdf8"
                scanned={scannedVeic ? { linha1: scannedVeic.placa, linha2: `${scannedVeic.departamento}${scannedVeic.modelo ? " · " + scannedVeic.modelo : ""}` } : null}
                onClear={() => setScannedVeic(null)} onStart={startVeicScan} onStop={veicScanner.stop}
                scanning={veicScanner.scanning} scanError={veicScanErr || veicScanner.error} videoRef={veicScanner.videoRef}
                manualOptions={veiculos.map((v) => ({ value: v.id, label: `${v.placa}${v.modelo ? " · " + v.modelo : ""} — ${v.departamento}` }))}
                manualValue={scannedVeic?.id || ""} manualError={formErrors.placaId}
                onManual={(e) => { const v = veiculos.find((x) => x.id === e.target.value); setScannedVeic(v || null); setFormErrors((err) => ({ ...err, placaId: undefined })); }}
              />
            </div>
            {/* Alertas de vencimento */}
            <AlertasVencimento motorista={scannedMot} veiculo={scannedVeic} />

            {/* Atalho: usar último */}
            {(ultimoMot || ultimoVeic) && !scannedMot && !scannedVeic && (
              <div style={{ background: isDark?"#1a1c27":"#1a1c27", border:"1px solid #2a2c3a", borderRadius:10, padding:"10px 16px", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
                <div style={{ fontSize:11, color: isDark?"#5a5a6a":"#888" }}>⚡ Último usado:</div>
                <div style={{ display:"flex", gap:8 }}>
                  {ultimoMot && (
                    <button onClick={() => setScannedMot(ultimoMot)} className="sbtn" style={{ background:"#1e2535", border:"1px solid #f97316", borderRadius:6, color:"#f97316", cursor:"pointer", padding:"4px 10px", fontSize:11, fontFamily:"inherit" }}>
                      👤 {ultimoMot.nome}
                    </button>
                  )}
                  {ultimoVeic && (
                    <button onClick={() => setScannedVeic(ultimoVeic)} className="sbtn" style={{ background:"#0e2030", border:"1px solid #38bdf8", borderRadius:6, color:"#38bdf8", cursor:"pointer", padding:"4px 10px", fontSize:11, fontFamily:"inherit" }}>
                      🚗 {ultimoVeic.placa}
                    </button>
                  )}
                </div>
              </div>
            )}

            <div style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div><div style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2, marginBottom: 2 }}>ESTABELECIMENTO</div><div style={{ fontSize: 14, fontWeight: 500, color: "#f97316" }}>{estNome}</div></div>
              <span style={{ fontSize: 11, color: "#4ade80" }}>✓ fixo</span>
            </div>
            <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

              <Field label="TIPO DE COMBUSTÍVEL"><select value={form.combustivel} onChange={(e) => setForm((f) => ({ ...f, combustivel: e.target.value }))} style={iS()}>{COMBUSTIVEIS.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="HODÔMETRO (KM) — OPCIONAL"><input type="number" inputMode="numeric" pattern="[0-9]*" placeholder="Ex: 45230" min="0" value={form.hodometro} onChange={(e) => setForm((f) => ({ ...f, hodometro: e.target.value }))} style={iS()} /></Field>
              <Field label="CUPOM FISCAL — OPCIONAL"><input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="Ex: 257302" value={form.cupom_fiscal} onChange={(e) => setForm((f) => ({ ...f, cupom_fiscal: e.target.value }))} style={iS()} /></Field>
              <Field label="QUANTIDADE (LITROS)" error={formErrors.quantidade}><input type="number" inputMode="decimal" pattern="[0-9]*" placeholder="0.00" min="0" step="0.01" value={form.quantidade} onChange={(e) => { setForm((f) => ({ ...f, quantidade: e.target.value })); setFormErrors((err) => ({ ...err, quantidade: undefined })); }} style={iS(formErrors.quantidade)} /></Field>
              <Field label="CUSTO TOTAL (R$)" error={formErrors.custo}><input type="number" inputMode="decimal" pattern="[0-9]*" placeholder="0.00" min="0" step="0.01" value={form.custo} onChange={(e) => { setForm((f) => ({ ...f, custo: e.target.value })); setFormErrors((err) => ({ ...err, custo: undefined })); }} style={iS(formErrors.custo)} /></Field>
            </div>
            {+form.quantidade > 0 && +form.custo > 0 && (
              <div style={{ marginTop: 12, padding: "10px 16px", background: "#1a1c27", borderRadius: 8, border: "1px solid #2a2c3a", fontSize: 12, color: "#8a8a9a" }}>
                Preço/litro: <strong style={{ color: "#f97316" }}>{fmtBRL(parseFloat(form.custo) / parseFloat(form.quantidade))}</strong>
              </div>
            )}
            {!online && <div style={{ marginTop: 12, padding: "10px 16px", background: "#2d1f0a", borderRadius: 8, border: "1px solid #b45309", fontSize: 12, color: "#fbbf24" }}>📡 Modo offline — será sincronizado quando houver conexão.</div>}
            <button className="sbtn" onClick={handleRegistrar} style={{ marginTop: 18, width: "100%", padding: "15px", background: "#f97316", border: "none", borderRadius: 10, color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 500, letterSpacing: 1.5, cursor: "pointer" }}>
              {online ? "REGISTRAR AbastecePro" : "REGISTRAR OFFLINE"}
            </button>
          </div>
        )}

        {/* REGISTROS */}
        {!loading && activeTab === "registros" && (
          <div className="fade-in">
            <div className="stats-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 16 }}>
              {[["REGISTROS", filtered.length, ""], ["TOTAL LITROS", fmtNum(filtered.reduce((a, b) => a + Number(b.quantidade || 0), 0)), "L"], ["TOTAL GASTO", fmtBRL(filtered.reduce((a, b) => a + Number(b.custo || 0), 0)), ""]].map(([label, val, unit]) => (
                <div key={label} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 10, padding: "10px 8px" }}>
                  <div style={{ fontSize: 8, color: "#5a5a6a", letterSpacing: 1 }}>{label}</div>
                  <div style={{ fontSize: 14, fontFamily: "'DM Mono',monospace", fontWeight: 500, color: "#f97316", marginTop: 3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{val}{unit && <span style={{ fontSize: 10, marginLeft: 2, color: "#8a8a9a" }}>{unit}</span>}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
              <input type="text" placeholder="🔍  Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...iS(), flex: 1, fontSize: 13, minWidth: 200 }} />


            </div>
            {filtered.length === 0 ? <EmptyState>Nenhum registro.</EmptyState> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.slice(0, pagina * POR_PAGINA).map((r) => (
                  <div key={r.id || r._localId} className="row-item reg-row fade-in" style={{ background: "#1a1c27", border: `1px solid ${r._offline ? "#b45309" : "#2a2c3a"}`, borderRadius: 10, padding: "12px 14px", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", alignItems: "center", gap: 8 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>{r.motorista_nome}</div>
                        {r._offline && <span style={{ fontSize: 9, background: "#92400e", color: "#fbbf24", borderRadius: 4, padding: "2px 5px" }}>OFFLINE</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#5a5a6a", marginTop: 2 }}>{(r.data_hora || "").slice(0, 16).replace("T", " ")}</div>
                      {isAdmin && <div style={{ fontSize: 10, color: "#f97316", marginTop: 2 }}>🏪 {r.operador}</div>}
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#fff" }}>{r.placa}</div>
                      <div style={{ fontSize: 11, color: "#f97316", marginTop: 2 }}>{r.combustivel}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{fmtNum(r.quantidade)} L</div>
                      <div style={{ fontSize: 12, color: "#4ade80", marginTop: 2 }}>{fmtBRL(r.custo)}</div>
                    </div>
                    <div style={{ display:"flex", gap:4 }}>
                      <button onClick={() => setComprovante(r)} className="sbtn" style={{ background:"#1e2535", border:"1px solid #f97316", borderRadius:6, color:"#f97316", cursor:"pointer", padding:"6px 8px", fontSize:14 }}>🧾</button>
                      {isAdmin && !r._offline && (
                        <>
                          <button onClick={() => setEditReg({ ...r, quantidade: r.quantidade, custo: r.custo })} className="sbtn" style={{ background:"#1e3a2a", border:"1px solid #4ade80", borderRadius:6, color:"#4ade80", cursor:"pointer", padding:"6px 8px", fontSize:12, fontFamily:"inherit" }}>✏️</button>
                          <button onClick={() => handleDeleteReg(r)} className="sbtn" style={{ background:"#2d0f0f", border:"1px solid #ef4444", borderRadius:6, color:"#ef4444", cursor:"pointer", padding:"6px 8px", fontSize:12, fontFamily:"inherit" }}>✕</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Botão carregar mais */}
            {filtered.length > pagina * POR_PAGINA && (
              <button onClick={() => setPagina((p) => p + 1)} className="sbtn" style={{ width:"100%", marginTop:12, padding:"12px", background: isDark?"#1a1c27":"#1a1c27", border:"1px solid #f97316", borderRadius:10, color:"#f97316", fontFamily:"inherit", fontSize:12, cursor:"pointer", letterSpacing:1 }}>
                Carregar mais ({filtered.length - pagina * POR_PAGINA} restantes)
              </button>
            )}
            {filtered.length > 0 && filtered.length <= pagina * POR_PAGINA && pagina > 1 && (
              <div style={{ textAlign:"center", marginTop:12, fontSize:11, color:"#5a5a6a" }}>
                Exibindo todos os {filtered.length} registros
              </div>
            )}
          </div>
        )}

        {/* MEUS REGISTROS HOJE - operador */}
        {!loading && activeTab === "meus-registros" && (
          <div className="fade-in">
            <div style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:10, padding:"14px 18px", marginBottom:16 }}>
              <div style={{ fontSize:9, color:"#5a5a6a", letterSpacing:1, fontWeight:500 }}>SEUS REGISTROS DE HOJE</div>
              <div style={{ fontSize:18, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#f97316", marginTop:6 }}>
                {registros.filter((r) => (r.data_hora||"").startsWith(new Date().toISOString().slice(0,10)) && r.operador === estNome).length}
                <span style={{ fontSize:12, marginLeft:6, color:"#5a5a6a" }}>abastecimentos</span>
              </div>
            </div>
            {registros.filter((r) => (r.data_hora||"").startsWith(new Date().toISOString().slice(0,10)) && r.operador === estNome).length === 0
              ? <EmptyState>Nenhum abastecimento registrado hoje.</EmptyState>
              : (
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  {registros.filter((r) => (r.data_hora||"").startsWith(new Date().toISOString().slice(0,10)) && r.operador === estNome).map((r) => (
                    <div key={r.id||r._localId} className="row-item fade-in" style={{ background:"#1a1c27", border:`1px solid ${r._offline?"#b45309":"#2a2c3a"}`, borderRadius:10, padding:"14px 18px", display:"grid", gridTemplateColumns:"1.4fr 1fr 1fr auto", alignItems:"center", gap:12 }}>
                      <div>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <div style={{ fontSize:13, fontWeight:500, color:"#fff" }}>{r.motorista_nome}</div>
                          {r._offline && <span style={{ fontSize:9, background:"#92400e", color:"#fbbf24", borderRadius:4, padding:"2px 5px" }}>OFFLINE</span>}
                        </div>
                        <div style={{ fontSize:11, color:"#5a5a6a", marginTop:2 }}>{(r.data_hora||"").slice(11,16)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize:13, fontFamily:"'DM Mono',monospace", fontWeight:500, color:"#fff" }}>{r.placa}</div>
                        <div style={{ fontSize:11, color:"#f97316", marginTop:2 }}>{r.combustivel}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontSize:14, fontWeight:500 }}>{fmtNum(r.quantidade)} L</div>
                        <div style={{ fontSize:12, color:"#4ade80", marginTop:2 }}>{fmtBRL(r.custo)}</div>
                      </div>
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <button onClick={() => setComprovante(r)} className="sbtn" style={{ background:"#1e2535", border:"1px solid #f97316", borderRadius:6, color:"#f97316", cursor:"pointer", padding:"4px 8px", fontSize:14 }}>🧾</button>
                        {(() => {
                          const criado = new Date(r.data_hora || r.created_at || 0);
                          const diffMin = (Date.now() - criado.getTime()) / 60000;
                          const restante = Math.ceil(30 - diffMin);
                          return diffMin <= 30 && !r._offline ? (
                            <button onClick={() => setEditReg(r)} className="sbtn" style={{ background:"#1e2535", border:"1px solid #38bdf8", borderRadius:6, color:"#38bdf8", cursor:"pointer", padding:"4px 6px", fontSize:10, fontFamily:"inherit", whiteSpace:"nowrap" }}>✏️ {restante}m</button>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </div>
        )}

        {/* RELATÓRIOS */}
        {!loading && activeTab === "relatorios" && <Relatorios registros={registros} isAdmin={isAdmin} veiculos={veiculos} podeRelatorios={podeRelatorios} podeCSV={podeCSV} podePDF={podePDF} podeKmL={podeKmL} podeFinanceiro={podeFinanceiro} filtroEstDashProp={filtroEstDash} />}

        {/* MOTORISTAS */}
        {!loading && activeTab === "motoristas" && (
          <div className="fade-in mot-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>
            <div>
              <SectionTitle icon="👤">Cadastrar Motorista</SectionTitle>
              {!online && <Alert type="warn">⚠ Sem conexão. Cadastro indisponível offline.</Alert>}
              {motOk && <Alert type="success">✓ Motorista cadastrado!</Alert>}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Field label="NOME" error={motErrors.nome}><input type="text" placeholder="Nome completo" value={motForm.nome} onChange={(e) => { setMotForm((f) => ({ ...f, nome: e.target.value })); setMotErrors((x) => ({ ...x, nome: undefined })); }} style={iS(motErrors.nome)} /></Field>
                <Field label="DEPARTAMENTO" error={motErrors.departamento}>
                  <select value={motForm.departamento} onChange={(e) => { setMotForm((f) => ({ ...f, departamento: e.target.value })); setMotErrors((x) => ({ ...x, departamento: undefined })); }} style={iS(motErrors.departamento)}>
                    <option value="">— Selecione —</option>
                    {departamentosVisiveis.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="CNH (OPCIONAL)"><input type="text" placeholder="Número da CNH" value={motForm.cnh} onChange={(e) => setMotForm((f) => ({ ...f, cnh: e.target.value }))} style={iS()} /></Field>
                <Field label="🪪 VENCIMENTO CNH (OPCIONAL)"><input type="date" value={motForm.venc_cnh} onChange={(e) => setMotForm((f) => ({ ...f, venc_cnh: e.target.value }))} style={iS()} /></Field>
                <button className="sbtn" onClick={handleMotSubmit} disabled={!online} style={{ padding: "13px", background: online ? "#f97316" : "#2a2c3a", border: "none", borderRadius: 10, color: online ? "#fff" : "#5a5a6a", fontFamily: "inherit", fontSize: 13, fontWeight: 500, letterSpacing: 1.5, cursor: online ? "pointer" : "not-allowed" }}>CADASTRAR</button>
              </div>
            </div>
            <div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <SectionTitle icon="📋">Cadastrados ({motoristasVisiveis.length})</SectionTitle>
                {motoristasVisiveis.length > 0 && !isOperador && (
                  <button onClick={imprimirTodosQRMotoristas} style={{ padding:"7px 14px", background:"#1e2535", border:"1px solid #a78bfa", borderRadius:8, color:"#a78bfa", fontFamily:"inherit", fontSize:11, cursor:"pointer", whiteSpace:"nowrap" }}>🖨️ Imprimir QR Codes</button>
                )}
              </div>
              {motoristas.length === 0 ? <EmptyState>Nenhum motorista.</EmptyState> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {motoristasVisiveis.map((m) => {
                    const sCnh = statusVenc(m.venc_cnh);
                    const vencida = sCnh && sCnh.cor === "#ef4444";
                    const vencendo = sCnh && sCnh.cor === "#fbbf24";
                    const ok = sCnh && sCnh.cor === "#4ade80";
                    const borderColor = vencida ? "#ef4444" : vencendo ? "#b45309" : "#2a2c3a";
                    return (
                      <div key={m.id} className="row-item" style={{ background:"#1a1c27", border:`1px solid ${borderColor}`, borderRadius:10, padding:"12px 14px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div>
                            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                              <div style={{ fontSize:13, fontWeight:500, color:"#fff" }}>{m.nome}</div>
                              {vencida && (
                                <span style={{ fontSize:9, padding:"2px 7px", background:"#2d0f0f", border:"1px solid #ef4444", borderRadius:4, color:"#ef4444", fontWeight:600 }}>🔴 CNH VENCIDA</span>
                              )}
                              {vencendo && (
                                <span style={{ fontSize:9, padding:"2px 7px", background:"#2d1f0a", border:"1px solid #b45309", borderRadius:4, color:"#fbbf24", fontWeight:600 }}>⚠️ CNH {sCnh.texto}</span>
                              )}
                              {ok && (
                                <span style={{ fontSize:9, padding:"2px 7px", background:"#14532d", border:"1px solid #16a34a", borderRadius:4, color:"#4ade80" }}>CNH OK</span>
                              )}
                              {!sCnh && m.venc_cnh === null && (
                                <span style={{ fontSize:9, padding:"2px 7px", background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:4, color:"#4a4a5a" }}>Sem CNH cadastrada</span>
                              )}
                            </div>
                            <div style={{ fontSize:11, color:"#8a8a9a", marginTop:3 }}>{m.departamento}{m.cnh ? " · CNH " + m.cnh : ""}</div>
                          </div>
                          <div style={{ display:"flex", gap:6 }}>
                            {podeGerenciar && (
                              <button onClick={() => setEditMotorista({ ...m })} className="sbtn" style={{ background:"#1e3a2a", border:"1px solid #4ade80", borderRadius:6, color:"#4ade80", cursor:"pointer", padding:"5px 10px", fontSize:11, fontFamily:"inherit" }}>✏️</button>
                            )}
                            <button onClick={() => setQrModal({ tipo: "motorista", item: m })} className="sbtn" style={{ background:"#1e2535", border:"1px solid #f97316", borderRadius:6, color:"#f97316", cursor:"pointer", padding:"5px 10px", fontSize:11, fontFamily:"inherit" }}>QR</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VEÍCULOS */}
        {!loading && activeTab === "veiculos" && (
          <div className="fade-in veic-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>
            <div>
              <SectionTitle icon="🏢">Departamentos</SectionTitle>
              {dptoOk && <Alert type="success">✓ Adicionado!</Alert>}
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <input type="text" placeholder="Ex: Logística, TI..." value={novoDpto} onChange={(e) => { setNovoDpto(e.target.value); setDptoError(""); }} onKeyDown={(e) => e.key === "Enter" && handleAddDpto()} style={iS(dptoError)} />
                  {dptoError && <span style={{ fontSize: 11, color: "#ef4444", marginTop: 4, display: "block" }}>{dptoError}</span>}
                </div>
                <button onClick={handleAddDpto} disabled={!online} style={{ padding: "11px 18px", background: online ? "#f97316" : "#2a2c3a", border: "none", borderRadius: 8, color: online ? "#fff" : "#5a5a6a", fontFamily: "inherit", fontSize: 18, cursor: online ? "pointer" : "not-allowed" }}>+</button>
              </div>
              {departamentos.length === 0 ? <EmptyState>Nenhum departamento.</EmptyState> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {departamentosVisiveis.map((d) => <div key={d} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>🏢 {d}</div>)}
                </div>
              )}
              <div style={{ marginTop: 24 }}>
                <SectionTitle icon="🚗">Cadastrar Veículo</SectionTitle>
                {veicOk && <Alert type="success">✓ Veículo cadastrado!</Alert>}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <Field label="PLACA" error={veicErrors.placa}><input type="text" placeholder="ABC-1234" value={veicForm.placa} onChange={(e) => { setVeicForm((f) => ({ ...f, placa: e.target.value })); setVeicErrors((x) => ({ ...x, placa: undefined })); }} maxLength={8} style={{ ...iS(veicErrors.placa), textTransform: "uppercase", letterSpacing: 2 }} /></Field>
                  <Field label="DEPARTAMENTO" error={veicErrors.departamento}>
                    <select value={veicForm.departamento} onChange={(e) => { setVeicForm((f) => ({ ...f, departamento: e.target.value })); setVeicErrors((x) => ({ ...x, departamento: undefined })); }} style={iS(veicErrors.departamento)}>
                      <option value="">— Selecione —</option>
                      {departamentosVisiveis.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </Field>
                  <Field label="MODELO"><input type="text" placeholder="Ex: Fiat Strada" value={veicForm.modelo} onChange={(e) => setVeicForm((f) => ({ ...f, modelo: e.target.value }))} style={iS()} /></Field>
                  <Field label="ANO"><input type="text" placeholder="2023" maxLength={4} value={veicForm.ano} onChange={(e) => setVeicForm((f) => ({ ...f, ano: e.target.value }))} style={iS()} /></Field>
                  <Field label="STATUS">
                    <select value={veicForm.status} onChange={(e) => setVeicForm((f) => ({ ...f, status: e.target.value }))} style={iS()}>
                      <option value="ativo">🟢 Ativo</option>
                      <option value="inativo">🔴 Inativo</option>
                      <option value="manutencao">🟡 Manutenção</option>
                    </select>
                  </Field>
                  <Field label="📋 VENCIMENTO CRLV (OPCIONAL)"><input type="date" value={veicForm.venc_crlv} onChange={(e) => setVeicForm((f) => ({ ...f, venc_crlv: e.target.value }))} style={iS()} /></Field>
                  <Field label="🛡️ VENCIMENTO SEGURO OBRIGATÓRIO (OPCIONAL)"><input type="date" value={veicForm.venc_seguro_obrigatorio} onChange={(e) => setVeicForm((f) => ({ ...f, venc_seguro_obrigatorio: e.target.value }))} style={iS()} /></Field>
                  <button className="sbtn" onClick={handleVeicSubmit} disabled={!online} style={{ padding: "13px", background: online ? "#f97316" : "#2a2c3a", border: "none", borderRadius: 10, color: online ? "#fff" : "#5a5a6a", fontFamily: "inherit", fontSize: 13, fontWeight: 500, letterSpacing: 1.5, cursor: online ? "pointer" : "not-allowed" }}>CADASTRAR VEÍCULO</button>
                </div>
              </div>
            </div>
            <div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <SectionTitle icon="🚗">Veículos ({veiculosVisiveis.length}{!isAdmin ? `/${limiteVeiculos}` : ""})</SectionTitle>
                {veiculosVisiveis.length > 0 && !isOperador && (
                  <button onClick={imprimirTodosQRVeiculos} style={{ padding:"7px 14px", background:"#1e2535", border:"1px solid #a78bfa", borderRadius:8, color:"#a78bfa", fontFamily:"inherit", fontSize:11, cursor:"pointer", whiteSpace:"nowrap" }}>🖨️ Imprimir QR Codes</button>
                )}
              </div>
              {!isAdmin && veiculos.length >= limiteVeiculos && (
                <div style={{ background:"#2d0f0f", border:"1px solid #ef4444", borderRadius:8, padding:"10px 14px", fontSize:12, color:"#ef4444", marginBottom:12 }}>
                  🔒 Limite de veículos atingido. Faça upgrade para o próximo plano.
                </div>
              )}
              {veiculos.length === 0 ? <EmptyState>Nenhum veículo.</EmptyState> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {veiculosVisiveis.map((v) => {
                    const sCrlv = statusVenc(v.venc_crlv);
                    const sSeg = statusVenc(v.venc_seguro_obrigatorio);
                    const temAlerta = (sCrlv && sCrlv.cor !== "#4ade80") || (sSeg && sSeg.cor !== "#4ade80");
                    return (
                      <div key={v.id} className="row-item" style={{ background: "#1a1c27", border: `1px solid ${temAlerta ? "#b45309" : "#2a2c3a"}`, borderRadius: 8, padding: "10px 14px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <div style={{ fontSize: 13, fontFamily: "'DM Mono',monospace", fontWeight: 500, color:"#fff" }}>{v.placa}</div>
                              <span style={{ fontSize:9, padding:"2px 6px", borderRadius:4, background: v.status==="ativo"?"#14532d":v.status==="manutencao"?"#2d1f0a":"#2d0f0f", color: v.status==="ativo"?"#4ade80":v.status==="manutencao"?"#fbbf24":"#ef4444" }}>
                                {v.status==="ativo"?"ATIVO":v.status==="manutencao"?"MANUTENÇÃO":"INATIVO"}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: "#8a8a9a", marginTop: 2 }}>{v.departamento}{v.modelo ? " · " + v.modelo : ""}{v.ano ? " (" + v.ano + ")" : ""}</div>
                          </div>
                          <div style={{ display:"flex", gap:6 }}>
                            {podeGerenciar && (
                              <button onClick={() => setEditVeiculo({ ...v })} className="sbtn" style={{ background:"#1e3a2a", border:"1px solid #4ade80", borderRadius:6, color:"#4ade80", cursor:"pointer", padding:"5px 10px", fontSize:11, fontFamily:"inherit" }}>✏️</button>
                            )}
                            <button onClick={() => setQrModal({ tipo: "veiculo", item: v })} className="sbtn" style={{ background: "#0e2030", border: "1px solid #38bdf8", borderRadius: 6, color: "#38bdf8", cursor: "pointer", padding: "5px 10px", fontSize: 11, fontFamily: "inherit" }}>QR</button>
                          </div>
                        </div>
                        {(sCrlv || sSeg) && (
                          <div style={{ display:"flex", gap:8, marginTop:8, flexWrap:"wrap" }}>
                            {sCrlv && <span style={{ fontSize:10, padding:"3px 8px", borderRadius:6, background:sCrlv.bg, border:`1px solid ${sCrlv.border}`, color:sCrlv.cor }}>{sCrlv.icone} CRLV: {sCrlv.texto}</span>}
                            {sSeg && <span style={{ fontSize:10, padding:"3px 8px", borderRadius:6, background:sSeg.bg, border:`1px solid ${sSeg.border}`, color:sSeg.cor }}>{sSeg.icone} Seguro: {sSeg.texto}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ADMIN */}
        {!loading && activeTab === "logs" && isAdmin && (
          <div className="fade-in">
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
              <SectionTitle icon="📋">Log de Atividades</SectionTitle>
              <button onClick={() => api.get("logs","order=created_at.desc&limit=200").then(setLogs)} style={{ padding:"7px 14px", background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:8, color:"#8a8a9a", fontFamily:"inherit", fontSize:11, cursor:"pointer" }}>🔄 Atualizar</button>
            </div>
            {logs.length === 0 ? <EmptyState>Nenhuma atividade registrada.</EmptyState> : (
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {logs.map((l, i) => (
                  <div key={i} className="log-row" style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:10, padding:"10px 14px", display:"grid", gridTemplateColumns:"1fr 2fr 1.5fr auto", gap:10, alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:10, color:"#5a5a6a", letterSpacing:1 }}>{new Date(l.created_at).toLocaleString("pt-BR")}</div>
                      <div style={{ fontSize:11, color:"#8a8a9a", marginTop:2 }}>{l.estabelecimento}</div>
                    </div>
                    <div style={{ fontSize:12, color:"#fff", fontFamily:"'DM Mono',monospace" }}>{l.descricao}</div>
                    <div>
                      <div style={{ fontSize:11, color:"#8a8a9a" }}>{l.usuario_nome}</div>
                      <div style={{ fontSize:10, color:"#5a5a6a" }}>{l.usuario_perfil}</div>
                    </div>
                    <span style={{ fontSize:10, padding:"2px 8px", borderRadius:4,
                      background: l.acao==="ABASTECIMENTO_CRIADO"?"#14532d": l.acao==="ABASTECIMENTO_EDITADO"?"#1e2535":"#2d0f0f",
                      color: l.acao==="ABASTECIMENTO_CRIADO"?"#4ade80": l.acao==="ABASTECIMENTO_EDITADO"?"#38bdf8":"#ef4444",
                      border: `1px solid ${l.acao==="ABASTECIMENTO_CRIADO"?"#16a34a": l.acao==="ABASTECIMENTO_EDITADO"?"#38bdf8":"#ef4444"}`
                    }}>
                      {l.acao==="ABASTECIMENTO_CRIADO"?"✚ CRIADO": l.acao==="ABASTECIMENTO_EDITADO"?"✏️ EDITADO":"✕ EXCLUÍDO"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && activeTab === "admin" && isAdmin && (
          <div className="fade-in">
            <div className="admin-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
              <div>
                <SectionTitle icon="🏪">Estabelecimentos</SectionTitle>
                {estOk && <Alert type="success">✓ Estabelecimento criado!</Alert>}
                {editEstOk && <Alert type="success">✓ Estabelecimento atualizado!</Alert>}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                  <Field label="NOME"><input type="text" placeholder="Nome do estabelecimento" value={estForm.nome} onChange={(e) => setEstForm((f) => ({ ...f, nome: e.target.value }))} style={iS()} /></Field>
                  <Field label="CNPJ (OPCIONAL)"><input type="text" placeholder="00.000.000/0001-00" value={estForm.cnpj} onChange={(e) => setEstForm((f) => ({ ...f, cnpj: e.target.value }))} style={iS()} /></Field>
                  <Field label="TELEFONE (OPCIONAL)"><input type="text" placeholder="(44) 99999-9999" value={estForm.telefone} onChange={(e) => setEstForm((f) => ({ ...f, telefone: e.target.value }))} style={iS()} /></Field>
                  <Field label="PLANO">
                    <select value={estForm.plano} onChange={(e) => setEstForm((f) => ({ ...f, plano: e.target.value }))} style={iS()}>
                      <option value="basico">Básico</option>
                      <option value="profissional">Profissional</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </Field>
                  <button className="sbtn" onClick={handleEstSubmit} style={{ padding: "13px", background: "#f97316", border: "none", borderRadius: 10, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 500, letterSpacing: 1.5, cursor: "pointer" }}>CRIAR ESTABELECIMENTO</button>
                </div>
                {estabelecimentos.filter((e) => e.nome !== "Administrador").length === 0 ? <EmptyState>Nenhum estabelecimento.</EmptyState> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {estabelecimentos.filter((e) => e.nome !== "Administrador").map((e) => (
                      <div key={e.id} className="row-item" style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 8, padding: "10px 14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: e.ativo === false ? "#5a5a6a" : "#fff" }}>{e.nome}</div>
                            <span style={{ fontSize:9, padding:"2px 7px", borderRadius:4, background: e.ativo===false?"#2d0f0f": e.plano==="enterprise"?"#2d1a50":e.plano==="profissional"?"#1a2535":"#1a1c27", color: e.ativo===false?"#ef4444":e.plano==="enterprise"?"#a78bfa":e.plano==="profissional"?"#38bdf8":"#5a5a6a", border:`1px solid ${e.ativo===false?"#ef4444":e.plano==="enterprise"?"#a78bfa":e.plano==="profissional"?"#38bdf8":"#3a3a4a"}` }}>
                              {e.ativo===false?"BLOQUEADO":e.plano==="enterprise"?"ENTERPRISE":e.plano==="profissional"?"PROFISSIONAL":"BÁSICO"}
                            </span>
                          </div>
                          {e.cnpj && <div style={{ fontSize: 11, color: "#8a8a9a", marginTop: 2 }}>{e.cnpj}</div>}
                          {e.telefone && <div style={{ fontSize: 11, color: "#8a8a9a" }}>{e.telefone}</div>}
                        </div>
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={() => setEditEst({ ...e })} className="sbtn" style={{ background:"#1e2535", border:"1px solid #f97316", borderRadius:6, color:"#f97316", cursor:"pointer", padding:"5px 10px", fontSize:11, fontFamily:"inherit" }}>✏️</button>
                          <button onClick={async () => {
                            const novoAtivo = e.ativo === false ? true : false;
                            await fetch(`${SUPABASE_URL}/rest/v1/estabelecimentos?id=eq.${e.id}`, { method:"PATCH", headers:{"apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`,"Content-Type":"application/json","Prefer":"return=minimal"}, body:JSON.stringify({ativo:novoAtivo}) });
                            setEstabelecimentos((ests) => ests.map((x) => x.id===e.id?{...x,ativo:novoAtivo}:x));
                          }} className="sbtn" style={{ background: e.ativo===false?"#1e3a2a":"#2d1f0a", border:`1px solid ${e.ativo===false?"#16a34a":"#b45309"}`, borderRadius:6, color:e.ativo===false?"#4ade80":"#fbbf24", cursor:"pointer", padding:"5px 10px", fontSize:11, fontFamily:"inherit" }}>
                            {e.ativo===false?"✓ Ativar":"⊘ Bloquear"}
                          </button>
                          <button className="del-btn" onClick={() => handleDeleteEst(e.id)} style={{ background:"none", border:"1px solid #3a2020", borderRadius:6, color:"#ef4444", cursor:"pointer", padding:"4px 8px", fontSize:12, fontFamily:"inherit" }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <SectionTitle icon="👥">Usuários / Logins</SectionTitle>
                {userOk && <Alert type="success">✓ Usuário criado!</Alert>}
                {editUserOk && <Alert type="success">✓ Senha alterada!</Alert>}
                {editUser && (
                  <div style={{ background: "#1e2535", border: "1px solid #f97316", borderRadius: 10, padding: 16, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: "#f97316", letterSpacing: 1, marginBottom: 10 }}>ALTERAR SENHA — {editUser.nome}</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input type="text" placeholder="Nova senha" value={editUser.novaSenha || ""} onChange={(e) => setEditUser((u) => ({ ...u, novaSenha: e.target.value }))} style={{ ...iS(), flex: 1, fontSize: 13 }} />
                      <button onClick={handleEditUser} style={{ padding: "10px 14px", background: "#f97316", border: "none", borderRadius: 8, color: "#fff", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>✓</button>
                      <button onClick={() => setEditUser(null)} style={{ padding: "10px 14px", background: "none", border: "1px solid #3a2020", borderRadius: 8, color: "#ef4444", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}>✕</button>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                  <Field label="NOME"><input type="text" placeholder="Nome do usuário" value={userForm.nome} onChange={(e) => setUserForm((f) => ({ ...f, nome: e.target.value }))} style={iS()} /></Field>
                  <Field label="E-MAIL"><input type="email" placeholder="email@exemplo.com" value={userForm.email} onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))} style={iS()} /></Field>

                  <div style={{ background:"#1e2535", border:"1px solid #38bdf8", borderRadius:8, padding:"10px 14px", fontSize:11, color:"#38bdf8", marginBottom:4 }}>
                    ℹ️ Crie o usuário primeiro em <strong>Supabase → Authentication → Users</strong> com email e senha. Depois registre aqui o perfil.
                  </div>
                  <Field label="PERFIL">
                    <select value={userForm.perfil} onChange={(e) => setUserForm((f) => ({ ...f, perfil: e.target.value }))} style={iS()}>
                      <option value="gestor">Gestor (empresa)</option>
                      <option value="operador">Operador (só registra)</option>
                    </select>
                  </Field>
                  <Field label="ESTABELECIMENTO">
                    <select value={userForm.estabelecimento_id} onChange={(e) => setUserForm((f) => ({ ...f, estabelecimento_id: e.target.value }))} style={iS()}>
                      <option value="">— Selecione —</option>
                      {estabelecimentos.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                  </Field>
                  <button className="sbtn" onClick={handleUserSubmit} style={{ padding: "13px", background: "#f97316", border: "none", borderRadius: 10, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 500, letterSpacing: 1.5, cursor: "pointer" }}>CRIAR USUÁRIO</button>
                </div>
                {usuarios.filter((u) => {
                  if (u.perfil === "admin") return false;
                  if (u.email === usuario?.email) return false;
                  if (isGestor && u.estabelecimento_id !== estId) return false;
                  return true;
                }).length === 0 ? <EmptyState>Nenhum usuário.</EmptyState> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {usuarios.filter((u) => {
                  if (u.perfil === "admin") return false;
                  if (u.email === usuario?.email) return false;
                  // Gestor só vê operadores do seu próprio estabelecimento
                  if (isGestor && u.estabelecimento_id !== estId) return false;
                  return true;
                }).map((u) => (
                      <div key={u.id} className="row-item" style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>{u.nome}</div>
                            <span style={{ fontSize:9, padding:"2px 7px", borderRadius:4, background: u.perfil==="gestor"?"#1e3a2a":u.perfil==="operador"?"#1e2535":"#2d1f0a", color: u.perfil==="gestor"?"#4ade80":u.perfil==="operador"?"#38bdf8":"#fbbf24" }}>
                              {u.perfil==="gestor"?"GESTOR":u.perfil==="operador"?"OPERADOR":"ADMIN"}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: "#8a8a9a", marginTop: 2 }}>{u.email} · {u.estabelecimentos?.nome}</div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          {(isAdmin || (isGestor && u.estabelecimento_id === estId && u.perfil === "operador")) && (
                            <button onClick={() => setEditUser({ ...u, novaSenha: "" })} style={{ background: "#1e2535", border: "1px solid #38bdf8", borderRadius: 6, color: "#38bdf8", cursor: "pointer", padding: "4px 10px", fontSize: 11, fontFamily: "inherit" }}>🔑</button>
                          )}
                          {isAdmin && (
                            <button className="del-btn" onClick={() => handleDeleteUser(u.id)} style={{ background: "none", border: "1px solid #3a2020", borderRadius: 6, color: "#ef4444", cursor: "pointer", padding: "4px 8px", fontSize: 12, fontFamily: "inherit" }}>✕</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Componente de alertas de vencimento ──────────────
function AlertasVencimento({ motorista, veiculo }) {
  if (!motorista && !veiculo) return null;
  const alertas = [];
  if (motorista) {
    const s = statusVenc(motorista.venc_cnh);
    if (s && s.cor !== "#4ade80") alertas.push({ texto: `${s.icone} CNH de ${motorista.nome}: ${s.texto}`, ...s });
  }
  if (veiculo) {
    const sc = statusVenc(veiculo.venc_crlv);
    const ss = statusVenc(veiculo.venc_seguro_obrigatorio);
    if (sc && sc.cor !== "#4ade80") alertas.push({ texto: `${sc.icone} CRLV ${veiculo.placa}: ${sc.texto}`, ...sc });
    if (ss && ss.cor !== "#4ade80") alertas.push({ texto: `${ss.icone} Seguro ${veiculo.placa}: ${ss.texto}`, ...ss });
  }
  if (alertas.length === 0) return null;
  return (
    <div style={{ marginBottom:14, display:"flex", flexDirection:"column", gap:6 }}>
      {alertas.map((a, i) => (
        <div key={i} style={{ background:a.bg, border:`1px solid ${a.border}`, borderRadius:8, padding:"10px 14px", fontSize:12, color:a.cor }}>
          {a.texto}
        </div>
      ))}
    </div>
  );
}

function PainelAlertas({ veiculos, motoristas, filtroEst, estabelecimentos }) {
  const alertas = [];
  // Filtrar por estabelecimento se necessário
  const estId = filtroEst && estabelecimentos
    ? (estabelecimentos.find((e) => e.nome === filtroEst) || {}).id
    : null;
  const veiculosFiltrados = estId ? veiculos.filter((v) => v.estabelecimento_id === estId) : veiculos;
  const motoristasFiltrados = estId ? motoristas.filter((m) => m.estabelecimento_id === estId) : motoristas;

  // Agrupar veículos — uma linha por placa
  const veicAlertas = {};
  veiculosFiltrados.forEach((v) => {
    const ac = statusVenc(v.venc_crlv);
    const as = statusVenc(v.venc_seguro_obrigatorio);
    const docs = [];
    if (ac && ac.cor !== "#4ade80") docs.push({ doc: "CRLV", status: ac });
    if (as && as.cor !== "#4ade80") docs.push({ doc: "Seguro", status: as });
    if (docs.length > 0) veicAlertas[v.placa] = docs;
  });
  // Motoristas — uma linha por motorista
  const motAlertas = [];
  motoristasFiltrados.forEach((m) => {
    const s = statusVenc(m.venc_cnh);
    if (s && s.cor !== "#4ade80") motAlertas.push({ nome: m.nome, status: s });
  });
  if (Object.keys(veicAlertas).length === 0 && motAlertas.length === 0) return null;
  // Pior status de cada veículo para cor da borda
  const piorStatus = (docs) => docs.find((d) => d.status.cor === "#ef4444") || docs[0];
  return (
    <div style={{ background:"#1a1c27", border:"1px solid #b45309", borderRadius:12, padding:"14px 16px", marginBottom:20 }}>
      <div style={{ fontSize:10, color:"#fbbf24", letterSpacing:2, marginBottom:10 }}>⚠️ ATENÇÃO — DOCUMENTOS</div>
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {Object.entries(veicAlertas).map(([placa, docs]) => {
          const ps = piorStatus(docs);
          return (
            <div key={placa} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 10px", borderRadius:8, background:ps.status.bg, border:`1px solid ${ps.status.border}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                <span style={{ fontSize:13, fontWeight:500, color:"#fff", fontFamily:"'DM Mono',monospace" }}>{placa}</span>
                {docs.map((d, i) => (
                  <span key={i} style={{ fontSize:10, color:d.status.cor, background:"rgba(0,0,0,0.25)", padding:"1px 6px", borderRadius:4 }}>
                    {d.status.icone} {d.doc}
                  </span>
                ))}
              </div>
              <span style={{ fontSize:11, color:ps.status.cor, whiteSpace:"nowrap", marginLeft:8 }}>{ps.status.texto}</span>
            </div>
          );
        })}
        {motAlertas.map((m, i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 10px", borderRadius:8, background:m.status.bg, border:`1px solid ${m.status.border}` }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:13, fontWeight:500, color:"#fff" }}>{m.nome}</span>
              <span style={{ fontSize:10, color:m.status.cor, background:"rgba(0,0,0,0.25)", padding:"1px 6px", borderRadius:4 }}>{m.status.icone} CNH</span>
            </div>
            <span style={{ fontSize:11, color:m.status.cor, whiteSpace:"nowrap", marginLeft:8 }}>{m.status.texto}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div className="field" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label className="field-label" style={{ fontSize: 10, color: error ? "#ef4444" : "#5a5a6a", letterSpacing: 2 }}>{label}</label>
      {children}
      {error && <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>}
    </div>
  );
}
function SectionTitle({ icon, children }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}><span style={{ fontSize: 16 }}>{icon}</span><span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: 1, color: "#fff" }}>{children}</span></div>;
}
function Alert({ type, children }) {
  const c = { success: { bg: "#14532d", border: "#16a34a", color: "#4ade80" }, warn: { bg: "#2d1f0a", border: "#b45309", color: "#fbbf24" } }[type];
  return <div className="pop" style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "12px 18px", marginBottom: 16, fontSize: 13, color: c.color }}>{children}</div>;
}
function EmptyState({ children }) {
  return <div style={{ textAlign: "center", padding: "40px 20px", color: "#3a3a4a", fontSize: 13, letterSpacing: 1 }}>{children}</div>;
}
function iS(error) {
  return { background: "#1a1c27", border: `1px solid ${error ? "#ef4444" : "#2a2c3a"}`, borderRadius: 8, padding: "11px 14px", color: "#e8e4d9", fontFamily: "'DM Mono',monospace", fontSize: 14, width: "100%" };
}

import { useState, useEffect, useRef, useCallback } from "react";

// ── Supabase ─────────────────────────────────────────
const SUPABASE_URL = "https://tyesaqhtiqkakguimsdi.supabase.co";
const SUPABASE_KEY = "sb_publishable_njutNAXOpPS8ueQNykDNLA_OKUOCyXj";

const sb = async (path, opts = {}) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": opts.prefer || "return=representation",
      ...opts.headers,
    },
    ...opts,
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || "Erro"); }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
};

const api = {
  get: (table, query = "") => sb(`${table}?${query}`),
  post: (table, body) => sb(table, { method: "POST", body: JSON.stringify(body) }),
};

// ── Cache local (IndexedDB via localStorage) ─────────
const cache = {
  set: (key, data) => { try { localStorage.setItem(`frota_${key}`, JSON.stringify(data)); } catch (_) {} },
  get: (key) => { try { const d = localStorage.getItem(`frota_${key}`); return d ? JSON.parse(d) : null; } catch (_) { return null; } },
  del: (key) => { try { localStorage.removeItem(`frota_${key}`); } catch (_) {} },
};

// ── Fila offline ─────────────────────────────────────
const getQueue = () => cache.get("queue") || [];
const addToQueue = (item) => { const q = getQueue(); q.push(item); cache.set("queue", q); };
const clearQueue = () => cache.del("queue");

const COMBUSTIVEIS = ["Gasolina Comum", "Gasolina Aditivada", "Etanol", "Diesel S10", "Diesel S500", "GNV", "Elétrico"];
const now = () => new Date().toISOString().slice(0, 16);
const fmtBRL = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v, d = 2) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d });
const qrUrl = (data) => `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`;

// ── Hook: status de conexão ───────────────────────────
function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

// ── QR Scanner ────────────────────────────────────────
function useQRScanner(onResult) {
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 50);
      if (!("BarcodeDetector" in window)) { setError("Use Chrome/Android ou selecione manualmente."); return; }
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      intervalRef.current = setInterval(async () => {
        if (!videoRef.current) return;
        try { const codes = await detector.detect(videoRef.current); if (codes.length > 0) { stop(); onResult(codes[0].rawValue); } } catch (_) {}
      }, 400);
    } catch { setError("Não foi possível acessar a câmera."); setScanning(false); }
  }, [onResult, stop]);

  useEffect(() => () => stop(), [stop]);
  return { scanning, error, videoRef, start, stop };
}

// ── Banner offline ────────────────────────────────────
function OfflineBanner({ pendentes, syncing }) {
  return (
    <div style={{ background: "#2d1f0a", borderBottom: "1px solid #b45309", padding: "10px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>📡</span>
        <div>
          <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 500 }}>Modo Offline</div>
          <div style={{ fontSize: 10, color: "#92400e" }}>Os dados serão sincronizados quando houver conexão</div>
        </div>
      </div>
      {pendentes > 0 && (
        <div style={{ background: "#92400e", borderRadius: 8, padding: "4px 10px", fontSize: 11, color: "#fbbf24" }}>
          {syncing ? "Sincronizando..." : `${pendentes} pendente${pendentes > 1 ? "s" : ""}`}
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
          <select value={manualValue} onChange={onManual} style={{ ...iS(manualError), fontSize: 12 }}>
            <option value="">— Ou selecione manualmente —</option>
            {manualOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {manualError && <span style={{ fontSize: 11, color: "#ef4444" }}>{manualError}</span>}
        </div>
      )}
    </div>
  );
}

// ── Login ─────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const online = useOnline();

  const handleLogin = async () => {
    if (!email.trim() || !senha.trim()) { setError("Preencha e-mail e senha"); return; }
    setLoading(true); setError("");

    // Tenta login online
    if (online) {
      try {
        const users = await api.get("usuarios", `email=eq.${encodeURIComponent(email)}&senha=eq.${encodeURIComponent(senha)}&select=*,estabelecimentos(*)`);
        if (users.length === 0) { setError("E-mail ou senha incorretos"); setLoading(false); return; }
        cache.set("usuario", users[0]); // salva para login offline
        onLogin(users[0]);
        return;
      } catch { setError("Erro ao conectar."); setLoading(false); return; }
    }

    // Login offline com cache
    const cached = cache.get("usuario");
    if (cached && cached.email === email && cached.senha === senha) {
      onLogin(cached);
    } else {
      setError("Sem conexão e usuário não encontrado em cache.");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'DM Mono','Courier New',monospace" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap'); *{box-sizing:border-box} input{outline:none}`}</style>
      <div style={{ width: "100%", maxWidth: 380 }}>
        {!online && (
          <div style={{ background: "#2d1f0a", border: "1px solid #b45309", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: "#fbbf24", textAlign: "center" }}>
            📡 Sem conexão — modo offline
          </div>
        )}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ width: 60, height: 60, borderRadius: 16, background: "#f97316", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 16px" }}>⛽</div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 26, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>ABASTECIMENTO</div>
          <div style={{ fontSize: 11, color: "#5a5a6a", letterSpacing: 2, marginTop: 4 }}>CONTROLE DE FROTA</div>
        </div>
        <div style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 16, padding: 28 }}>
          {error && <div style={{ background: "#2d0f0f", border: "1px solid #ef4444", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#ef4444", marginBottom: 16 }}>{error}</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2, display: "block", marginBottom: 6 }}>E-MAIL</label>
              <input type="email" placeholder="seu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} style={{ ...iS(), width: "100%" }} />
            </div>
            <div>
              <label style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2, display: "block", marginBottom: 6 }}>SENHA</label>
              <input type="password" placeholder="••••••••" value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} style={{ ...iS(), width: "100%" }} />
            </div>
            <button onClick={handleLogin} disabled={loading} style={{ padding: "14px", background: "#f97316", border: "none", borderRadius: 10, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 500, letterSpacing: 1.5, cursor: loading ? "not-allowed" : "pointer", marginTop: 4, opacity: loading ? 0.7 : 1 }}>
              {loading ? "ENTRANDO..." : "ENTRAR"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Comprovante ───────────────────────────────────────
function Comprovante({ registro, estabelecimento, onClose }) {
  const handleShare = async () => {
    const texto = `⛽ COMPROVANTE DE ABASTECIMENTO\n─────────────────────────\nEstabelecimento: ${estabelecimento}\nData: ${(registro.data_hora || registro.dataHora)?.replace("T", " ").slice(0, 16)}\nMotorista: ${registro.motorista_nome}\n${registro.motorista_cnh ? "CNH: " + registro.motorista_cnh + "\n" : ""}Veículo: ${registro.placa}${registro.modelo ? " · " + registro.modelo : ""}\nDepto: ${registro.departamento}\n${registro.hodometro ? "Hodômetro: " + fmtNum(registro.hodometro, 0) + " km\n" : ""}─────────────────────────\nCombustível: ${registro.combustivel}\nQuantidade: ${fmtNum(registro.quantidade)} L\nPreço/litro: ${fmtBRL(registro.custo / registro.quantidade)}\nTotal: ${fmtBRL(registro.custo)}\n─────────────────────────`;
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
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: 1, marginTop: 4 }}>COMPROVANTE DE ABASTECIMENTO</div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{estabelecimento}</div>
          </div>
          <Divider />
          <Row label="Data" value={(registro.data_hora || registro.dataHora)?.replace("T", " ").slice(0, 16)} />
          <Row label="Motorista" value={registro.motorista_nome} />
          {registro.motorista_cnh && <Row label="CNH" value={registro.motorista_cnh} />}
          <Row label="Veículo" value={registro.placa} />
          {registro.modelo && <Row label="Modelo" value={registro.modelo} />}
          <Row label="Depto" value={registro.departamento} />
          {registro.hodometro && <Row label="Hodômetro" value={`${fmtNum(registro.hodometro, 0)} km`} />}
          <Divider />
          <Row label="Combustível" value={registro.combustivel} />
          <Row label="Quantidade" value={`${fmtNum(registro.quantidade)} L`} />
          <Row label="Preço/litro" value={fmtBRL(registro.custo / registro.quantidade)} />
          <Divider />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>TOTAL</span>
            <span style={{ fontSize: 20, fontFamily: "'Syne',sans-serif", fontWeight: 800 }}>{fmtBRL(registro.custo)}</span>
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
function Row({ label, value }) {
  return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}><span style={{ color: "#666" }}>{label}:</span><span style={{ fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{value}</span></div>;
}

// ── Relatórios ────────────────────────────────────────
function Relatorios({ registros }) {
  const [tipo, setTipo] = useState("departamento");
  const [periodo, setPeriodo] = useState("todos");
  const hoje = new Date();
  const regs = registros.filter((r) => {
    const dt = r.data_hora || r.dataHora || "";
    if (periodo === "hoje") return dt.startsWith(hoje.toISOString().slice(0, 10));
    if (periodo === "mes") return dt.startsWith(hoje.toISOString().slice(0, 7));
    return true;
  });
  const campos = { departamento: "departamento", veiculo: "placa", motorista: "motorista_nome", combustivel: "combustivel" };
  const grupos = {};
  regs.forEach((r) => {
    const chave = r[campos[tipo]] || "—";
    if (!grupos[chave]) grupos[chave] = { litros: 0, custo: 0, count: 0 };
    grupos[chave].litros += Number(r.quantidade) || 0;
    grupos[chave].custo += Number(r.custo) || 0;
    grupos[chave].count += 1;
  });
  const lista = Object.entries(grupos).sort((a, b) => b[1].custo - a[1].custo);
  const totalCusto = regs.reduce((a, b) => a + Number(b.custo || 0), 0);

  return (
    <div className="fade-in">
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {[["departamento", "🏢 Depto"], ["veiculo", "🚗 Veículo"], ["motorista", "👤 Motorista"], ["combustivel", "⛽ Combustível"]].map(([id, label]) => (
          <button key={id} onClick={() => setTipo(id)} style={{ padding: "8px 14px", background: tipo === id ? "#f97316" : "#1a1c27", border: `1px solid ${tipo === id ? "#f97316" : "#2a2c3a"}`, borderRadius: 8, color: tipo === id ? "#fff" : "#8a8a9a", fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>{label}</button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {[["todos", "Todos"], ["mes", "Este mês"], ["hoje", "Hoje"]].map(([id, label]) => (
            <button key={id} onClick={() => setPeriodo(id)} style={{ padding: "8px 12px", background: periodo === id ? "#1e3a2a" : "#1a1c27", border: `1px solid ${periodo === id ? "#16a34a" : "#2a2c3a"}`, borderRadius: 8, color: periodo === id ? "#4ade80" : "#8a8a9a", fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>{label}</button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[["REGISTROS", regs.length, ""], ["TOTAL LITROS", fmtNum(regs.reduce((a, b) => a + Number(b.quantidade || 0), 0)), "L"], ["TOTAL GASTO", fmtBRL(totalCusto), ""]].map(([label, val, unit]) => (
          <div key={label} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2 }}>{label}</div>
            <div style={{ fontSize: 18, fontFamily: "'Syne',sans-serif", fontWeight: 800, color: "#f97316", marginTop: 4 }}>{val}{unit && <span style={{ fontSize: 12, marginLeft: 3, color: "#8a8a9a" }}>{unit}</span>}</div>
          </div>
        ))}
      </div>
      {lista.length === 0 ? <EmptyState>Nenhum dado.</EmptyState> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lista.map(([chave, dados]) => {
            const pct = totalCusto > 0 ? (dados.custo / totalCusto) * 100 : 0;
            return (
              <div key={chave} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#fff" }}>{chave}</div>
                    <div style={{ fontSize: 11, color: "#5a5a6a", marginTop: 2 }}>{dados.count} registro{dados.count !== 1 ? "s" : ""} · {fmtNum(dados.litros)} L</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 16, fontFamily: "'Syne',sans-serif", fontWeight: 800, color: "#f97316" }}>{fmtBRL(dados.custo)}</div>
                    <div style={{ fontSize: 11, color: "#5a5a6a" }}>{pct.toFixed(1)}%</div>
                  </div>
                </div>
                <div style={{ height: 4, background: "#2a2c3a", borderRadius: 2 }}>
                  <div style={{ height: 4, background: "#f97316", borderRadius: 2, width: `${pct}%`, transition: "width 0.5s ease" }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── App Principal ─────────────────────────────────────
export default function App() {
  const [usuario, setUsuario] = useState(() => cache.get("usuario_sessao"));
  const online = useOnline();
  const [activeTab, setActiveTab] = useState("registrar");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const [motoristas, setMotoristas] = useState(() => cache.get("motoristas") || []);
  const [veiculos, setVeiculos] = useState(() => cache.get("veiculos") || []);
  const [registros, setRegistros] = useState(() => cache.get("registros") || []);
  const [departamentos, setDepartamentos] = useState(() => cache.get("departamentos") || []);
  const [estabelecimentos, setEstabelecimentos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);

  const [loading, setLoading] = useState(false);
  const [comprovante, setComprovante] = useState(null);
  const [qrModal, setQrModal] = useState(null);
  const [search, setSearch] = useState("");

  const [form, setForm] = useState({ dataHora: now(), combustivel: COMBUSTIVEIS[0], quantidade: "", custo: "", hodometro: "" });
  const [formErrors, setFormErrors] = useState({});
  const [scannedMot, setScannedMot] = useState(null);
  const [scannedVeic, setScannedVeic] = useState(null);
  const [motScanErr, setMotScanErr] = useState("");
  const [veicScanErr, setVeicScanErr] = useState("");

  const [motForm, setMotForm] = useState({ nome: "", cnh: "", departamento: "" });
  const [motErrors, setMotErrors] = useState({});
  const [motOk, setMotOk] = useState(false);
  const [veicForm, setVeicForm] = useState({ placa: "", modelo: "", ano: "", departamento: "" });
  const [veicErrors, setVeicErrors] = useState({});
  const [veicOk, setVeicOk] = useState(false);
  const [novoDpto, setNovoDpto] = useState("");
  const [dptoError, setDptoError] = useState("");
  const [dptoOk, setDptoOk] = useState(false);
  const [estForm, setEstForm] = useState({ nome: "", cnpj: "", telefone: "" });
  const [estOk, setEstOk] = useState(false);
  const [userForm, setUserForm] = useState({ nome: "", email: "", senha: "", perfil: "estabelecimento", estabelecimento_id: "" });
  const [userOk, setUserOk] = useState(false);

  const isAdmin = usuario?.perfil === "admin";
  const estId = usuario?.estabelecimento_id;
  const estNome = usuario?.estabelecimentos?.nome || "";

  // Login
  const handleLogin = (u) => {
    cache.set("usuario_sessao", u);
    setUsuario(u);
  };

  const handleLogout = () => {
    cache.del("usuario_sessao");
    setUsuario(null);
  };

  // Carregar dados online
  useEffect(() => {
    if (!usuario || !online) return;
    loadData();
  }, [usuario, online]);

  const loadData = async () => {
    setLoading(true);
    try {
      const q = isAdmin ? "" : `estabelecimento_id=eq.${estId}`;
      const [m, v, r, d] = await Promise.all([
        api.get("motoristas", q),
        api.get("veiculos", q),
        api.get("abastecimentos", `${q}&order=created_at.desc`),
        api.get("departamentos", q),
      ]);
      // Mesclar registros offline pendentes com os do servidor
      const offlineRegs = (cache.get("registros") || []).filter((r) => r._offline);
      const merged = [...offlineRegs, ...r];
      setMotoristas(m); cache.set("motoristas", m);
      setVeiculos(v); cache.set("veiculos", v);
      setRegistros(merged); cache.set("registros", merged);
      setDepartamentos(d.map((x) => x.nome)); cache.set("departamentos", d.map((x) => x.nome));

      if (isAdmin) {
        const [ests, users] = await Promise.all([api.get("estabelecimentos"), api.get("usuarios", "select=*,estabelecimentos(*)")]);
        setEstabelecimentos(ests); setUsuarios(users);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // Sincronizar fila offline quando voltar internet
  useEffect(() => {
    if (!online || !usuario) return;
    syncQueue();
  }, [online]);

  const syncQueue = async () => {
    const queue = getQueue();
    if (queue.length === 0) return;
    setSyncing(true); setSyncMsg(`Sincronizando ${queue.length} registro(s)...`);
    let sucesso = 0;
    for (const item of queue) {
      try {
        const { _offline, _localId, ...data } = item;
        await api.post("abastecimentos", data);
        sucesso++;
      } catch (e) { console.error("Sync erro:", e); }
    }
    clearQueue();
    // Remover registros offline da lista local e recarregar
    await loadData();
    setSyncing(false);
    setSyncMsg(sucesso > 0 ? `✓ ${sucesso} registro(s) sincronizado(s)!` : "");
    setTimeout(() => setSyncMsg(""), 4000);
  };

  // QR Scanners
  const handleMotQR = useCallback((raw) => {
    try {
      const d = JSON.parse(raw);
      const m = motoristas.find((x) => x.id === d.id && d.tipo === "motorista");
      if (m) { setScannedMot(m); setFormErrors((e) => ({ ...e, motoristaId: undefined })); }
      else setMotScanErr("Motorista não encontrado.");
    } catch { setMotScanErr("QR inválido."); }
  }, [motoristas]);

  const handleVeicQR = useCallback((raw) => {
    try {
      const d = JSON.parse(raw);
      const v = veiculos.find((x) => x.id === d.id && d.tipo === "veiculo");
      if (v) { setScannedVeic(v); setFormErrors((e) => ({ ...e, placaId: undefined })); }
      else setVeicScanErr("Veículo não encontrado.");
    } catch { setVeicScanErr("QR inválido."); }
  }, [veiculos]);

  const motScanner = useQRScanner(handleMotQR);
  const veicScanner = useQRScanner(handleVeicQR);
  const startMotScan = () => { veicScanner.stop(); setMotScanErr(""); motScanner.start(); };
  const startVeicScan = () => { motScanner.stop(); setVeicScanErr(""); veicScanner.start(); };

  // Registrar
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
      operador: estNome, estabelecimento_id: estId,
    };

    if (online) {
      try {
        const salvo = await api.post("abastecimentos", novoReg);
        const atualizado = [salvo[0], ...registros];
        setRegistros(atualizado); cache.set("registros", atualizado);
        setComprovante(salvo[0]);
      } catch { alert("Erro ao salvar."); return; }
    } else {
      // Modo offline: salva localmente e coloca na fila
      const regOffline = { ...novoReg, _offline: true, _localId: Date.now(), id: `offline_${Date.now()}` };
      addToQueue(novoReg);
      const atualizado = [regOffline, ...registros];
      setRegistros(atualizado); cache.set("registros", atualizado);
      setComprovante(regOffline);
    }

    setForm({ dataHora: now(), combustivel: COMBUSTIVEIS[0], quantidade: "", custo: "", hodometro: "" });
    setScannedMot(null); setScannedVeic(null);
  };

  // Motorista
  const handleMotSubmit = async () => {
    const e = {};
    if (!motForm.nome.trim()) e.nome = "Obrigatório";
    if (!motForm.departamento) e.departamento = "Selecione";
    if (Object.keys(e).length > 0) { setMotErrors(e); return; }
    if (!online) { alert("Precisa de conexão para cadastrar motoristas."); return; }
    try {
      const novo = await api.post("motoristas", { ...motForm, estabelecimento_id: estId });
      const atualizado = [...motoristas, novo[0]];
      setMotoristas(atualizado); cache.set("motoristas", atualizado);
      setMotForm({ nome: "", cnh: "", departamento: "" });
      setMotOk(true); setTimeout(() => setMotOk(false), 2200);
    } catch (err) { alert("Erro: " + err.message); }
  };

  // Veículo
  const handleVeicSubmit = async () => {
    const e = {};
    if (!veicForm.placa.trim()) e.placa = "Obrigatório";
    else if (veiculos.some((v) => v.placa.toUpperCase() === veicForm.placa.toUpperCase())) e.placa = "Placa já cadastrada";
    if (!veicForm.departamento) e.departamento = "Selecione";
    if (Object.keys(e).length > 0) { setVeicErrors(e); return; }
    if (!online) { alert("Precisa de conexão para cadastrar veículos."); return; }
    try {
      const novo = await api.post("veiculos", { ...veicForm, placa: veicForm.placa.toUpperCase(), estabelecimento_id: estId });
      const atualizado = [...veiculos, novo[0]];
      setVeiculos(atualizado); cache.set("veiculos", atualizado);
      setVeicForm({ placa: "", modelo: "", ano: "", departamento: "" });
      setVeicOk(true); setTimeout(() => setVeicOk(false), 2200);
    } catch (err) { alert("Erro: " + err.message); }
  };

  // Departamento
  const handleAddDpto = async () => {
    if (!novoDpto.trim()) { setDptoError("Informe o nome"); return; }
    if (departamentos.includes(novoDpto.trim())) { setDptoError("Já cadastrado"); return; }
    if (!online) { alert("Precisa de conexão para cadastrar departamentos."); return; }
    try {
      await api.post("departamentos", { nome: novoDpto.trim(), estabelecimento_id: estId });
      const atualizado = [...departamentos, novoDpto.trim()];
      setDepartamentos(atualizado); cache.set("departamentos", atualizado);
      setNovoDpto(""); setDptoError(""); setDptoOk(true); setTimeout(() => setDptoOk(false), 2000);
    } catch (err) { alert("Erro: " + err.message); }
  };

  // Admin
  const handleEstSubmit = async () => {
    if (!estForm.nome.trim()) return;
    try { const novo = await api.post("estabelecimentos", estForm); setEstabelecimentos((e) => [...e, novo[0]]); setEstForm({ nome: "", cnpj: "", telefone: "" }); setEstOk(true); setTimeout(() => setEstOk(false), 2200); } catch (err) { alert("Erro: " + err.message); }
  };

  const handleUserSubmit = async () => {
    if (!userForm.nome.trim() || !userForm.email.trim() || !userForm.senha.trim()) return;
    try { const novo = await api.post("usuarios", userForm); setUsuarios((u) => [...u, novo[0]]); setUserForm({ nome: "", email: "", senha: "", perfil: "estabelecimento", estabelecimento_id: "" }); setUserOk(true); setTimeout(() => setUserOk(false), 2200); } catch (err) { alert("Erro: " + err.message); }
  };

  const exportCSV = () => {
    const h = ["Data/Hora", "Estabelecimento", "Motorista", "CNH", "Placa", "Departamento", "Combustível", "Qtd (L)", "Hodômetro", "Custo (R$)", "Status"];
    const rows = registros.map((r) => [(r.data_hora || r.dataHora)?.slice(0, 16).replace("T", " "), r.operador, r.motorista_nome, r.motorista_cnh, r.placa, r.departamento, r.combustivel, r.quantidade, r.hodometro || "", r.custo, r._offline ? "Pendente" : "Sincronizado"]);
    const csv = [h, ...rows].map((r) => r.map((c) => `"${c ?? ""}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `abastecimentos_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const filtered = registros.filter((r) =>
    r.placa?.toUpperCase().includes(search.toUpperCase()) ||
    r.motorista_nome?.toLowerCase().includes(search.toLowerCase()) ||
    r.departamento?.toLowerCase().includes(search.toLowerCase())
  );

  const pendentes = getQueue().length;

  if (!usuario) return <LoginScreen onLogin={handleLogin} />;

  const TABS = [
    ["registrar", "Registrar"],
    ["registros", `Registros (${registros.length})`],
    ["relatorios", "Relatórios"],
    ["motoristas", `Motoristas (${motoristas.length})`],
    ["veiculos", `Veículos (${veiculos.length})`],
    ...(isAdmin ? [["admin", "⚙️ Admin"]] : []),
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", fontFamily: "'DM Mono','Courier New',monospace", color: "#e8e4d9" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box} ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0f1117} ::-webkit-scrollbar-thumb{background:#f97316;border-radius:2px}
        input,select{outline:none} input::placeholder{color:#4a4a55}
        .field input:focus,.field select:focus{border-color:#f97316!important}
        .tab-btn{transition:all 0.2s} .tab-btn:hover{color:#f97316}
        .del-btn{opacity:0;transition:opacity 0.2s} .row-item:hover .del-btn{opacity:1}
        .sbtn{transition:all 0.18s} .sbtn:hover:not(:disabled){filter:brightness(1.15);transform:translateY(-1px)}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}} .fade-in{animation:fadeIn 0.3s ease}
        @keyframes pop{0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)}} .pop{animation:pop 0.35s ease}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,0.4)}50%{box-shadow:0 0 0 10px rgba(249,115,22,0)}}
        .qr-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px}
      `}</style>

      {comprovante && <Comprovante registro={comprovante} estabelecimento={estNome} onClose={() => setComprovante(null)} />}
      {qrModal && (
        <div className="qr-overlay" onClick={() => setQrModal(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 16, padding: 32, textAlign: "center", maxWidth: 300 }}>
            <div style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2, marginBottom: 8 }}>{qrModal.tipo === "motorista" ? "QR DO MOTORISTA" : "QR DO VEÍCULO"}</div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, color: "#fff", marginBottom: 4 }}>{qrModal.tipo === "motorista" ? qrModal.item.nome : qrModal.item.placa}</div>
            <div style={{ fontSize: 11, color: "#5a5a6a", marginBottom: 20 }}>{qrModal.tipo === "motorista" ? `${qrModal.item.departamento}${qrModal.item.cnh ? " · CNH " + qrModal.item.cnh : ""}` : qrModal.item.departamento}</div>
            <img src={qrUrl(JSON.stringify({ id: qrModal.item.id, tipo: qrModal.tipo }))} alt="QR" style={{ width: 200, height: 200, borderRadius: 8, background: "#fff", padding: 8 }} />
            <button onClick={() => setQrModal(null)} style={{ marginTop: 14, padding: "10px 24px", background: "#f97316", border: "none", borderRadius: 8, color: "#fff", fontFamily: "inherit", fontSize: 12, letterSpacing: 1, cursor: "pointer" }}>FECHAR</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg,#1a1c27 0%,#0f1117 100%)", borderBottom: "1px solid #1e2030", padding: "20px 28px 0" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: "#f97316", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>⛽</div>
              <div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, letterSpacing: -0.5, color: "#fff" }}>ABASTECIMENTO</div>
                <div style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2, marginTop: -2 }}>{estNome.toUpperCase()}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: online ? "#4ade80" : "#f97316" }} title={online ? "Online" : "Offline"} />
              <span style={{ fontSize: 10, color: online ? "#4ade80" : "#f97316" }}>{online ? "online" : "offline"}</span>
              <button onClick={handleLogout} style={{ background: "none", border: "1px solid #2a2c3a", borderRadius: 8, color: "#5a5a6a", cursor: "pointer", padding: "6px 12px", fontSize: 11, fontFamily: "inherit" }}>Sair</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 0, marginTop: 16, overflowX: "auto" }}>
            {TABS.map(([id, label]) => (
              <button key={id} className="tab-btn" onClick={() => setActiveTab(id)} style={{ background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: 11, fontFamily: "inherit", whiteSpace: "nowrap", color: activeTab === id ? "#f97316" : "#5a5a6a", borderBottom: activeTab === id ? "2px solid #f97316" : "2px solid transparent", fontWeight: activeTab === id ? 500 : 400, letterSpacing: 0.5 }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Banner offline */}
      {!online && <OfflineBanner pendentes={pendentes} syncing={syncing} />}
      {syncMsg && <div style={{ background: "#14532d", borderBottom: "1px solid #16a34a", padding: "10px 28px", fontSize: 12, color: "#4ade80" }}>{syncMsg}</div>}

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 28px" }}>
        {loading && <div style={{ textAlign: "center", padding: 40, color: "#5a5a6a" }}>Carregando...</div>}

        {/* REGISTRAR */}
        {!loading && activeTab === "registrar" && (
          <div className="fade-in">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
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

            <div style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 10, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2, marginBottom: 2 }}>ESTABELECIMENTO</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "#f97316" }}>{estNome}</div>
              </div>
              <span style={{ fontSize: 11, color: "#4ade80" }}>✓ fixo</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Field label="DATA / HORA"><input type="datetime-local" value={form.dataHora} onChange={(e) => setForm((f) => ({ ...f, dataHora: e.target.value }))} style={iS()} /></Field>
              <Field label="TIPO DE COMBUSTÍVEL"><select value={form.combustivel} onChange={(e) => setForm((f) => ({ ...f, combustivel: e.target.value }))} style={iS()}>{COMBUSTIVEIS.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="HODÔMETRO (KM) — OPCIONAL"><input type="number" placeholder="Ex: 45230" min="0" value={form.hodometro} onChange={(e) => setForm((f) => ({ ...f, hodometro: e.target.value }))} style={iS()} /></Field>
              <div />
              <Field label="QUANTIDADE (LITROS)" error={formErrors.quantidade}><input type="number" placeholder="0.00" min="0" step="0.01" value={form.quantidade} onChange={(e) => { setForm((f) => ({ ...f, quantidade: e.target.value })); setFormErrors((err) => ({ ...err, quantidade: undefined })); }} style={iS(formErrors.quantidade)} /></Field>
              <Field label="CUSTO TOTAL (R$)" error={formErrors.custo}><input type="number" placeholder="0.00" min="0" step="0.01" value={form.custo} onChange={(e) => { setForm((f) => ({ ...f, custo: e.target.value })); setFormErrors((err) => ({ ...err, custo: undefined })); }} style={iS(formErrors.custo)} /></Field>
            </div>

            {+form.quantidade > 0 && +form.custo > 0 && (
              <div style={{ marginTop: 12, padding: "10px 16px", background: "#1a1c27", borderRadius: 8, border: "1px solid #2a2c3a", fontSize: 12, color: "#8a8a9a" }}>
                Preço/litro: <strong style={{ color: "#f97316" }}>{fmtBRL(parseFloat(form.custo) / parseFloat(form.quantidade))}</strong>
              </div>
            )}

            {!online && (
              <div style={{ marginTop: 12, padding: "10px 16px", background: "#2d1f0a", borderRadius: 8, border: "1px solid #b45309", fontSize: 12, color: "#fbbf24" }}>
                📡 Modo offline — o registro será salvo localmente e enviado quando houver conexão.
              </div>
            )}

            <button className="sbtn" onClick={handleRegistrar} style={{ marginTop: 18, width: "100%", padding: "15px", background: "#f97316", border: "none", borderRadius: 10, color: "#fff", fontFamily: "inherit", fontSize: 14, fontWeight: 500, letterSpacing: 1.5, cursor: "pointer" }}>
              {online ? "REGISTRAR ABASTECIMENTO" : "REGISTRAR OFFLINE"}
            </button>
          </div>
        )}

        {/* REGISTROS */}
        {!loading && activeTab === "registros" && (
          <div className="fade-in">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[["REGISTROS", registros.length, ""], ["TOTAL LITROS", fmtNum(registros.reduce((a, b) => a + Number(b.quantidade || 0), 0)), "L"], ["TOTAL GASTO", fmtBRL(registros.reduce((a, b) => a + Number(b.custo || 0), 0)), ""]].map(([label, val, unit]) => (
                <div key={label} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 10, padding: "14px 18px" }}>
                  <div style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2 }}>{label}</div>
                  <div style={{ fontSize: 18, fontFamily: "'Syne',sans-serif", fontWeight: 800, color: "#f97316", marginTop: 4 }}>{val}{unit && <span style={{ fontSize: 12, marginLeft: 3, color: "#8a8a9a" }}>{unit}</span>}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <input type="text" placeholder="🔍  Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...iS(), flex: 1, fontSize: 13 }} />
              <button onClick={exportCSV} disabled={registros.length === 0} className="sbtn" style={{ padding: "10px 18px", background: registros.length === 0 ? "#2a2c3a" : "#1a3a2a", border: `1px solid ${registros.length === 0 ? "#2a2c3a" : "#16a34a"}`, borderRadius: 8, color: registros.length === 0 ? "#4a4a55" : "#4ade80", fontFamily: "inherit", fontSize: 12, cursor: registros.length === 0 ? "not-allowed" : "pointer", letterSpacing: 1, whiteSpace: "nowrap" }}>↓ CSV</button>
            </div>
            {filtered.length === 0 ? <EmptyState>Nenhum registro.</EmptyState> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.map((r) => (
                  <div key={r.id || r._localId} className="row-item fade-in" style={{ background: "#1a1c27", border: `1px solid ${r._offline ? "#b45309" : "#2a2c3a"}`, borderRadius: 10, padding: "14px 18px", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr auto", alignItems: "center", gap: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>{r.motorista_nome}</div>
                        {r._offline && <span style={{ fontSize: 9, background: "#92400e", color: "#fbbf24", borderRadius: 4, padding: "2px 5px" }}>OFFLINE</span>}
                      </div>
                      <div style={{ fontSize: 11, color: "#5a5a6a", marginTop: 2 }}>{(r.data_hora || r.dataHora)?.slice(0, 16).replace("T", " ")}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontFamily: "'Syne',sans-serif", fontWeight: 700, letterSpacing: 1 }}>{r.placa}</div>
                      <div style={{ fontSize: 11, color: "#f97316", marginTop: 2 }}>{r.combustivel}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{fmtNum(r.quantidade)} L</div>
                      <div style={{ fontSize: 12, color: "#4ade80", marginTop: 2 }}>{fmtBRL(r.custo)}</div>
                    </div>
                    <button onClick={() => setComprovante(r)} className="sbtn" style={{ background: "#1e2535", border: "1px solid #f97316", borderRadius: 6, color: "#f97316", cursor: "pointer", padding: "6px 8px", fontSize: 14 }}>🧾</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* RELATÓRIOS */}
        {!loading && activeTab === "relatorios" && <Relatorios registros={registros} />}

        {/* MOTORISTAS */}
        {!loading && activeTab === "motoristas" && (
          <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>
            <div>
              <SectionTitle icon="👤">Cadastrar Motorista</SectionTitle>
              {!online && <Alert type="warn">⚠ Sem conexão. Cadastro indisponível offline.</Alert>}
              {motOk && <Alert type="success">✓ Motorista cadastrado!</Alert>}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Field label="NOME" error={motErrors.nome}><input type="text" placeholder="Nome completo" value={motForm.nome} onChange={(e) => { setMotForm((f) => ({ ...f, nome: e.target.value })); setMotErrors((x) => ({ ...x, nome: undefined })); }} style={iS(motErrors.nome)} /></Field>
                <Field label="DEPARTAMENTO" error={motErrors.departamento}>
                  <select value={motForm.departamento} onChange={(e) => { setMotForm((f) => ({ ...f, departamento: e.target.value })); setMotErrors((x) => ({ ...x, departamento: undefined })); }} style={iS(motErrors.departamento)}>
                    <option value="">— Selecione —</option>
                    {departamentos.map((d) => <option key={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="CNH (OPCIONAL)"><input type="text" placeholder="Número da CNH" value={motForm.cnh} onChange={(e) => setMotForm((f) => ({ ...f, cnh: e.target.value }))} style={iS()} /></Field>
                <button className="sbtn" onClick={handleMotSubmit} disabled={!online} style={{ padding: "13px", background: online ? "#f97316" : "#2a2c3a", border: "none", borderRadius: 10, color: online ? "#fff" : "#5a5a6a", fontFamily: "inherit", fontSize: 13, fontWeight: 500, letterSpacing: 1.5, cursor: online ? "pointer" : "not-allowed" }}>CADASTRAR</button>
              </div>
            </div>
            <div>
              <SectionTitle icon="📋">Cadastrados</SectionTitle>
              {motoristas.length === 0 ? <EmptyState>Nenhum motorista.</EmptyState> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {motoristas.map((m) => (
                    <div key={m.id} className="row-item" style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>{m.nome}</div>
                        <div style={{ fontSize: 11, color: "#8a8a9a", marginTop: 2 }}>{m.departamento}{m.cnh ? " · CNH " + m.cnh : ""}</div>
                      </div>
                      <button onClick={() => setQrModal({ tipo: "motorista", item: m })} className="sbtn" style={{ background: "#1e2535", border: "1px solid #f97316", borderRadius: 6, color: "#f97316", cursor: "pointer", padding: "5px 10px", fontSize: 11, fontFamily: "inherit" }}>QR</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* VEÍCULOS */}
        {!loading && activeTab === "veiculos" && (
          <div className="fade-in" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>
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
                  {departamentos.map((d) => <div key={d} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>🏢 {d}</div>)}
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
                      {departamentos.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </Field>
                  <Field label="MODELO"><input type="text" placeholder="Ex: Fiat Strada" value={veicForm.modelo} onChange={(e) => setVeicForm((f) => ({ ...f, modelo: e.target.value }))} style={iS()} /></Field>
                  <Field label="ANO"><input type="text" placeholder="2023" maxLength={4} value={veicForm.ano} onChange={(e) => setVeicForm((f) => ({ ...f, ano: e.target.value }))} style={iS()} /></Field>
                  <button className="sbtn" onClick={handleVeicSubmit} disabled={!online} style={{ padding: "13px", background: online ? "#f97316" : "#2a2c3a", border: "none", borderRadius: 10, color: online ? "#fff" : "#5a5a6a", fontFamily: "inherit", fontSize: 13, fontWeight: 500, letterSpacing: 1.5, cursor: online ? "pointer" : "not-allowed" }}>CADASTRAR VEÍCULO</button>
                </div>
              </div>
            </div>
            <div>
              <SectionTitle icon="🚗">Veículos Cadastrados</SectionTitle>
              {veiculos.length === 0 ? <EmptyState>Nenhum veículo.</EmptyState> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {veiculos.map((v) => (
                    <div key={v.id} className="row-item" style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontFamily: "'Syne',sans-serif", fontWeight: 700, letterSpacing: 1 }}>{v.placa}</div>
                        <div style={{ fontSize: 11, color: "#8a8a9a", marginTop: 2 }}>{v.departamento}{v.modelo ? " · " + v.modelo : ""}{v.ano ? " (" + v.ano + ")" : ""}</div>
                      </div>
                      <button onClick={() => setQrModal({ tipo: "veiculo", item: v })} className="sbtn" style={{ background: "#0e2030", border: "1px solid #38bdf8", borderRadius: 6, color: "#38bdf8", cursor: "pointer", padding: "5px 10px", fontSize: 11, fontFamily: "inherit" }}>QR</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ADMIN */}
        {!loading && activeTab === "admin" && isAdmin && (
          <div className="fade-in">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
              <div>
                <SectionTitle icon="🏪">Estabelecimentos</SectionTitle>
                {estOk && <Alert type="success">✓ Criado!</Alert>}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                  <Field label="NOME"><input type="text" placeholder="Nome do estabelecimento" value={estForm.nome} onChange={(e) => setEstForm((f) => ({ ...f, nome: e.target.value }))} style={iS()} /></Field>
                  <Field label="CNPJ (OPCIONAL)"><input type="text" placeholder="00.000.000/0001-00" value={estForm.cnpj} onChange={(e) => setEstForm((f) => ({ ...f, cnpj: e.target.value }))} style={iS()} /></Field>
                  <Field label="TELEFONE (OPCIONAL)"><input type="text" placeholder="(44) 99999-9999" value={estForm.telefone} onChange={(e) => setEstForm((f) => ({ ...f, telefone: e.target.value }))} style={iS()} /></Field>
                  <button className="sbtn" onClick={handleEstSubmit} style={{ padding: "13px", background: "#f97316", border: "none", borderRadius: 10, color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 500, letterSpacing: 1.5, cursor: "pointer" }}>CRIAR ESTABELECIMENTO</button>
                </div>
                {estabelecimentos.filter(e => e.nome !== "Administrador").length === 0 ? <EmptyState>Nenhum estabelecimento.</EmptyState> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {estabelecimentos.filter(e => e.nome !== "Administrador").map((e) => (
                      <div key={e.id} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 8, padding: "10px 14px" }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>{e.nome}</div>
                        {e.cnpj && <div style={{ fontSize: 11, color: "#8a8a9a", marginTop: 2 }}>{e.cnpj}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <SectionTitle icon="👥">Usuários / Logins</SectionTitle>
                {userOk && <Alert type="success">✓ Usuário criado!</Alert>}
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
                  <Field label="NOME"><input type="text" placeholder="Nome do usuário" value={userForm.nome} onChange={(e) => setUserForm((f) => ({ ...f, nome: e.target.value }))} style={iS()} /></Field>
                  <Field label="E-MAIL"><input type="email" placeholder="email@exemplo.com" value={userForm.email} onChange={(e) => setUserForm((f) => ({ ...f, email: e.target.value }))} style={iS()} /></Field>
                  <Field label="SENHA"><input type="text" placeholder="Senha de acesso" value={userForm.senha} onChange={(e) => setUserForm((f) => ({ ...f, senha: e.target.value }))} style={iS()} /></Field>
                  <Field label="PERFIL">
                    <select value={userForm.perfil} onChange={(e) => setUserForm((f) => ({ ...f, perfil: e.target.value }))} style={iS()}>
                      <option value="estabelecimento">Estabelecimento</option>
                      <option value="admin">Administrador</option>
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
                {usuarios.filter(u => u.perfil !== "admin").length === 0 ? <EmptyState>Nenhum usuário.</EmptyState> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {usuarios.filter(u => u.perfil !== "admin").map((u) => (
                      <div key={u.id} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 8, padding: "10px 14px" }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: "#fff" }}>{u.nome}</div>
                        <div style={{ fontSize: 11, color: "#8a8a9a", marginTop: 2 }}>{u.email} · {u.estabelecimentos?.nome}</div>
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

function Field({ label, error, children }) {
  return (
    <div className="field" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 10, color: error ? "#ef4444" : "#5a5a6a", letterSpacing: 2 }}>{label}</label>
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

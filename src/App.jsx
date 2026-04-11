import { useState, useEffect, useRef, useCallback } from "react";

const COMBUSTIVEIS = ["Gasolina Comum", "Gasolina Aditivada", "Etanol", "Diesel S10", "Diesel S500", "GNV", "Elétrico"];
const now = () => new Date().toISOString().slice(0, 16);
const emptyForm = () => ({ dataHora: now(), combustivel: COMBUSTIVEIS[0], quantidade: "", custo: "", operador: "", hodometro: "" });
const emptyMotorista = () => ({ nome: "", cnh: "", departamento: "" });
const emptyVeiculo = () => ({ placa: "", departamento: "", modelo: "", ano: "" });
const qrUrl = (data) => `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data)}`;
const fmtBRL = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNum = (v, d = 2) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d });

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
      if (!("BarcodeDetector" in window)) { setError("Navegador não suporta QR nativo. Use Chrome/Android ou selecione manualmente."); return; }
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
          <div className="field">
            <select value={manualValue} onChange={onManual} style={{ ...iS(manualError), fontSize: 12 }}>
              <option value="">— Ou selecione manualmente —</option>
              {manualOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {manualError && <span style={{ fontSize: 11, color: "#ef4444", marginTop: 3, display: "block" }}>{manualError}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Comprovante ──────────────────────────────────────
function Comprovante({ registro, onClose }) {
  const handlePrint = () => window.print();
  const handleShare = async () => {
    const texto = `⛽ COMPROVANTE DE ABASTECIMENTO\n` +
      `─────────────────────────\n` +
      `Data: ${registro.dataHora.replace("T", " ")}\n` +
      `Motorista: ${registro.motoristaNome}\n` +
      (registro.motoristaCnh ? `CNH: ${registro.motoristaCnh}\n` : "") +
      `Veículo: ${registro.placa}${registro.modelo ? ` · ${registro.modelo}` : ""}\n` +
      `Departamento: ${registro.departamento}\n` +
      (registro.hodometro ? `Hodômetro: ${fmtNum(registro.hodometro, 0)} km\n` : "") +
      `─────────────────────────\n` +
      `Combustível: ${registro.combustivel}\n` +
      `Quantidade: ${fmtNum(registro.quantidade)} L\n` +
      `Preço/litro: ${fmtBRL(registro.custo / registro.quantidade)}\n` +
      `Total: ${fmtBRL(registro.custo)}\n` +
      `─────────────────────────\n` +
      `Operador: ${registro.operador}`;
    if (navigator.share) {
      await navigator.share({ title: "Comprovante de Abastecimento", text: texto });
    } else {
      await navigator.clipboard.writeText(texto);
      alert("Comprovante copiado para a área de transferência!");
    }
  };

  return (
    <div className="qr-overlay" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 28, maxWidth: 340, width: "90%", color: "#111", fontFamily: "'DM Mono', monospace" }}>
        <style>{`@media print { body * { visibility: hidden; } .comprovante, .comprovante * { visibility: visible; } .comprovante { position: fixed; inset: 0; padding: 20px; } .no-print { display: none !important; } }`}</style>
        <div className="comprovante">
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 28 }}>⛽</div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, letterSpacing: 1, marginTop: 4 }}>COMPROVANTE DE ABASTECIMENTO</div>
          </div>
          <Divider />
          <Row label="Data" value={registro.dataHora.replace("T", " ")} />
          <Row label="Motorista" value={registro.motoristaNome} />
          {registro.motoristaCnh && <Row label="CNH" value={registro.motoristaCnh} />}
          <Row label="Veículo" value={registro.placa} />
          {registro.modelo && <Row label="Modelo" value={registro.modelo} />}
          <Row label="Depto" value={registro.departamento} />
          {registro.hodometro && <Row label="Hodômetro" value={`${fmtNum(registro.hodometro, 0)} km`} />}
          <Divider />
          <Row label="Combustível" value={registro.combustivel} />
          <Row label="Quantidade" value={`${fmtNum(registro.quantidade)} L`} />
          <Row label="Preço/litro" value={fmtBRL(registro.custo / registro.quantidade)} />
          <Row label="Operador" value={registro.operador} />
          <Divider />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>TOTAL</span>
            <span style={{ fontSize: 20, fontFamily: "'Syne', sans-serif", fontWeight: 800 }}>{fmtBRL(registro.custo)}</span>
          </div>
          <Divider />
        </div>
        {/* Botões */}
        <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleShare} style={{ flex: 1, padding: "11px", background: "#f97316", border: "none", borderRadius: 8, color: "#fff", fontFamily: "inherit", fontSize: 12, cursor: "pointer", letterSpacing: 1 }}>📱 COMPARTILHAR</button>
          <button onClick={handlePrint} style={{ flex: 1, padding: "11px", background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 8, color: "#e8e4d9", fontFamily: "inherit", fontSize: 12, cursor: "pointer", letterSpacing: 1 }}>🖨️ IMPRIMIR</button>
        </div>
        <button className="no-print" onClick={onClose} style={{ width: "100%", marginTop: 8, padding: "9px", background: "none", border: "1px solid #ddd", borderRadius: 8, color: "#888", fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>FECHAR</button>
      </div>
    </div>
  );
}

function Divider() { return <div style={{ borderTop: "1px dashed #ccc", margin: "8px 0" }} />; }
function Row({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
      <span style={{ color: "#666" }}>{label}:</span>
      <span style={{ fontWeight: 500, textAlign: "right", maxWidth: "60%" }}>{value}</span>
    </div>
  );
}

// ── Relatórios ───────────────────────────────────────
function Relatorios({ registros }) {
  const [tipo, setTipo] = useState("departamento");
  const [periodo, setPeriodo] = useState("todos");

  const filtrarPeriodo = (regs) => {
    const hoje = new Date();
    if (periodo === "hoje") return regs.filter((r) => r.dataHora.startsWith(hoje.toISOString().slice(0, 10)));
    if (periodo === "mes") return regs.filter((r) => r.dataHora.startsWith(hoje.toISOString().slice(0, 7)));
    return regs;
  };

  const regs = filtrarPeriodo(registros);

  const agrupar = (campo) => {
    const grupos = {};
    regs.forEach((r) => {
      const chave = r[campo] || "—";
      if (!grupos[chave]) grupos[chave] = { litros: 0, custo: 0, count: 0 };
      grupos[chave].litros += r.quantidade;
      grupos[chave].custo += r.custo;
      grupos[chave].count += 1;
    });
    return Object.entries(grupos).sort((a, b) => b[1].custo - a[1].custo);
  };

  const campos = { departamento: "departamento", veiculo: "placa", motorista: "motoristaNome", combustivel: "combustivel" };
  const grupos = agrupar(campos[tipo]);
  const totalCusto = regs.reduce((a, b) => a + b.custo, 0);

  return (
    <div className="fade-in">
      {/* Filtros */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {[["departamento", "🏢 Depto"], ["veiculo", "🚗 Veículo"], ["motorista", "👤 Motorista"], ["combustivel", "⛽ Combustível"]].map(([id, label]) => (
            <button key={id} onClick={() => setTipo(id)} style={{ padding: "8px 14px", background: tipo === id ? "#f97316" : "#1a1c27", border: `1px solid ${tipo === id ? "#f97316" : "#2a2c3a"}`, borderRadius: 8, color: tipo === id ? "#fff" : "#8a8a9a", fontFamily: "inherit", fontSize: 11, cursor: "pointer", letterSpacing: 0.5 }}>{label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {[["todos", "Todos"], ["mes", "Este mês"], ["hoje", "Hoje"]].map(([id, label]) => (
            <button key={id} onClick={() => setPeriodo(id)} style={{ padding: "8px 12px", background: periodo === id ? "#1e3a2a" : "#1a1c27", border: `1px solid ${periodo === id ? "#16a34a" : "#2a2c3a"}`, borderRadius: 8, color: periodo === id ? "#4ade80" : "#8a8a9a", fontFamily: "inherit", fontSize: 11, cursor: "pointer" }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Resumo */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          ["REGISTROS", regs.length, ""],
          ["TOTAL LITROS", fmtNum(regs.reduce((a, b) => a + b.quantidade, 0)), "L"],
          ["TOTAL GASTO", fmtBRL(totalCusto), ""],
        ].map(([label, val, unit]) => (
          <div key={label} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 10, padding: "14px 18px" }}>
            <div style={{ fontSize: 10, color: "#5a5a6a", letterSpacing: 2 }}>{label}</div>
            <div style={{ fontSize: 18, fontFamily: "'Syne',sans-serif", fontWeight: 800, color: "#f97316", marginTop: 4 }}>{val}{unit && <span style={{ fontSize: 12, marginLeft: 3, color: "#8a8a9a" }}>{unit}</span>}</div>
          </div>
        ))}
      </div>

      {/* Grupos */}
      {grupos.length === 0 ? <EmptyState>Nenhum dado para exibir.</EmptyState> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {grupos.map(([chave, dados]) => {
            const pct = totalCusto > 0 ? (dados.custo / totalCusto) * 100 : 0;
            return (
              <div key={chave} style={{ background: "#1a1c27", border: "1px solid #2a2c3a", borderRadius: 10, padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "#fff" }}>{chave}</div>
                    <div style={{ fontSize: 11, color: "#5a5a6a", marginTop: 2 }}>{dados.count} abastecimento{dados.count !== 1 ? "s" : ""} · {fmtNum(dados.litros)} L</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 16, fontFamily: "'Syne',sans-serif", fontWeight: 800, color: "#f97316" }}>{fmtBRL(dados.custo)}</div>
                    <div style={{ fontSize: 11, color: "#5a5a6a" }}>{pct.toFixed(1)}% do total</div>
                  </div>
                </div>
                {/* Barra de progresso */}
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

// ── App principal ────────────────────────────────────
export default function App() {
  const [activeTab, setActiveTab] = useState("registrar");
  const [departamentos, setDepartamentos] = useState([]);
  const [motoristas, setMotoristas] = useState([]);
  const [veiculos, setVeiculos] = useState([]);
  const [registros, setRegistros] = useState([]);

  const [form, setForm] = useState(emptyForm());
  const [formErrors, setFormErrors] = useState({});
  const [comprovante, setComprovante] = useState(null);
  const [scannedMot, setScannedMot] = useState(null);
  const [scannedVeic, setScannedVeic] = useState(null);

  const [motForm, setMotForm] = useState(emptyMotorista());
  const [motErrors, setMotErrors] = useState({});
  const [motOk, setMotOk] = useState(false);
  const [qrModal, setQrModal] = useState(null);

  const [veicForm, setVeicForm] = useState(emptyVeiculo());
  const [veicErrors, setVeicErrors] = useState({});
  const [veicOk, setVeicOk] = useState(false);

  const [novoDpto, setNovoDpto] = useState("");
  const [dptoError, setDptoError] = useState("");
  const [dptoOk, setDptoOk] = useState(false);
  const [search, setSearch] = useState("");

  const [motScanErr, setMotScanErr] = useState("");
  const [veicScanErr, setVeicScanErr] = useState("");

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

  const validateForm = () => {
    const e = {};
    if (!scannedMot && !form.motoristaId) e.motoristaId = "Identifique o motorista";
    if (!scannedVeic && !form.placaId) e.placaId = "Identifique o veículo";
    if (!form.quantidade || isNaN(form.quantidade) || +form.quantidade <= 0) e.quantidade = "Inválido";
    if (!form.custo || isNaN(form.custo) || +form.custo <= 0) e.custo = "Inválido";
    if (!form.operador.trim()) e.operador = "Obrigatório";
    return e;
  };

  const handleRegistrar = () => {
    const e = validateForm();
    if (Object.keys(e).length > 0) { setFormErrors(e); return; }
    const mot = scannedMot || motoristas.find((m) => m.id === Number(form.motoristaId));
    const veic = scannedVeic || veiculos.find((v) => v.id === Number(form.placaId));
    const novo = {
      ...form, id: Date.now(),
      quantidade: parseFloat(form.quantidade), custo: parseFloat(form.custo),
      hodometro: form.hodometro ? parseFloat(form.hodometro) : null,
      motoristaNome: mot?.nome || "", motoristaCnh: mot?.cnh || "",
      placa: veic?.placa || "", departamento: veic?.departamento || mot?.departamento || "",
      modelo: veic?.modelo || "",
    };
    setRegistros((r) => [novo, ...r]);
    setForm(emptyForm()); setScannedMot(null); setScannedVeic(null);
    setComprovante(novo);
  };

  const handleMotSubmit = () => {
    const e = {};
    if (!motForm.nome.trim()) e.nome = "Obrigatório";
    if (!motForm.departamento) e.departamento = "Selecione";
    if (Object.keys(e).length > 0) { setMotErrors(e); return; }
    setMotoristas((m) => [...m, { ...motForm, id: Date.now() }]);
    setMotForm(emptyMotorista()); setMotOk(true); setTimeout(() => setMotOk(false), 2200);
  };

  const handleVeicSubmit = () => {
    const e = {};
    if (!veicForm.placa.trim()) e.placa = "Obrigatório";
    else if (veiculos.some((v) => v.placa.toUpperCase() === veicForm.placa.toUpperCase())) e.placa = "Placa já cadastrada";
    if (!veicForm.departamento) e.departamento = "Selecione";
    if (Object.keys(e).length > 0) { setVeicErrors(e); return; }
    setVeiculos((v) => [...v, { ...veicForm, id: Date.now(), placa: veicForm.placa.toUpperCase() }]);
    setVeicForm(emptyVeiculo()); setVeicOk(true); setTimeout(() => setVeicOk(false), 2200);
  };

  const handleAddDpto = () => {
    if (!novoDpto.trim()) { setDptoError("Informe o nome"); return; }
    if (departamentos.includes(novoDpto.trim())) { setDptoError("Já cadastrado"); return; }
    setDepartamentos((d) => [...d, novoDpto.trim()]);
    setNovoDpto(""); setDptoError(""); setDptoOk(true); setTimeout(() => setDptoOk(false), 2000);
  };

  const exportCSV = () => {
    const h = ["Data/Hora","Motorista","CNH","Placa","Departamento","Modelo","Combustível","Qtd (L)","Hodômetro (km)","Custo (R$)","Operador"];
    const rows = registros.map((r) => [r.dataHora.replace("T"," "),r.motoristaNome,r.motoristaCnh,r.placa,r.departamento,r.modelo,r.combustivel,r.quantidade.toFixed(2),r.hodometro||"",r.custo.toFixed(2),r.operador]);
    const csv = [h,...rows].map((r)=>r.map((c)=>`"${c}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href=url; a.download=`abastecimentos_${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  const filtered = registros.filter((r) =>
    r.placa?.toUpperCase().includes(search.toUpperCase()) ||
    r.motoristaNome?.toLowerCase().includes(search.toLowerCase()) ||
    r.departamento?.toLowerCase().includes(search.toLowerCase())
  );

  const TABS = [["registrar","Registrar"],["registros",`Registros (${registros.length})`],["relatorios","Relatórios"],["motoristas",`Motoristas (${motoristas.length})`],["veiculos",`Veículos (${veiculos.length})`]];

  return (
    <div style={{ minHeight:"100vh", background:"#0f1117", fontFamily:"'DM Mono','Courier New',monospace", color:"#e8e4d9" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        * { box-sizing:border-box; }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0f1117} ::-webkit-scrollbar-thumb{background:#f97316;border-radius:2px}
        input,select{outline:none} input::placeholder{color:#4a4a55}
        .field input:focus,.field select:focus{border-color:#f97316!important}
        .tab-btn{transition:all 0.2s} .tab-btn:hover{color:#f97316}
        .del-btn{opacity:0;transition:opacity 0.2s} .row-item:hover .del-btn{opacity:1}
        .sbtn{transition:all 0.18s} .sbtn:hover:not(:disabled){filter:brightness(1.15);transform:translateY(-1px)}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .fade-in{animation:fadeIn 0.3s ease}
        @keyframes pop{0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)}}
        .pop{animation:pop 0.35s ease}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(249,115,22,0.4)}50%{box-shadow:0 0 0 10px rgba(249,115,22,0)}}
        .qr-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:100;display:flex;align-items:center;justify-content:center;padding:16px}
      `}</style>

      {/* Comprovante Modal */}
      {comprovante && <Comprovante registro={comprovante} onClose={() => setComprovante(null)} />}

      {/* QR Modal */}
      {qrModal && (
        <div className="qr-overlay" onClick={() => setQrModal(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background:"#1a1c27", border:"1px solid #2a2c3a", borderRadius:16, padding:32, textAlign:"center", maxWidth:300 }}>
            <div style={{ fontSize:10, color:"#5a5a6a", letterSpacing:2, marginBottom:8 }}>{qrModal.tipo === "motorista" ? "QR DO MOTORISTA" : "QR DO VEÍCULO"}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:18, color:"#fff", marginBottom:4 }}>{qrModal.tipo === "motorista" ? qrModal.item.nome : qrModal.item.placa}</div>
            <div style={{ fontSize:11, color:"#5a5a6a", marginBottom:20 }}>{qrModal.tipo === "motorista" ? `${qrModal.item.departamento}${qrModal.item.cnh ? ` · CNH ${qrModal.item.cnh}` : ""}` : `${qrModal.item.departamento}${qrModal.item.modelo ? ` · ${qrModal.item.modelo}` : ""}`}</div>
            <img src={qrUrl(JSON.stringify({ id: qrModal.item.id, tipo: qrModal.tipo }))} alt="QR" style={{ width:200, height:200, borderRadius:8, background:"#fff", padding:8 }} />
            <div style={{ fontSize:11, color:"#5a5a6a", marginTop:14 }}>Imprima para o {qrModal.tipo === "motorista" ? "crachá" : "painel do veículo"}</div>
            <button onClick={() => setQrModal(null)} className="sbtn" style={{ marginTop:14, padding:"10px 24px", background:"#f97316", border:"none", borderRadius:8, color:"#fff", fontFamily:"inherit", fontSize:12, letterSpacing:1, cursor:"pointer" }}>FECHAR</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background:"linear-gradient(135deg,#1a1c27 0%,#0f1117 100%)", borderBottom:"1px solid #1e2030", padding:"24px 28px 0" }}>
        <div style={{ maxWidth:900, margin:"0 auto" }}>
          <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:6 }}>
            <div style={{ width:38,height:38,borderRadius:10,background:"#f97316",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20 }}>⛽</div>
            <div>
              <div style={{ fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,letterSpacing:-0.5,color:"#fff" }}>ABASTECIMENTO</div>
              <div style={{ fontSize:11,color:"#5a5a6a",letterSpacing:2,marginTop:-2 }}>CONTROLE DE FROTA</div>
            </div>
          </div>
          <div style={{ display:"flex",gap:0,marginTop:20,overflowX:"auto" }}>
            {TABS.map(([id,label]) => (
              <button key={id} className="tab-btn" onClick={() => setActiveTab(id)} style={{ background:"none",border:"none",cursor:"pointer",padding:"10px 18px",fontSize:12,fontFamily:"inherit",whiteSpace:"nowrap", color:activeTab===id?"#f97316":"#5a5a6a", borderBottom:activeTab===id?"2px solid #f97316":"2px solid transparent", fontWeight:activeTab===id?500:400,letterSpacing:0.5 }}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth:900, margin:"0 auto", padding:"28px 28px" }}>

        {/* ── REGISTRAR ── */}
        {activeTab === "registrar" && (
          <div className="fade-in">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:20 }}>
              <ScanBlock icon="👤" label="IDENTIFICAÇÃO DO MOTORISTA"
                scanned={scannedMot ? { linha1: scannedMot.nome, linha2: `${scannedMot.departamento}${scannedMot.cnh ? ` · CNH ${scannedMot.cnh}` : ""}` } : null}
                onClear={() => { setScannedMot(null); setForm((f) => ({ ...f, motoristaId: "" })); }}
                onStart={startMotScan} onStop={motScanner.stop}
                scanning={motScanner.scanning} scanError={motScanErr || motScanner.error} videoRef={motScanner.videoRef}
                manualOptions={motoristas.map((m) => ({ value: String(m.id), label: `${m.nome} · ${m.departamento}` }))}
                manualValue={form.motoristaId} manualError={formErrors.motoristaId}
                onManual={(e) => { const m = motoristas.find((x) => x.id === Number(e.target.value)); setScannedMot(m||null); setForm((f)=>({...f,motoristaId:e.target.value})); setFormErrors((err)=>({...err,motoristaId:undefined})); }}
              />
              <ScanBlock icon="🚗" label="IDENTIFICAÇÃO DO VEÍCULO" accentColor="#38bdf8"
                scanned={scannedVeic ? { linha1: scannedVeic.placa, linha2: `${scannedVeic.departamento}${scannedVeic.modelo ? ` · ${scannedVeic.modelo}` : ""}` } : null}
                onClear={() => { setScannedVeic(null); setForm((f) => ({ ...f, placaId: "" })); }}
                onStart={startVeicScan} onStop={veicScanner.stop}
                scanning={veicScanner.scanning} scanError={veicScanErr || veicScanner.error} videoRef={veicScanner.videoRef}
                manualOptions={veiculos.map((v) => ({ value: String(v.id), label: `${v.placa}${v.modelo ? ` · ${v.modelo}` : ""} — ${v.departamento}` }))}
                manualValue={form.placaId} manualError={formErrors.placaId}
                onManual={(e) => { const v = veiculos.find((x) => x.id === Number(e.target.value)); setScannedVeic(v||null); setForm((f)=>({...f,placaId:e.target.value})); setFormErrors((err)=>({...err,placaId:undefined})); }}
              />
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <Field label="DATA / HORA"><input type="datetime-local" value={form.dataHora} onChange={(e)=>setForm((f)=>({...f,dataHora:e.target.value}))} style={iS()} /></Field>
              <Field label="TIPO DE COMBUSTÍVEL"><select value={form.combustivel} onChange={(e)=>setForm((f)=>({...f,combustivel:e.target.value}))} style={iS()}>{COMBUSTIVEIS.map((c)=><option key={c}>{c}</option>)}</select></Field>
              <Field label="OPERADOR / POSTO" error={formErrors.operador}>
                <input type="text" placeholder="Nome do operador ou posto" value={form.operador} onChange={(e)=>{setForm((f)=>({...f,operador:e.target.value}));setFormErrors((err)=>({...err,operador:undefined}));}} style={iS(formErrors.operador)} />
              </Field>
              <Field label="HODÔMETRO (KM) — OPCIONAL">
                <input type="number" placeholder="Ex: 45230" min="0" value={form.hodometro} onChange={(e)=>setForm((f)=>({...f,hodometro:e.target.value}))} style={iS()} />
              </Field>
              <Field label="QUANTIDADE (LITROS)" error={formErrors.quantidade}>
                <input type="number" placeholder="0.00" min="0" step="0.01" value={form.quantidade} onChange={(e)=>{setForm((f)=>({...f,quantidade:e.target.value}));setFormErrors((err)=>({...err,quantidade:undefined}));}} style={iS(formErrors.quantidade)} />
              </Field>
              <Field label="CUSTO TOTAL (R$)" error={formErrors.custo}>
                <input type="number" placeholder="0.00" min="0" step="0.01" value={form.custo} onChange={(e)=>{setForm((f)=>({...f,custo:e.target.value}));setFormErrors((err)=>({...err,custo:undefined}));}} style={iS(formErrors.custo)} />
              </Field>
            </div>

            {+form.quantidade > 0 && +form.custo > 0 && (
              <div style={{ marginTop:12, padding:"10px 16px", background:"#1a1c27", borderRadius:8, border:"1px solid #2a2c3a", fontSize:12, color:"#8a8a9a" }}>
                Preço/litro: <strong style={{ color:"#f97316" }}>{fmtBRL(parseFloat(form.custo)/parseFloat(form.quantidade))}</strong>
              </div>
            )}

            <button className="sbtn" onClick={handleRegistrar} style={{ marginTop:18, width:"100%", padding:"15px", background:"#f97316", border:"none", borderRadius:10, color:"#fff", fontFamily:"inherit", fontSize:14, fontWeight:500, letterSpacing:1.5, cursor:"pointer" }}>
              REGISTRAR ABASTECIMENTO
            </button>
          </div>
        )}

        {/* ── REGISTROS ── */}
        {activeTab === "registros" && (
          <div className="fade-in">
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:20 }}>
              {[["REGISTROS",registros.length,""],["TOTAL LITROS",fmtNum(registros.reduce((a,b)=>a+b.quantidade,0)),"L"],["TOTAL GASTO",fmtBRL(registros.reduce((a,b)=>a+b.custo,0)),""]].map(([label,val,unit])=>(
                <div key={label} style={{ background:"#1a1c27",border:"1px solid #2a2c3a",borderRadius:10,padding:"14px 18px" }}>
                  <div style={{ fontSize:10,color:"#5a5a6a",letterSpacing:2 }}>{label}</div>
                  <div style={{ fontSize:18,fontFamily:"'Syne',sans-serif",fontWeight:800,color:"#f97316",marginTop:4 }}>{val}{unit&&<span style={{fontSize:12,marginLeft:3,color:"#8a8a9a"}}>{unit}</span>}</div>
                </div>
              ))}
            </div>
            <div style={{ display:"flex",gap:10,marginBottom:16 }}>
              <input type="text" placeholder="🔍  Buscar motorista, placa, departamento..." value={search} onChange={(e)=>setSearch(e.target.value)} style={{ ...iS(),flex:1,fontSize:13 }} />
              <button onClick={exportCSV} disabled={registros.length===0} className="sbtn" style={{ padding:"10px 18px",background:registros.length===0?"#2a2c3a":"#1a3a2a",border:`1px solid ${registros.length===0?"#2a2c3a":"#16a34a"}`,borderRadius:8,color:registros.length===0?"#4a4a55":"#4ade80",fontFamily:"inherit",fontSize:12,cursor:registros.length===0?"not-allowed":"pointer",letterSpacing:1,whiteSpace:"nowrap" }}>↓ CSV</button>
            </div>
            {filtered.length===0 ? <EmptyState>Nenhum registro ainda.</EmptyState> : (
              <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                {filtered.map((r)=>(
                  <div key={r.id} className="row-item fade-in" style={{ background:"#1a1c27",border:"1px solid #2a2c3a",borderRadius:10,padding:"14px 18px",display:"grid",gridTemplateColumns:"1.4fr 1fr 1fr auto",alignItems:"center",gap:12 }}>
                    <div>
                      <div style={{ fontSize:13,fontWeight:500,color:"#fff" }}>{r.motoristaNome}</div>
                      <div style={{ fontSize:11,color:"#5a5a6a",marginTop:2 }}>{r.dataHora.replace("T"," ")}</div>
                    </div>
                    <div>
                      <div style={{ fontSize:13,fontFamily:"'Syne',sans-serif",fontWeight:700,letterSpacing:1 }}>{r.placa}</div>
                      <div style={{ fontSize:11,color:"#f97316",marginTop:2 }}>{r.combustivel}</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontSize:14,fontWeight:500 }}>{fmtNum(r.quantidade)} L</div>
                      <div style={{ fontSize:12,color:"#4ade80",marginTop:2 }}>{fmtBRL(r.custo)}</div>
                    </div>
                    <div style={{ display:"flex",flexDirection:"column",gap:4 }}>
                      <button onClick={()=>setComprovante(r)} className="sbtn" style={{ background:"#1e2535",border:"1px solid #f97316",borderRadius:6,color:"#f97316",cursor:"pointer",padding:"4px 8px",fontSize:10,fontFamily:"inherit" }}>🧾</button>
                      <button className="del-btn" onClick={()=>setRegistros((r2)=>r2.filter((x)=>x.id!==r.id))} style={delBtn}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── RELATÓRIOS ── */}
        {activeTab === "relatorios" && <Relatorios registros={registros} />}

        {/* ── MOTORISTAS ── */}
        {activeTab === "motoristas" && (
          <div className="fade-in" style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:28,alignItems:"start" }}>
            <div>
              <SectionTitle icon="👤">Cadastrar Motorista</SectionTitle>
              {motOk && <Alert type="success">✓ Motorista cadastrado!</Alert>}
              <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
                <Field label="NOME COMPLETO" error={motErrors.nome}><input type="text" placeholder="Nome do motorista" value={motForm.nome} onChange={(e)=>{setMotForm((f)=>({...f,nome:e.target.value}));setMotErrors((x)=>({...x,nome:undefined}));}} style={iS(motErrors.nome)} /></Field>
                <Field label="DEPARTAMENTO" error={motErrors.departamento}>
                  <select value={motForm.departamento} onChange={(e)=>{setMotForm((f)=>({...f,departamento:e.target.value}));setMotErrors((x)=>({...x,departamento:undefined}));}} style={iS(motErrors.departamento)}>
                    <option value="">— Selecione —</option>
                    {departamentos.map((d)=><option key={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="CNH (OPCIONAL)"><input type="text" placeholder="Número da CNH" value={motForm.cnh} onChange={(e)=>setMotForm((f)=>({...f,cnh:e.target.value}))} style={iS()} /></Field>
                <button className="sbtn" onClick={handleMotSubmit} style={{ padding:"13px",background:"#f97316",border:"none",borderRadius:10,color:"#fff",fontFamily:"inherit",fontSize:13,fontWeight:500,letterSpacing:1.5,cursor:"pointer" }}>CADASTRAR MOTORISTA</button>
              </div>
            </div>
            <div>
              <SectionTitle icon="📋">Motoristas Cadastrados</SectionTitle>
              {motoristas.length===0 ? <EmptyState>Nenhum motorista.</EmptyState> : (
                <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
                  {motoristas.map((m)=>(
                    <div key={m.id} className="row-item" style={{ background:"#1a1c27",border:"1px solid #2a2c3a",borderRadius:10,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <div>
                        <div style={{ fontSize:13,fontWeight:500,color:"#fff" }}>{m.nome}</div>
                        <div style={{ fontSize:11,color:"#8a8a9a",marginTop:2 }}>{m.departamento}{m.cnh?` · CNH ${m.cnh}`:""}</div>
                      </div>
                      <div style={{ display:"flex",gap:6 }}>
                        <button onClick={()=>setQrModal({tipo:"motorista",item:m})} className="sbtn" style={{ background:"#1e2535",border:"1px solid #f97316",borderRadius:6,color:"#f97316",cursor:"pointer",padding:"5px 10px",fontSize:11,fontFamily:"inherit" }}>QR</button>
                        <button className="del-btn" onClick={()=>setMotoristas((p)=>p.filter((x)=>x.id!==m.id))} style={delBtn}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── VEÍCULOS & DEPARTAMENTOS ── */}
        {activeTab === "veiculos" && (
          <div className="fade-in" style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:28,alignItems:"start" }}>
            <div>
              <SectionTitle icon="🏢">Departamentos</SectionTitle>
              {dptoOk && <Alert type="success">✓ Adicionado!</Alert>}
              <div style={{ display:"flex",gap:8,marginBottom:14 }}>
                <div className="field" style={{ flex:1 }}>
                  <input type="text" placeholder="Ex: Logística, TI, Obras..." value={novoDpto} onChange={(e)=>{setNovoDpto(e.target.value);setDptoError("");}} onKeyDown={(e)=>e.key==="Enter"&&handleAddDpto()} style={iS(dptoError)} />
                  {dptoError&&<span style={{fontSize:11,color:"#ef4444",marginTop:4,display:"block"}}>{dptoError}</span>}
                </div>
                <button onClick={handleAddDpto} style={{ padding:"11px 18px",background:"#f97316",border:"none",borderRadius:8,color:"#fff",fontFamily:"inherit",fontSize:18,cursor:"pointer",flexShrink:0 }}>+</button>
              </div>
              {departamentos.length===0?<EmptyState>Nenhum departamento.</EmptyState>:(
                <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                  {departamentos.map((d)=>(
                    <div key={d} className="row-item" style={{ background:"#1a1c27",border:"1px solid #2a2c3a",borderRadius:8,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <span style={{ fontSize:13 }}>🏢 {d}</span>
                      <button className="del-btn" onClick={()=>setDepartamentos((d2)=>d2.filter((x)=>x!==d))} style={delBtn}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <SectionTitle icon="🚗">Cadastrar Veículo</SectionTitle>
              {veicOk && <Alert type="success">✓ Veículo cadastrado!</Alert>}
              <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
                <Field label="PLACA" error={veicErrors.placa}><input type="text" placeholder="ABC-1234" value={veicForm.placa} onChange={(e)=>{setVeicForm((f)=>({...f,placa:e.target.value}));setVeicErrors((x)=>({...x,placa:undefined}));}} maxLength={8} style={{ ...iS(veicErrors.placa),textTransform:"uppercase",letterSpacing:2 }} /></Field>
                <Field label="DEPARTAMENTO" error={veicErrors.departamento}>
                  <select value={veicForm.departamento} onChange={(e)=>{setVeicForm((f)=>({...f,departamento:e.target.value}));setVeicErrors((x)=>({...x,departamento:undefined}));}} style={iS(veicErrors.departamento)}>
                    <option value="">— Selecione —</option>
                    {departamentos.map((d)=><option key={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="MODELO (OPCIONAL)"><input type="text" placeholder="Ex: Fiat Strada" value={veicForm.modelo} onChange={(e)=>setVeicForm((f)=>({...f,modelo:e.target.value}))} style={iS()} /></Field>
                <Field label="ANO (OPCIONAL)"><input type="text" placeholder="2023" maxLength={4} value={veicForm.ano} onChange={(e)=>setVeicForm((f)=>({...f,ano:e.target.value}))} style={iS()} /></Field>
                <button className="sbtn" onClick={handleVeicSubmit} style={{ padding:"13px",background:"#f97316",border:"none",borderRadius:10,color:"#fff",fontFamily:"inherit",fontSize:13,fontWeight:500,letterSpacing:1.5,cursor:"pointer" }}>CADASTRAR VEÍCULO</button>
              </div>
              {veiculos.length>0&&(
                <div style={{ marginTop:20 }}>
                  <div style={{ fontSize:10,color:"#5a5a6a",letterSpacing:2,marginBottom:10 }}>VEÍCULOS CADASTRADOS</div>
                  <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                    {veiculos.map((v)=>(
                      <div key={v.id} className="row-item" style={{ background:"#1a1c27",border:"1px solid #2a2c3a",borderRadius:8,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                        <div>
                          <div style={{ fontSize:13,fontFamily:"'Syne',sans-serif",fontWeight:700,letterSpacing:1 }}>{v.placa}</div>
                          <div style={{ fontSize:11,color:"#8a8a9a",marginTop:2 }}>{v.departamento}{v.modelo?` · ${v.modelo}`:""}{v.ano?` (${v.ano})`:""}</div>
                        </div>
                        <div style={{ display:"flex",gap:6 }}>
                          <button onClick={()=>setQrModal({tipo:"veiculo",item:v})} className="sbtn" style={{ background:"#0e2030",border:"1px solid #38bdf8",borderRadius:6,color:"#38bdf8",cursor:"pointer",padding:"5px 10px",fontSize:11,fontFamily:"inherit" }}>QR</button>
                          <button className="del-btn" onClick={()=>setVeiculos((p)=>p.filter((x)=>x.id!==v.id))} style={delBtn}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div className="field" style={{ display:"flex",flexDirection:"column",gap:6 }}>
      <label style={{ fontSize:10,color:error?"#ef4444":"#5a5a6a",letterSpacing:2 }}>{label}</label>
      {children}
      {error&&<span style={{ fontSize:11,color:"#ef4444" }}>{error}</span>}
    </div>
  );
}
function SectionTitle({ icon, children }) {
  return <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:16 }}><span style={{ fontSize:16 }}>{icon}</span><span style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:14,letterSpacing:1,color:"#fff" }}>{children}</span></div>;
}
function Alert({ type, children }) {
  const c = { success:{bg:"#14532d",border:"#16a34a",color:"#4ade80"}, warn:{bg:"#2d1f0a",border:"#b45309",color:"#fbbf24"} }[type];
  return <div className="pop" style={{ background:c.bg,border:`1px solid ${c.border}`,borderRadius:10,padding:"12px 18px",marginBottom:16,fontSize:13,color:c.color }}>{children}</div>;
}
function EmptyState({ children }) {
  return <div style={{ textAlign:"center",padding:"40px 20px",color:"#3a3a4a",fontSize:13,letterSpacing:1 }}>{children}</div>;
}
const delBtn = { background:"none",border:"1px solid #3a2020",borderRadius:6,color:"#ef4444",cursor:"pointer",padding:"4px 8px",fontSize:12,fontFamily:"inherit" };
function iS(error) {
  return { background:"#1a1c27",border:`1px solid ${error?"#ef4444":"#2a2c3a"}`,borderRadius:8,padding:"11px 14px",color:"#e8e4d9",fontFamily:"'DM Mono',monospace",fontSize:14,width:"100%" };
}

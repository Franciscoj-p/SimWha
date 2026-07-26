import React, { useState, useRef, useEffect } from "react";

// Apunta esto al backend real. En desarrollo con Vite, el proxy redirige /api al backend.
// En producción, se sirve desde la misma URL relativa.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const CHAT_API_KEY = import.meta.env.VITE_CHAT_API_KEY || "";

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const HouseIcon = ({ color }) => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke={color} strokeWidth="1.6">
    <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.5 20v-5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V20" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 16 11" width="15" height="11" fill="none">
    <path d="M1 5.5 4.5 9 10 1.5" stroke="#53BDEB" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.5 5.5 9 9 14.5 1.5" stroke="#53BDEB" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const now = () => {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "p. m." : "a. m.";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
};

// Lo único que el cliente conoce antes de que arranque la conversación
// (vendría de los parámetros UTM/campaña con los que llegó el lead).
const LEAD_INICIAL = {
  proyecto_interes: "Versalles",
  origen: "meta",
};

let uid = 0;
const nextId = () => `m${uid++}`;

export default function AsesorDigital() {
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [quickReplies, setQuickReplies] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [inputEnabled, setInputEnabled] = useState(false);
  const [connectionError, setConnectionError] = useState(false);

  const leadRef = useRef({ ...LEAD_INICIAL });
  const historyRef = useRef([]);
  const scrollRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, quickReplies]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    enviarAlAsesor("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addMessage(sender, content, kind = "text") {
    setMessages((prev) => [...prev, { id: nextId(), sender, content, kind, time: now() }]);
  }

  // Único punto de contacto del cliente con el mundo exterior: nuestro
  // propio backend. El backend es quien habla con Gemini y con el Motor
  // de Perfilamiento; el cliente nunca llama a esas APIs directamente.
  async function enviarAlAsesor(userMessage) {
    setInputEnabled(false);
    setQuickReplies(null);
    if (userMessage) addMessage("user", userMessage);
    setIsTyping(true);
    setConnectionError(false);

    try {
      const headers = { "Content-Type": "application/json" };
      if (CHAT_API_KEY) {
        headers["x-api-key"] = CHAT_API_KEY;
      }
      const res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          history: historyRef.current,
          userMessage: userMessage || "",
          lead: leadRef.current,
        }),
      });
      if (!res.ok) throw new Error(`El backend respondió ${res.status}`);
      const data = await res.json();

      if (userMessage) historyRef.current.push({ role: "user", text: userMessage });
      historyRef.current.push({ role: "bot", text: data.message });
      leadRef.current = data.lead || leadRef.current;

      setIsTyping(false);
      addMessage("bot", data.message);

      if (data.matching_projects && data.matching_projects.length > 0) {
        await sleep(250);
        addMessage("bot", data.matching_projects, "cards");
      }

      if (data.quick_replies && data.quick_replies.length > 0) {
        setQuickReplies(data.quick_replies.map((label) => ({ label })));
      }
      setInputEnabled(true);
    } catch (err) {
      setIsTyping(false);
      setConnectionError(true);
      addMessage(
        "bot",
        "No pude conectarme con el asesor en este momento. Revisa que el backend (server/server.js) esté corriendo y vuelve a intentar."
      );
      setInputEnabled(true);
    }
  }

  function handleQuickReply(qr) {
    enviarAlAsesor(qr.label);
  }

  function handleSend() {
    const text = inputValue.trim();
    if (!text || !inputEnabled) return;
    setInputValue("");
    enviarAlAsesor(text);
  }

  function handleMasInfo(proyecto) {
    enviarAlAsesor(`Quiero más información sobre ${proyecto}.`);
  }

  return (
    <div style={styles.page}>
      <div style={styles.phone}>
        <div style={styles.header}>
          <div style={styles.avatar}>
            <HouseIcon color="#075E54" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={styles.headerName}>Asesor digital · Colsubsidio</div>
            <div style={styles.headerStatus}>
              {connectionError ? "sin conexión" : isTyping ? "escribiendo..." : "en línea"}
            </div>
          </div>
        </div>

        <div ref={scrollRef} style={styles.chatArea}>
          <div style={styles.systemChip}>
            Conversación iniciada · Interés en {LEAD_INICIAL.proyecto_interes}
          </div>

          {messages.map((m) => {
            if (m.kind === "cards") {
              return (
                <div key={m.id} style={styles.cardsWrap}>
                  {m.content.map((p) => (
                    <div key={p.proyecto} style={styles.card}>
                      <div style={styles.cardBanner}>
                        <HouseIcon color="#FFFFFF" />
                      </div>
                      <div style={styles.cardBody}>
                        <div style={styles.cardTitle}>{p.proyecto}</div>
                        <div style={styles.cardSubtitle}>{p.municipio} · {p.tipologia}</div>
                        <div style={styles.cardActions}>
                          <a
                            href={p.brochure_url}
                            target="_blank"
                            rel="noreferrer"
                            style={styles.cardBtnSecondary}
                          >
                            Ver brochure
                          </a>
                          <button style={styles.cardBtnPrimary} onClick={() => handleMasInfo(p.proyecto)}>
                            Más información
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              );
            }
            const isUser = m.sender === "user";
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
                <div style={isUser ? styles.bubbleUser : styles.bubbleBot}>
                  <div>{m.content}</div>
                  <div style={styles.bubbleMeta}>
                    <span>{m.time}</span>
                    {isUser && <CheckIcon />}
                  </div>
                </div>
              </div>
            );
          })}

          {isTyping && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={styles.typingBubble}>
                <span style={{ ...styles.dot, animationDelay: "0ms" }} />
                <span style={{ ...styles.dot, animationDelay: "150ms" }} />
                <span style={{ ...styles.dot, animationDelay: "300ms" }} />
              </div>
            </div>
          )}

          {quickReplies && !isTyping && (
            <div style={styles.chipsRow}>
              {quickReplies.map((qr) => (
                <button key={qr.label} style={styles.chip} onClick={() => handleQuickReply(qr)}>
                  {qr.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={styles.inputBar}>
          <input
            style={styles.input}
            placeholder="Escribe un mensaje"
            value={inputValue}
            disabled={!inputEnabled}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <button
            style={{ ...styles.sendBtn, opacity: inputEnabled ? 1 : 0.4 }}
            disabled={!inputEnabled}
            onClick={handleSend}
            aria-label="Enviar"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#FFFFFF">
              <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: .5; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  page: {
    display: "flex",
    justifyContent: "center",
    padding: "24px 12px",
    background: "transparent",
    fontFamily: "'Segoe UI', Helvetica, Arial, sans-serif",
  },
  phone: {
    width: 380,
    height: 700,
    background: "#E5DDD5",
    borderRadius: 16,
    boxShadow: "0 6px 24px rgba(0,0,0,0.18)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    border: "1px solid #d8d0c6",
  },
  header: {
    background: "#075E54",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: "50%",
    background: "#DCF8C6",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  headerName: { fontSize: 14.5, fontWeight: 600 },
  headerStatus: { fontSize: 12, color: "#D9F5EE" },
  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "14px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  systemChip: {
    alignSelf: "center",
    background: "#FCF3CF",
    color: "#6b5b1e",
    fontSize: 11.5,
    padding: "5px 10px",
    borderRadius: 8,
    marginBottom: 8,
    textAlign: "center",
  },
  bubbleUser: {
    background: "#DCF8C6",
    color: "#111B21",
    padding: "7px 9px 6px 9px",
    borderRadius: "8px 0 8px 8px",
    maxWidth: 260,
    fontSize: 14,
    lineHeight: 1.35,
    margin: "2px 4px",
  },
  bubbleBot: {
    background: "#FFFFFF",
    color: "#111B21",
    padding: "7px 9px 6px 9px",
    borderRadius: "0 8px 8px 8px",
    maxWidth: 270,
    fontSize: 14,
    lineHeight: 1.35,
    margin: "2px 4px",
    boxShadow: "0 1px 1px rgba(0,0,0,0.08)",
  },
  bubbleMeta: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 4,
    fontSize: 10.5,
    color: "#8696a0",
    marginTop: 2,
  },
  typingBubble: {
    background: "#FFFFFF",
    borderRadius: "0 8px 8px 8px",
    padding: "10px 12px",
    margin: "2px 4px",
    display: "flex",
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#9aa5ab",
    display: "inline-block",
    animation: "bounce 1.2s infinite",
  },
  chipsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    padding: "6px 4px 4px",
  },
  chip: {
    background: "#FFFFFF",
    border: "1px solid #075E54",
    color: "#075E54",
    borderRadius: 18,
    padding: "7px 14px",
    fontSize: 13,
    cursor: "pointer",
  },
  cardsWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    margin: "4px 4px",
  },
  card: {
    background: "#FFFFFF",
    borderRadius: 10,
    overflow: "hidden",
    boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
    maxWidth: 280,
  },
  cardBanner: {
    background: "#128C7E",
    height: 60,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { padding: "10px 12px 12px" },
  cardTitle: { fontSize: 15, fontWeight: 600, color: "#111B21" },
  cardSubtitle: { fontSize: 12.5, color: "#667781", marginTop: 2, marginBottom: 10 },
  cardActions: { display: "flex", gap: 8 },
  cardBtnSecondary: {
    flex: 1,
    background: "#FFFFFF",
    border: "1px solid #075E54",
    color: "#075E54",
    borderRadius: 6,
    padding: "6px 4px",
    fontSize: 12.5,
    cursor: "pointer",
    textAlign: "center",
    textDecoration: "none",
    display: "inline-block",
  },
  cardBtnPrimary: {
    flex: 1,
    background: "#25D366",
    border: "none",
    color: "#053b2e",
    fontWeight: 600,
    borderRadius: 6,
    padding: "6px 4px",
    fontSize: 12.5,
    cursor: "pointer",
  },
  inputBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    background: "#F0F0F0",
    borderTop: "1px solid #ddd",
  },
  input: {
    flex: 1,
    border: "none",
    outline: "none",
    borderRadius: 20,
    padding: "9px 14px",
    fontSize: 14,
    background: "#FFFFFF",
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: "#075E54",
    border: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
};

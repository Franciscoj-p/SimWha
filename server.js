import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();

// Variables de entorno con valores por defecto
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-2.5-flash").replace(/^models\//, "");
const MOTOR_API_URL = (process.env.MOTOR_API_URL || "http://localhost:8000").replace(/\/$/, "");
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const CHAT_API_KEY = process.env.CHAT_API_KEY || "";
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "30", 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);

// Configuración de CORS dinámica
app.use(
  cors({
    origin: ALLOWED_ORIGIN === "*" ? "*" : ALLOWED_ORIGIN.split(",").map((o) => o.trim()),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
  })
);

app.use(express.json({ limit: "1mb" }));

// Servir la interfaz web compilada por Vite (carpeta dist)
app.use(express.static("dist"));

if (!GEMINI_API_KEY) {
  console.warn("⚠️ [asesor-digital] GEMINI_API_KEY no configurada. Configura el archivo .env para procesar mensajes.");
}

// -----------------------------------------------------------------------
// Rate Limiter ligero en memoria (sin dependencias adicionales)
// Protege la API Key de Gemini contra consumo excesivo o abusos.
// -----------------------------------------------------------------------
const ipMap = new Map();
function rateLimiter(req, res, next) {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const record = ipMap.get(ip) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_LIMIT_WINDOW_MS;
  } else {
    record.count += 1;
  }
  ipMap.set(ip, record);

  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: true,
      message: "Demasiadas peticiones. Por favor espera un momento antes de enviar más mensajes.",
    });
  }
  next();
}

// Middleware opcional de autenticación con API Key interna para el chat
function authGuard(req, res, next) {
  if (!CHAT_API_KEY) return next(); // Si no hay clave configurada en .env, permite el acceso (modo hackathon)
  const clientKey = req.headers["x-api-key"] || req.headers["authorization"]?.replace(/^Bearer\s+/i, "");
  if (clientKey !== CHAT_API_KEY) {
    return res.status(401).json({ error: true, message: "No autorizado. API key no válida." });
  }
  next();
}

// -----------------------------------------------------------------------
// Herramientas para Gemini (Function Calling)
// -----------------------------------------------------------------------
const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "consultar_afiliado",
        description:
          "Consulta si la persona es afiliada a Colsubsidio y trae sus datos precargados (ingresos, edad, personas a cargo, etc). Úsala apenas el usuario te dé su número de cédula, para no volver a preguntar información que Colsubsidio ya tiene.",
        parameters: {
          type: "object",
          properties: {
            id_usuario: { type: "string", description: "Número de cédula o documento del usuario" },
          },
          required: ["id_usuario"],
        },
      },
      {
        name: "enviar_lead_a_motor",
        description:
          "Envía el Lead ya completo al Motor de Perfilamiento para obtener la evaluación financiera y los proyectos recomendados. Solo llámala cuando ya tengas todos los campos obligatorios del lead (afiliado, antiguedad_meses si aplica, ingresos_mensuales, propietario_vivienda, subsidio_previo) y suficiente contexto conversacional (intención, zona preferida, presupuesto). Nunca inventes valores que el usuario no te haya dado.",
        parameters: {
          type: "object",
          properties: {
            lead: {
              type: "object",
              description: "Objeto Lead completo, siguiendo exactamente el esquema de entrada de POST /perfilar.",
            },
          },
          required: ["lead"],
        },
      },
    ],
  },
];

function buildSystemInstruction(leadConocido) {
  return `Eres un asesor digital de vivienda de Colsubsidio. Conversas de manera empática pero profesional por chat estilo WhatsApp con un lead.
Tu misión es perfilar al usuario y estructurar los datos del Lead para invocar "enviar_lead_a_motor".

Estructura completa del objeto Lead que debes armar y enviar en "enviar_lead_a_motor":
{
  "id_usuario": "string (cédula)",
  "nombre": "string (nombre completo)",
  "afiliado": true/false,
  "categoria": "string (A, B, B, C o null)",
  "antiguedad_meses": 0, (meses continuos o discontinuos de afiliación)
  "tipo_cotizante": "dependiente" | "independiente" | "pensionado",
  "ingresos_mensuales": 0, (ingresos del hogar en COP)
  "grupo_sisben": "string (ej: A1, C2, etc) o null",
  "edad": 0,
  "personas_a_cargo": 0,
  "condiciones_especiales": {
    "cabeza_de_hogar": true/false/null,
    "discapacidad_hogar": true/false/null,
    "mayor_65_anos": true/false/null
  },
  "propietario_vivienda": true/false,
  "subsidio_previo": true/false,
  "subsidio_previo_fue_arrendamiento": true/false,
  "finanzas": {
    "cesantias": 0, (ahorro acumulado en cesantías en COP)
    "ahorros": 0, (ahorros voluntarios disponibles en COP)
    "credito_preaprobado": true/false (si tiene carta de preaprobación hipotecaria)
  },
  "tipo_empresa": "string o null",
  "zona": "urbana" | "rural" | null,
  "zona_preferida": "string (municipio de interés)",
  "proyecto_interes": "string",
  "valor_vivienda_deseada": 0, (presupuesto estimado de vivienda en COP)
  "origen": "string"
}

Reglas del Flujo Conversacional:
1. Ve paso a paso. Haz UNA sola pregunta por turno de forma natural y conversacional. No abrumes al usuario con listas de preguntas.
2. Si el usuario te da su cédula, invoca de inmediato la función "consultar_afiliado".
3. Evita preguntar información que ya conozcas por la consulta o que ya esté cargada en "Lead conocido hasta ahora".
4. Pregunta proactivamente por los datos que NO se obtienen de la afiliación pero son vitales para perfilar:
   - Ahorros voluntarios disponibles (finanzas.ahorros) y Cesantías acumuladas (finanzas.cesantias) de forma DIFERENCIADA. Son conceptos y campos totalmente distintos; no los mezcles ni los asumas iguales.
   - Si tiene crédito hipotecario preaprobado (finanzas.credito_preaprobado).
   - Presupuesto aproximado para su vivienda (valor_vivienda_deseada).
   - Si tiene subsidio previo o es propietario de vivienda.
5. NO asumas valores por defecto para condiciones_especiales (como cabeza_de_hogar o discapacidad_hogar o si vive con una persona mayor de 65 años "mayor_65_anos"). Si la consulta de afiliados no los trae, pregúntalos antes de llamar al motor o mándalos como null.
6. Cuando tengas todos los campos financieros y de contexto necesarios, llama a "enviar_lead_a_motor".
7. Regla de Sinceridad para No Viabilidad:
   - Si el resultado del motor retorna viable=false: Sé completamente directo y sincero. Dile con empatía que en este momento no califica para el perfilamiento y por lo tanto NO se le contactará telefónicamente.
   - A continuación, enfoca tus consejos en cómo mejorar su salud y perfil financiero para que en un futuro pueda aplicar y calificar (ej. trazar plan de ahorro mensual voluntario, incrementar cesantías, reducir deudas actuales, o buscar una carta de preaprobado).
   - Si el resultado del motor retorna viable=true: Felicitas al usuario e infórmale que un asesor comercial se pondrá en contacto pronto para continuar con el proceso.
8. Una vez dada la respuesta final del motor (viable o no viable) y los consejos correspondientes, despídete de forma atenta y da por finalizada la conversación, sin volver a realizar preguntas ni llamar al motor.

Lead conocido hasta ahora: ${JSON.stringify(leadConocido)}

Formato de respuesta obligatorio cuando NO estés llamando una función (JSON estricto):
{
  "message": "mensaje conversacional",
  "quick_replies": ["opción 1", "opción 2"] o null,
  "lead_updates": { } con los nuevos campos deducidos para actualizar el lead (ej. { "finanzas": { "ahorros": 5000000 }, "propietario_vivienda": false })
}`;
}

function toContents(history) {
  return history.map((turn) => ({
    role: turn.role === "bot" ? "model" : "user",
    parts: [{ text: turn.text }],
  }));
}

async function callGemini(contents, systemText) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY no está configurada en las variables de entorno del servidor.");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: systemText }] },
    contents,
    tools: TOOLS,
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Gemini respondió ${r.status}: ${errText}`);
  }
  return r.json();
}

function extractFunctionCall(geminiResponse) {
  const parts = geminiResponse?.candidates?.[0]?.content?.parts || [];
  return parts.find((p) => p.functionCall)?.functionCall || null;
}

function extractText(geminiResponse) {
  const parts = geminiResponse?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text).filter(Boolean).join("\n");
}

function sanitizarRespuestaMotor(motorJson) {
  return {
    viable: motorJson?.financial_score?.viable === "SI",
    evaluacion_proyecto_interes: motorJson?.evaluacion_proyecto_interes || null,
    matching_projects: (motorJson?.matching_projects || []).map((p) => ({
      proyecto: p.proyecto,
      municipio: p.municipio,
      tipologia: p.tipologia,
      brochure_url: p.brochure_url,
    })),
  };
}

async function ejecutarHerramienta(name, args) {
  try {
    if (name === "consultar_afiliado") {
      const r = await fetch(`${MOTOR_API_URL}/afiliados/${encodeURIComponent(args.id_usuario)}`);
      if (!r.ok) return { afiliado: false, datos: null, error: `Status ${r.status}` };
      return await r.json();
    }
    if (name === "enviar_lead_a_motor") {
      const r = await fetch(`${MOTOR_API_URL}/perfilar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.lead),
      });
      if (!r.ok) {
        const errorText = await r.text();
        console.error(`\n❌ [ERROR MOTOR]: El motor devolvió código ${r.status}. Detalle del error:`, errorText);
        return { viable: false, error: `Motor respondió ${r.status}`, details: errorText };
      }
      const motorJson = await r.json();

      console.log(`\n🔍 [DETALLE] Respuesta completa y cruda del motor:`, JSON.stringify(motorJson, null, 2));

      return sanitizarRespuestaMotor(motorJson);
    }
  } catch (err) {
    console.error(`[asesor-digital] Error al llamar herramienta ${name}:`, err.message);
    if (name === "consultar_afiliado") {
      return { afiliado: false, datos: null, error: "No se pudo conectar con el servicio de afiliados" };
    }
    return { viable: false, matching_projects: [], error: "No se pudo conectar con el motor de perfilamiento" };
  }
  throw new Error(`Herramienta desconocida: ${name}`);
}

function parsearRespuestaFinal(text) {
  if (!text) {
    return { message: "Cuéntame un poco más.", quick_replies: null, lead_updates: {} };
  }
  try {
    const limpio = text.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(limpio);
    return {
      message: parsed.message || "Cuéntame un poco más.",
      quick_replies: parsed.quick_replies || null,
      lead_updates: parsed.lead_updates || {},
    };
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          message: parsed.message || text,
          quick_replies: parsed.quick_replies || null,
          lead_updates: parsed.lead_updates || {},
        };
      } catch {}
    }
    return { message: text, quick_replies: null, lead_updates: {} };
  }
}

app.post("/api/chat", rateLimiter, authGuard, async (req, res) => {
  const { history = [], userMessage = "", lead = {} } = req.body;

  console.log("\n================ 📥 NUEVA PETICIÓN DE CHAT ================");
  console.log(`💬 Mensaje usuario: "${userMessage || "(inicio de chat)"}"`);
  console.log(`📋 Lead conocido hasta ahora:`, JSON.stringify(lead, null, 2));

  try {
    const contents = toContents(history);
    if (userMessage) contents.push({ role: "user", parts: [{ text: userMessage }] });

    // Si no hay mensajes (inicio del chat), enviar un mensaje de saludo inicial para despertar al modelo
    if (contents.length === 0) {
      contents.push({ role: "user", parts: [{ text: "Hola" }] });
    }

    const systemText = buildSystemInstruction(lead);
    let leadActualizado = { ...lead };
    let matchingProjects = null;
    let viable = null;

    let response = await callGemini(contents, systemText);
    let iteraciones = 0;

    while (iteraciones < 4) {
      const call = extractFunctionCall(response);
      if (!call) break;
      iteraciones += 1;

      console.log(`\n⚙️  [Gemini invoca herramienta]: "${call.name}"`);
      console.log(`   👉 Argumentos:`, JSON.stringify(call.args, null, 2));

      const resultado = await ejecutarHerramienta(call.name, call.args);

      console.log(`   👈 Resultado de la herramienta:`, JSON.stringify(resultado, null, 2));

      if (call.name === "consultar_afiliado" && resultado.afiliado) {
        leadActualizado = { ...leadActualizado, afiliado: true, ...resultado.datos };
        console.log(`   ✅ Lead enriquecido con datos del afiliado.`);
      }
      if (call.name === "enviar_lead_a_motor") {
        viable = resultado.viable ?? null;
        // Si la persona no es viable, NO enviamos los proyectos recomendados
        matchingProjects = viable ? (resultado.matching_projects || null) : null;
        leadActualizado = { ...leadActualizado, ...call.args.lead };
        console.log(`   🚀 Motor de perfilamiento evaluó viabilidad: ${viable}`);
      }

      const originalParts = response?.candidates?.[0]?.content?.parts || [{ functionCall: call }];
      contents.push({ role: "model", parts: originalParts });
      contents.push({
        role: "user",
        parts: [{ functionResponse: { name: call.name, response: resultado } }],
      });

      response = await callGemini(contents, buildSystemInstruction(leadActualizado));
    }

    const texto = extractText(response);
    const final = parsearRespuestaFinal(texto);
    leadActualizado = { ...leadActualizado, ...final.lead_updates };

    console.log("\n================ 📤 RESPUESTA ENVIADA ================");
    console.log(`🤖 Texto devuelto: "${final.message}"`);
    if (final.quick_replies) {
      console.log(`⚡ Respuestas rápidas:`, final.quick_replies);
    }
    console.log(`📋 Lead final:`, JSON.stringify(leadActualizado, null, 2));
    if (matchingProjects) {
      console.log(`🏢 Proyectos recomendados:`, matchingProjects.map((p) => p.proyecto).join(", "));
    }
    console.log("====================================================\n");

    res.json({
      message: final.message,
      quick_replies: final.quick_replies,
      lead: leadActualizado,
      matching_projects: matchingProjects,
      viable,
    });
  } catch (err) {
    console.error("\n❌ [asesor-digital] Error en /api/chat:", err.message);
    res.status(500).json({
      message: "Tuvimos un problema para procesar tu mensaje. Revisa las configuraciones del servidor o intenta de nuevo.",
      quick_replies: null,
      lead,
      matching_projects: null,
      viable: null,
      error: true,
      details: err.message,
    });
  }
});

app.get("/api/health", (_req, res) => res.json({ status: "ok", model: GEMINI_MODEL }));

app.listen(PORT, () => {
  console.log(`🚀 [asesor-digital] Backend escuchando en http://localhost:${PORT}`);
});

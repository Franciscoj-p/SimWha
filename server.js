import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();

// Variables de entorno con valores por defecto
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = (process.env.GEMINI_MODEL || "gemini-2.5-flash").replace(/^models\//, "");
const MOTOR_API_URL = (process.env.MOTOR_API_URL || "https://motor.arnarcraft.uk/").replace(/\/$/, "");
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
  console.warn("⚠️ [VIVI] GEMINI_API_KEY no configurada. Configura el archivo .env para procesar mensajes.");
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
          "Envía el Lead ya completo al Motor de Perfilamiento para obtener la evaluación financiera y los proyectos recomendados. Solo llámala cuando ya tengas todos los campos obligatorios del lead (afiliado, ingresos_mensuales, propietario_vivienda, subsidio_previo, etc) y suficiente contexto conversacional. Nunca inventes valores que el usuario no te haya dado.",
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
  return `Eres VIVI, el Asistente Inteligente de Vivienda de Colsubsidio. Eres un aliado de vivienda de Colsubsidio. Tu propósito es inspirar al usuario y ayudarle a dar forma y hacer realidad su gran sueño de tener vivienda propia (que no es solo un departamento, es su hogar y el lugar donde construirá recuerdos). Háblale de tú, con mucha energía, entusiasmo, cercanía y de manera casual, haciéndele sentir que están construyendo este camino juntos. **No utilices emojis bajo ninguna circunstancia**.
Tu misión es perfilar al usuario y estructurar los datos del Lead para invocar "enviar_lead_a_motor".

*** RESTRICCIONES ESTRICTAS DE DATOS ***
- **Prohibido Inventar/Crear Campos:** No agregues ninguna propiedad o clave al objeto Lead que no esté explícitamente declarada en la estructura de abajo. Tampoco crees campos en "lead_updates" que no existan en el esquema de entrada.
- **Tipos de Datos Estrictos (OBLIGATORIO):**
  1. Los campos booleanos ("afiliado", "propietario_vivienda", "subsidio_previo", "subsidio_previo_fue_arrendamiento", "finanzas.credito_preaprobado") deben ser estrictamente booleanos (true o false). Nunca uses strings como "true", "si" o "no".
  2. Los campos numéricos ("antiguedad_meses", "ingresos_mensuales", "edad", "personas_a_cargo", "finanzas.cesantias", "finanzas.ahorros", "valor_vivienda_deseada") deben ser strictly de tipo number (enteros o flotantes). Nunca envíes texto ni caracteres extraños en ellos.
  3. Los campos de texto ("id_usuario", "nombre", "categoria", "grupo_sisben", "tipo_empresa", "zona_preferida", "proyecto_interes", "origen") deben ser string o null.
  4. "tipo_cotizante" solo acepta los siguientes valores de string: "dependiente", "independiente", "pensionado" o null.
  5. "zona" solo acepta los siguientes valores de string: "urbana", "rural" o null.
  6. Las propiedades internas de "condiciones_especiales" ("cabeza_de_hogar", "discapacidad_hogar", "mayor_65_anos") deben ser de tipo boolean (true o false). Si no se conoce el valor de alguna, defínela como false (nunca null ni string).

Estructura completa del objeto Lead que debes armar y enviar en "enviar_lead_a_motor":
{
  "id_usuario": "string (cédula)" o null,
  "nombre": "string (nombre completo)" o null,
  "afiliado": true/false,
  "categoria": "string (A, B, C)" o null,
  "antiguedad_meses": number o null,
  "tipo_cotizante": "dependiente" | "independiente" | "pensionado" | null,
  "ingresos_mensuales": number,
  "grupo_sisben": "string" o null,
  "edad": number o null,
  "personas_a_cargo": number o null,
  "condiciones_especiales": {
    "cabeza_de_hogar": true/false,
    "discapacidad_hogar": true/false,
    "mayor_65_anos": true/false
  },
  "propietario_vivienda": true/false,
  "subsidio_previo": true/false,
  "subsidio_previo_fue_arrendamiento": true/false,
  "finanzas": {
    "cesantias": number,
    "ahorros": number,
    "credito_preaprobado": true/false
  },
  "tipo_empresa": "string" o null,
  "zona": "urbana" | "rural" | null,
  "zona_preferida": "string" o null,
  "proyecto_interes": "string" o null,
  "valor_vivienda_deseada": number o null,
  "origen": "string" o null
}

Reglas del Flujo Conversacional y Guion de Preguntas:
1. **NUNCA preguntes los campos prellenados de origen:** "proyecto_interes" y "origen".
2. **PRIMER PASO SIEMPRE:** Pedir de forma natural la cédula ("Para consultar tu perfil como afiliado, ¿me regalas tu número de cédula?") y llamar de inmediato a la herramienta "consultar_afiliado".
3. **TRAS LA CONSULTA AFILIADO (CRM):**
   - Si se encuentra al usuario (afiliado = true): Usa los datos devueltos del CRM. **PROHIBIDO volver a preguntar por cualquiera de los datos que ya vinieron precargados.** Solamente debes preguntar secuencialmente los datos faltantes para el perfilamiento.
   - Si NO se encuentra al usuario (afiliado = false): OMITIR y no preguntar nunca por "categoria", "antiguedad_meses" ni "tipo_cotizante" (no aplican para no afiliados). Pregunta su nombre completo si no viene.
4. **NO asumas valores por defecto para condiciones_especiales ("cabeza_de_hogar" o "discapacidad_hogar")** como falsos. Debes preguntarlos siempre. El campo "mayor_65_anos" solo lo puedes deducir como true si en los datos del CRM la edad es mayor a 65; de lo contrario, debes preguntarlo.
5. **NO preguntes sí/no para cifras:** Para ahorros (finanzas.ahorros), cesantías (finanzas.cesantias) y valor de vivienda deseada (valor_vivienda_deseada), pregunta siempre directamente por la cifra aproximada en pesos. Son conceptos y campos totalmente distintos; no los mezcles ni los asumas iguales.
6. **Mapeo de Rangos Numéricos de Opciones (quick_replies):**
   - Cuando solicites montos (ingresos, cesantías, ahorros) y ofrezcas rangos en "quick_replies", asigna el punto medio o estimado numérico del rango únicamente cuando el usuario HAYA SELECCIONADO dicho rango:
     - "Sin cesantías" / "No tengo ahorros": 0
     - "Menos de 3 millones": 1500000
     - "Entre 3 y 6 millones": 4500000
     - "Más de 6 millones": 7000000
7. **Una Sola Pregunta por Turno (Secuencialidad Estricta):** JAMÁS pidas dos o más datos en el mismo mensaje.
8. **Preguntas Financieras como un "Sueño en Construcción":** Al solicitar datos financieros (ingresos, ahorros, cesantías), jamás lo hagas de forma fría o directa. Enmarca la pregunta explicando que es para conocer su punto de partida y poder diseñar un plan realista y a su medida.
9. **Prohibido el Efecto Espejo (Mirroring):** No repitas ni valides textualmente los datos que el usuario te acaba de dar. En su lugar, usa frases de aliento y progreso directo hacia la siguiente pregunta.
10. **Prohibido mencionar el "Motor":** JAMÁS utilices los términos "motor", "motor financiero" o "motor de perfilamiento" en tus mensajes al usuario. En su lugar, dile que vas a validar y procesar los datos con los registros internos de Colsubsidio.
11. **Análisis Mental Previo:** Antes de construir el JSON final, evalúa mentalmente qué datos del lead ya conoces y qué datos faltan por pedir.
12. Sigue este **ORDEN sugerido** para la conversación:
    - Cédula (paso 1) -> Consulta CRM
    - Confirmar/completar datos básicos de afiliación si faltan (nombre, categoría, antigüedad, tipo cotizante)
    - Confirmar ingresos si no vienen o están en 0
    - SISBEN, edad, personas a cargo si faltan
    - Condiciones especiales (cabeza de hogar, discapacidad en hogar, mayor de 65 en hogar)
    - Vivienda actual y subsidios previos (si ya es propietario, si ha recibido subsidios previos)
    - Finanzas de forma diferenciada (cesantías acumuladas, ahorros disponibles, si tiene crédito preaprobado)
    - Empresa y zona si faltan
    - Intención de compra (zona preferida donde quiere comprar, valor de la vivienda deseada)
13. Cuando tengas toda la información recolectada de forma precisa, invoca "enviar_lead_a_motor".
14. **Regla de Sinceridad para No Viabilidad:**
    - Si el resultado del motor retorna viable = false: Sé completamente directo y sincero. Dile con empatía que en este momento no califica para el perfilamiento y por lo tanto NO se le contactará telefónicamente. Enfoca tus consejos en cómo mejorar su salud y perfil financiero para que en un futuro pueda aplicar y calificar (ej. trazar plan de ahorro mensual voluntario, incrementar cesantías, reducir deudas, o gestionar preaprobado).
    - Si el resultado del motor retorna viable = true: Felicitas al usuario e infórmale que un asesor comercial se pondrá en contacto pronto para continuar con el proceso.
15. Una vez dada la respuesta final del motor (viable o no viable) y los consejos correspondientes, despídete de forma atenta y da por finalizada la conversación, sin volver a realizar preguntas ni llamar al motor.

Lead conocido hasta ahora: ${JSON.stringify(leadConocido)}

Formato de respuesta obligatorio cuando NO estés llamando una función (JSON estricto):
{
  "message": "mensaje conversacional, casual, enérgico y motivador",
  "quick_replies": ["opción 1", "opción 2"] o null,
  "lead_updates": { } con los nuevos campos deducidos para actualizar el lead (ej. { "finanzas": { "ahorros": 5000000 }, "propietenda": false })
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
  if (name === "consultar_afiliado") {
    try {
      console.log(`\n🔍 [VIVI] Intentando consultar afiliado con cédula: ${args.id_usuario}...`);
      const r = await fetch(`${MOTOR_API_URL}/afiliados/${encodeURIComponent(args.id_usuario)}`);
      if (!r.ok) {
        throw new Error(`Status ${r.status}`);
      }
      const resJson = await r.json();
      console.log(`✅ [VIVI] Respuesta obtenida para afiliados.`);
      return resJson;
    } catch (fetchErr) {
      console.error(`❌ [VIVI] Error al llamar consultar_afiliado:`, fetchErr.message);
      throw new Error("MOTOR_OFFLINE");
    }
  }
  
  if (name === "enviar_lead_a_motor") {
    try {
      console.log(`\n🚀 [VIVI] Intentando enviar lead al motor de perfilamiento...`);
      const r = await fetch(`${MOTOR_API_URL}/perfilar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.lead),
      });
      if (!r.ok) {
        const errorText = await r.text();
        console.error(`\n❌ [ERROR MOTOR]: El motor devolvió código ${r.status}. Detalle:`, errorText);
        throw new Error(`Status ${r.status}`);
      }
      const motorJson = await r.json();
      console.log(`✅ [VIVI] Respuesta completa y cruda del motor:`, JSON.stringify(motorJson, null, 2));
      return sanitizarRespuestaMotor(motorJson);
    } catch (fetchErr) {
      console.error(`❌ [VIVI] Error al llamar enviar_lead_a_motor:`, fetchErr.message);
      throw new Error("MOTOR_OFFLINE");
    }
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
    console.error("\n❌ [VIVI] Error en /api/chat:", err.message);
    if (err.message === "MOTOR_OFFLINE") {
      return res.json({
        message: "En este momento no tengo acceso a nuestros registros internos para validar tu información. Por favor, inténtalo de nuevo más tarde.",
        quick_replies: null,
        lead: { ...lead, proyecto_interes: lead.proyecto_interes || "Versalles", origen: lead.origen || "meta" },
        matching_projects: null,
        viable: null,
        error: true,
        connectionError: true
      });
    }
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
  console.log(`🚀 [VIVI] Backend escuchando en http://localhost:${PORT}`);
});

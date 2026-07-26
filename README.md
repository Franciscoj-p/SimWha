# VIVI — Asistente Inteligente de Vivienda (Plataforma VIVI)

Este repositorio contiene el componente conversacional de la **Plataforma VIVI**, un ecosistema inteligente diseñado para transformar la gestión de prospectos en programas de vivienda, automatizando el proceso desde el primer contacto hasta la asignación de un asesor comercial.

Este módulo implementa el **Asistente Inteligente de Vivienda (VIVI)** en su modalidad de **Interfaz Conversacional** (apto para canales como WhatsApp, portales web o aplicaciones móviles), comunicándose con el **Motor Inteligente de Decisión** y el **CRM**.

---

## 🛠️ Arquitectura de la Solución

VIVI está construida con una arquitectura desacoplada para garantizar que toda la inteligencia del negocio resida de forma independiente de la interfaz de usuario. Sus componentes principales son:

1. **VIVI — Interfaz Conversacional (Frontend en React/Vite):**
   - Una interfaz amigable estilo WhatsApp en la que el usuario es guiado a través de un diálogo natural y personalizado.
2. **Backend de Orquestación (Express + Gemini):**
   - Orquesta la conversación utilizando **Google Gemini** con *Function Calling*.
   - Consulta bases de datos de afiliados (CRM) y delega la viabilidad financiera al Motor de Decisión.
3. **Motor Inteligente de Decisión (Externo en `MOTOR_API_URL`):**
   - Valida identidad, analiza ingresos base, estima el nivel de elegibilidad y retorna las recomendaciones personalizadas de vivienda.

---

## 🔒 Seguridad e Integración con GitHub

Este proyecto ha sido optimizado y asegurado sin sobreingeniería para un entorno de Hackathon:
- **Protección de API Keys**: `GEMINI_API_KEY` reside exclusivamente en el servidor backend (archivo `.env`) y nunca se expone al navegador del cliente.
- **`.gitignore`**: Configurado para evitar que subas credenciales (`.env`), la carpeta `node_modules` o archivos temporales de compilación al repositorio público.
- **Rate Limiting**: Limitador de peticiones integrado en memoria para proteger tu cuota de Gemini contra abusos.
- **CORS dinámico**: Permite restringir el acceso del backend a un origen específico mediante `ALLOWED_ORIGIN`.

---

## 🚀 Cómo Ejecutar el Proyecto

### 1. Configuración de Variables de Entorno
Copia el archivo de ejemplo a la raíz del proyecto:
```bash
cp .env.example .env
```
Abre el archivo `.env` y configura tus credenciales:
```env
# Clave API de Gemini Studio (Requerido)
GEMINI_API_KEY=tu_clave_gemini_aqui

# Nombre del modelo (Recomendado gemini-1.5-flash por cuotas)
GEMINI_MODEL=gemini-1.5-flash

# URL base del Motor de Perfilamiento
MOTOR_API_URL=http://localhost:8000

# Puerto local del backend
PORT=3001
```

### 2. Instalación de Dependencias
```bash
npm install
```

### 3. Ejecución en Modo Desarrollo
Para trabajar de forma local con recarga en caliente de React:
- **Inicia el Backend de VIVI (puerto 3001)**:
  ```bash
  npm run server
  ```
- **Inicia el Frontend de VIVI (Vite, puerto 5173)**:
  ```bash
  npm run dev
  ```
  *Nota: Vite está preconfigurado para hacer proxy automático de `/api` hacia el backend en el puerto 3001.*

### 4. Ejecución en Modo Producción (Single Port)
Si deseas que Express sirva de forma unificada tanto el backend como el frontend React en el mismo puerto:
- **Genera el build optimizado**:
  ```bash
  npm run build
  ```
- **Arranca el servidor unificado**:
  ```bash
  npm start
  ```
  Visita **`http://localhost:3001`** en tu navegador para interactuar con VIVI.

---

## ⚙️ Reglas del Flujo Conversacional de VIVI

El asistente VIVI opera bajo un guion conversacional estricto configurado en sus directivas de sistema:
1. **Paso Inicial**: Solicita la cédula y consulta al afiliado en el CRM.
2. **Estrategia para No Afiliados**: Si el CRM no lo reporta, VIVI marca `afiliado: false` y omite preguntas sobre categoría, antigüedad de meses y tipo de cotizante para hacer el flujo ágil.
3. **Estrategia Financiera Diferenciada**: VIVI pregunta directamente por los montos de **ahorros voluntarios** y **cesantías acumuladas** de forma separada, sin asumir valores ni mezclar ambos conceptos.
4. **Regla de Sinceridad de Viabilidad**:
   - Si el Motor de Decisión responde que el usuario **no es viable**: VIVI es directo e informa de manera amable que no califica y **no será contactado** telefónicamente en este momento. A cambio, le proporciona consejos de ahorro y mejora de perfil crediticio para el futuro. El backend limpia los proyectos recomendados para que no se muestre ningún match en pantalla.
   - Si el usuario **es viable**: VIVI lo felicita e indica que pronto será contactado por el equipo comercial.

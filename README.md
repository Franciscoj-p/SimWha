# Asesor Digital — Colsubsidio (Hackathon Ready)

Este repositorio contiene la integración entre la interfaz de chat en React y el backend en Node.js que gestiona las llamadas a la API de **Google Gemini** y al **Motor de Perfilamiento de Vivienda**.

El proyecto está estructurado con una arquitectura moderna de **React + Vite** y **Express** que elimina cualquier problema de dependencias en el navegador.

---

## 📂 Estructura del Proyecto

```
├── dist/                # Directorio compilado de producción (estáticos)
├── src/
│   ├── main.jsx         # Punto de entrada de React
│   └── AsesorDigital.jsx # Componente principal del Chat
├── index.html           # Plantilla raíz de Vite
├── vite.config.js       # Configuración de Vite con Proxy
├── server.js            # Servidor Express (Backend y servidor estático de dist/)
├── package.json         # Dependencias y scripts de ejecución
└── .gitignore           # Archivo para evitar subir credenciales a GitHub
```

---

## 🔒 Seguridad para GitHub

El repositorio está listo para subirse a GitHub de forma segura:
- El archivo `.gitignore` está configurado para que **nunca se suban credenciales (`.env`), ni `node_modules` ni archivos temporales**.
- **`GEMINI_API_KEY`** reside únicamente en las variables de entorno del backend y jamás toca el navegador.
- Protección integrada de **Rate Limiting** por IP para prevenir consumo no deseado de cuota en la API de Gemini.
- Soporte para **CORS restringido** y **API Key opcional (`CHAT_API_KEY`)** para proteger el backend si se despliega públicamente.

---

## 🚀 Cómo Ejecutar el Proyecto

### 1. Configuración de Variables de Entorno
Copia el archivo de ejemplo y configura tu API Key de Gemini Studio:
```bash
cp .env.example .env
```
Edita `.env` agregando tu API Key y la URL del motor real:
```env
GEMINI_API_KEY=tu_clave_aqui
MOTOR_API_URL=http://localhost:8000
```

### 2. Desarrollo Local
Para iniciar tanto el cliente de desarrollo como el servidor backend de manera independiente:
- **Instala dependencias**:
  ```bash
  npm install
  ```
- **Iniciar el servidor backend (puerto 3001)**:
  ```bash
  npm run server
  ```
- **Iniciar el cliente de desarrollo (Vite, puerto 5173)**:
  ```bash
  npm run dev
  ```
  *Nota: En desarrollo local, Vite se encarga de hacer proxy de todas las peticiones a `/api` directamente hacia el backend en el puerto 3001.*

### 3. Producción (Hackathon / Despliegue)
Para simular el entorno final donde Express sirve también la app de React en un solo puerto:
- **Compilar la interfaz React**:
  ```bash
  npm run build
  ```
  Esto generará la carpeta optimizada `dist/`.
- **Iniciar el servidor Express**:
  ```bash
  npm start
  ```
  Visita **`http://localhost:3001`** en tu navegador para ver la aplicación corriendo directamente desde el servidor.

---

## ⚙️ Variables de Entorno (.env)

| Variable | Descripción | Valor por defecto |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | **(Requerida)** Tu API Key de Google Gemini Studio. | `""` |
| `GEMINI_MODEL` | Nombre del modelo Gemini a utilizar. | `gemini-2.5-flash` |
| `MOTOR_API_URL` | URL base del API de Perfilamiento. | `http://localhost:8000` |
| `PORT` | Puerto local para el backend. | `3001` |
| `ALLOWED_ORIGIN` | Dominios permitidos por CORS (`*` o separados por coma). | `*` |
| `CHAT_API_KEY` | *(Opcional)* API key interna para autenticar el chat. | `""` |
| `RATE_LIMIT_MAX` | Peticiones máximas por IP por minuto. | `30` |

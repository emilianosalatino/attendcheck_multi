# Checador de Asistencia por QR

Sistema ligero para controlar asistencia en clases mediante QR. El maestro genera un QR con vigencia limitada, los alumnos lo escanean y registran su matrícula y nombre. El sistema detecta trampa si un mismo dispositivo intenta registrarse con varias matrículas.

## 

## ⚠️ IMPORTANTE — Versión v13: Multi-usuario +



### Fase 1 — Captura del alumno

- ✅ Validación estricta de matrícula con formato **AASSFNNNN**
  - Ejemplo: `1701F0021`
- ✅ 3 campos de nombre: Nombre(s) + Apellido paterno (obligatorios, min 2 chars) + Apellido materno (opcional)
- ### Fase 2 — Stats por sesión

- ✅ Botón "Stats" en cada sesión
- ✅ Modal con: Total, Limpias, Sospechosas, Esperados, % Asistencia
- ✅ Lista detallada de asistencias con nombres
- ✅ Exportar a Excel (XLSX) con 2 hojas: Resumen + Asistencias detalladas

### Fase 3 — Entidad "Materia" (Subject)

- ✅ Pestaña "Materias" en el dashboard
- ✅ Cada materia tiene color distintivo (se ve en badges de sesión)
- ✅ Al crear una sesión, opcionalmente se asigna a una materia
- ✅ Campo "Alumnos esperados" por sesión (para calcular % asistencia)
- ✅ Botón "Stats" por materia → modal con:
  - Total de sesiones de la materia
  - Alumnos únicos que asistieron
  - Total de asistencias
  - % asistencia promedio
  - Lista de alumnos con: matrícula, nombre, # asistencias, # sesiones totales, % individual, # sospechosas
- ✅ Exportar a Excel (XLSX) con 3 hojas: Resumen + Sesiones + Alumnos

## Deploy en Render.com + Turso (gratis para siempre)

Guía de cero a producción. ~20 min.

### Requisitos

- Cuenta en GitHub (gratuita)
- Cuenta en Turso (gratuita, login con GitHub)
- Cuenta en Render.com (gratuita, login con GitHub)

### Paso 1 — Subir el código a GitHub

1. Descomprime `checador-asistencia.zip` en tu computadora.
2. **Borra el archivo `.env`** de la carpeta (NO debe ir a GitHub).
3. **Borra la carpeta `node_modules/`** si existe.
4. Crea un repo nuevo en GitHub: <https://github.com/new>
   - Nombre: `checador-asistencia` (o el que quieras)
   - **NO marques** "Add a README", "Add .gitignore", "Choose a license" (los archivos ya vienen en el ZIP)
   - Tipo: **Público**
5. Sube todos los archivos del ZIP al repo (drag & drop en la página de GitHub).
6. Commit con el mensaje que quieras.

### Paso 2 — Crear la base de datos en Turso

1. Entra a <https://turso.tech>, login con GitHub.
2. **Create Database**:
   - Name: ej: `checador`
   - Location: AWS US East (Virginia) o la más cercana
   - Type: SQLite
3. Entra a la base de datos creada → copia la **URL** (algo como `libsql://checador-xxxxx.aws-us-east-1.turso.io`)
4. Ve a **Settings → Authentication Tokens → Create Token** → nombre `checador-prod` → copia el token
5. Anota estos dos valores:
   - **DATABASE_URL** = `libsql://checador-xxxxx.turso.io`
   - **DATABASE_AUTH_TOKEN** = `tu-token-largo`

> El schema (tablas) se aplicará AUTOMÁTICAMENTE en el build de Render. No necesitas tocar SQL manualmente.

### Paso 3 — Crear Web Service en Render

1. Entra a <https://dashboard.render.com> → **New +** → **Web Service**

2. **Connect a repository** → selecciona tu repo `checador-asistencia`

3. Completa:
   
   - **Name**: `checador-asistencia` (será tu subdominio en Render)
   - **Language**: Node (se detecta solo)
   - **Region**: la más cercana a tu escuela
   - **Branch**: `main`
   - **Runtime**: Node.js (default)
   - **Build Command** (copia y pega tal cual):
     
     ```
     npm install && npm run db:generate && npm run db:init && npm run build
     ```
   - **Start Command** (copia y pega tal cual):
     
     ```
     npm run start
     ```
   - **Instance Type**: **Free** (suficiente para uso educativo)

4. Baja hasta **Environment Variables** y agrega **4 variables**:
   
   | Key                                  | Value                                                                                    |
   | ------------------------------------ | ---------------------------------------------------------------------------------------- |
   | `DATABASE_URL`                       | `libsql://checador-xxxxx.turso.io` (tu URL de Turso)                                     |
   | `DATABASE_AUTH_TOKEN`                | tu token de Turso                                                                        |
   | `ADMIN_USERNAME`                     | nombre de usuario del admin, ej. `admin`                                                 |
   | `ADMIN_PASSWORD`                     | contraseña del admin, mínimo 6 caracteres (elíge una fuerte)                             |
   | `JWT_SECRET` (opcional, recomendado) | string largo aleatorio para firmar cookies JWT. Si no se setea, deriva de ADMIN_PASSWORD |
   | `TRACKING_SECRET` (opcional)         | string largo aleatorio para firmar cookie de tracking anti-trampa                        |
   
   > 

5. **Create Web Service**. Render tarda 3-5 min en el primer deploy.

### Paso 4 — Verificar

1. Cuando veas `==> Your service is live 🎉` en el log, abre tu URL:
   `https://checador.onrender.com`
2. Render free tarda ~50s en despertar la primera vez. Sé paciente.
3. Debe cargar la **pantalla de login**. Escribe tu `ADMIN_USERNAME` y `ADMIN_PASSWORD` → verás el dashboard de admin.
4. En la pestaña **Profesores** , crea un profesor con un username + nombre + password temporal.
5. Cierra sesión, vuelve a loguear con el username del profesor que creaste → verás el dashboard de profesor (sin pestaña Profesores).
6. Crea una materia → crea una sesión con esa materia → mira el QR → copia el enlace del QR en otra pestaña → registra una matrícula → vuelve al dashboard → presiona "Stats" → debe aparecer el modal con las estadísticas y botón de Excel. ✓

## Cómo usarlo

### Como maestro o admin

1. Abre la URL de tu app (sin parámetros en la URL).
2. **Pantalla de login**: escribe tu **nombre de usuario** y contraseña.
3. Si sos admin, verás 3 pestañas: **Sesiones**, **Materias** y **Profesores**. Si sos profesor, verás 2: **Sesiones** y **Materias**.

#### Pestaña Profesores (solo admin)

1. Crea profesores con **nombre de usuario** + **nombre completo** + **contraseña temporal** (mínimo 6 caracteres).
2. Lista de profesores con `@username` y número de materias asignadas.
3. Botón de borrar por profesor (las materias quedan sin dueño).

#### Pestaña Materias

1. Crea materias con nombre + color (ej. "Cálculo Diferencial - Grupo A", color verde).
2. Cada materia tendrá un badge de color en las sesiones.
3. Botones por materia: Stats (ver estadísticas globales), Editar, Borrar.

#### Pestaña Sesiones

1. **Nombre de la sesión** (ej. "Sesión del 15 oct - Repaso parcial").
2. **Materia (opcional)**: selecciona una materia del dropdown.
3. **Alumnos esperados**: cuántos alumnos se espera que asistan (para calcular %).
4. **Vigencia (min)**: minutos de validez del QR (default 15).
5. Presiona **Generar QR** → muestra el QR a tus alumnos.
6. Por cada sesión: botones **Ver QR**, **Lista** (lista de asistencia), **Stats** (estadísticas + Excel), **Cerrar/Abrir**, **Borrar**.

### Como alumno

1. Escanea el QR con la cámara del celular (o abre el enlace directo).
2. Se abre la página de registro con el nombre de la clase y un contador de tiempo.
3. Escribe tu(s) nombre(s) (mínimo 2 caracteres).
4. Escribe tu apellido paterno (mínimo 2 caracteres).
5. (Opcional) Escribe tu apellido materno.
6. Escribe tu matrícula con formato AASSFNNNN (ej. `1701F0021`). La F puede ser minúscula.
7. Presiona **Registrar asistencia**.
8. Si todo sale bien, verás un mensaje de éxito con tu nombre completo.
9. Si intentas registrar dos veces la misma matrícula → se rechaza.
10. Si intentas registrar con otra matrícula desde el mismo dispositivo → queda marcado como **sospechoso**.

## 

## Limitaciones honestas

Ningún sistema web es 100% anti-trampa. Un alumno técnico podría: ...  Un montón de cosas...

El sistema eleva la barrera de "mandar un curl con datos falsos" a "configurar extensiones de navegador o usar varios navegadores", que ya es mucho trabajo.

## ⚠️ Sobre el "sleep" en Render Free

El plan free de Render **duerme tras 15 minutos sin actividad**. La primera vez que abres la URL tarda ~50s en despertar.

**Recomendación**: tú (maestro) abre la URL primero para que despierte, y **después** genera el QR.

## Backup de datos

- **En Turso**: backups automáticos. Puedes exportar desde el dashboard si quieres una copia local.

## Actualizar la app cuando cambies código

Solo `git push` a tu repo. Render detecta el cambio y redespliega en 2-3 min.

## 

## Variables de entorno

| Variable              | Dónde                    | Para qué                                                                                                  |
| --------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Render env, .env local   | URL de Turso (`libsql://...`) o SQLite local (`file:./db/custom.db`)                                      |
| `DATABASE_AUTH_TOKEN` | Render env               | Token de Turso (vacío para SQLite local)                                                                  |
| `ADMIN_USERNAME`      | Render env, .env local   | Nombre de usuario del admin root (ej. `admin`). Compatibilidad: también acepta `ADMIN_EMAIL` (legacy v11) |
| `ADMIN_PASSWORD`      | Render env, .env local   | Contraseña del admin root (mínimo 6 chars). Compatibilidad: también acepta `TEACHER_PASSWORD` (legacy)    |
| `JWT_SECRET`          | Render env (recomendado) | Secreto para firmar cookies JWT. Si no se setea, deriva de ADMIN_PASSWORD                                 |
| `TRACKING_SECRET`     | Render env (opcional)    | Secreto para firmar cookies de tracking anti-trampa. Si no se setea, deriva de TEACHER_PASSWORD           |
|                       |                          |                                                                                                           |
|                       |                          |                                                                                                           |

## Formato de matrícula: `AASSFNNNN`

| Letra  | Significado                                               | Valores válidos         |
| ------ | --------------------------------------------------------- | ----------------------- |
| `AA`   | Año de ingreso                                            | 08-99 (ej: 17 = 2017)   |
| `SS`   | Semestre de incorporación                                 | 2 dígitos (01, 02, ...) |
| `F`    | Letra F (mayúscula o minúscula, se convierte a mayúscula) | `F`                     |
| `NNNN` | Consecutivo                                               | 4 dígitos (0001-9999)   |

**Ejemplo válido**: `1701F0021` → año 2017, semestre 01, F, consecutivo 0021
**Ejemplo inválido**: `20180564` (no tiene la F), `0799F0001` (AA < 08)

## Licencia

Código libre para uso educativo.

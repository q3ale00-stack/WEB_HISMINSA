# HIS MINSA

Plataforma de consulta y análisis HIS MINSA para explorar pacientes, producción asistencial y catálogos institucionales almacenados en SQL Server. La interfaz prioriza la consulta y no incluye captura de nuevas atenciones.

## Descripción general

El proyecto está organizado en dos áreas de responsabilidad:

- **Frontend:** presenta el constructor de consultas, resultados, fichas de consulta, reportes y catálogos; consume la API HTTP y no se conecta directamente a la base de datos.
- **Backend:** expone la API, aplica las reglas de negocio y ejecuta consultas parametrizadas contra SQL Server.

En el modo local, Express sirve también los archivos estáticos del frontend. Esta disposición conserva un único origen para la aplicación y permite separar la publicación del frontend y la API cuando el entorno lo requiera.

## Arquitectura y estructura

```text
backend/
  app.js                   Configuración de Express y montaje de rutas
  server.js                Carga del entorno y arranque del servidor
  config/db.js             Conexión y acceso a SQL Server
  controllers/              Consultas y reglas por dominio, incluida autenticación
  routes/                   Definición de endpoints HTTP, incluida autenticación
  check_schema.js          Inspección de tablas y columnas
frontend/
  index.html               Estructura semántica de la interfaz
  css/app.css              Estilos y reglas adaptables
  js/app.js                Interacciones y consumo de la API
.env                       Configuración local, no versionada
package.json               Dependencias y comandos del proyecto
```

### Responsabilidades del backend

- `app.js` registra middleware, rutas y la carpeta estática del frontend.
- `server.js` carga `.env` desde la raíz y abre el puerto definido por `PORT` (3000 por defecto).
- `routes/` asocia cada URL con la función de controlador que la atiende.
- `controllers/` agrupa el acceso a datos y la transformación de resultados por dominio: pacientes, maestros y atenciones.
- `config/db.js` centraliza el pool de SQL Server y limita los reintentos a fallos transitorios de lectura.
- `check_schema.js` permite consultar el esquema de la base de datos conectada.

### Responsabilidades del frontend

- `index.html` contiene la estructura de las vistas y sus controles.
- `css/app.css` define variables de estilo, componentes y comportamiento adaptable a pantallas pequeñas.
- `js/app.js` inicializa la página y coordina navegación, filtros, resultados, tablas y solicitudes HTTP.

## Funcionalidades

- Construir consultas desde una pantalla horizontal: una barra con tipo de resultado, medida, agrupación y fechas, y un panel con **todos los parámetros** de la base visibles a la vez en columnas por categoría. Los parámetros llenos se aplican juntos (Y) sobre el mismo registro y viajan a la API como `params`. En «es» se aceptan varios valores separados por comas, y los campos numéricos y de fecha usan rangos con mínimo, máximo o ambos.
- Las condiciones avanzadas («la atención tiene / NO tiene», «el paciente tiene / NO tiene», grupos con O) quedan en una sección plegable. Cada grupo combina sus criterios con Y/O y cada conexión entre grupos tiene su propio Y/O.
- Agrupar los resultados por establecimiento, departamento, provincia, Red, MicroRed, centro poblado, profesional, profesión, condición laboral, periodo, código HIS, diagnóstico, tipo de diagnóstico, financiador, turno, condición en el establecimiento o servicio (N/C/R), condición de gestante, lote HIS, sexo, etnia, etapa de vida MINSA, UPS o datos identificatorios del paciente.
- Filtrar también por datos de digitación y calidad: fecha y hora de digitación, días entre atención y digitación, lote, página HIS y número de ítem dentro de la atención. Las medidas incluyen días promedio y máximos hasta la digitación.
- Consultar pacientes, producción por profesional, indicadores de producción y reportes agregados.
- Consultar todo el padrón `MaestroPaciente` con paginación de servidor, buscar por documento, nombre, apellido o historia clínica y abrir la ficha de producción cuando existan registros HIS.
- Consultar resumen, atenciones con filtros de fecha y texto, diagnósticos frecuentes y detalles de cada atención.
- Revisar producción por profesional, incluyendo pacientes atendidos, códigos frecuentes y actividad por mes.
- Generar reportes de producción por periodo, establecimiento, código y profesional.
- Explorar catálogos de establecimientos, UPS, CIE-10, CPMS y laboratorio. Los establecimientos, servicios y códigos HIS pueden enviarse al constructor como filtros de producción.
- Guardar consultas frecuentes en el navegador y exportar resultados a CSV o JSON.
- Permitir el acceso de administradores y médicos con cuentas registradas por un administrador. Las contraseñas se almacenan con hash scrypt y la sesión se mantiene en una cookie HTTP-only; todos los endpoints de datos requieren sesión.
- Mostrar el perfil del usuario autenticado con nombre completo, rol, DNI, correo, teléfono, profesión, especialidad, colegiatura y establecimiento. El administrador puede crear cuentas y vincular médicos con `MaestroPersonal`; nombre, DNI, profesión, colegiatura y establecimiento se toman de ese catálogo.
- La opción «Recordarme» guarda solo el usuario en el navegador, nunca la contraseña. El perfil incluye una acción para cerrar sesión.
- Importar datos actualizados desde la vista **Importar datos** (solo administradores), que reemplaza el script SQL de carga de la Unidad de Estadística. Consulta [Importación de datos](#importación-de-datos).

Las consultas y reportes utilizan `NProduccion` y se enriquecen con `MaestroPaciente`, `MaestroPersonal` y las tablas maestras relacionadas. Las medidas del explorador tienen semánticas diferenciadas: **pacientes únicos** cuenta `Id_Paciente` distinto; **citas atendidas** cuenta `Id_Cita` distinto; **registros HIS** cuenta filas de `NProduccion`. También se pueden contar códigos HIS distintos y calcular sumas/promedios LAB, edad, peso, talla y hemoglobina cuando existan valores. La consulta devuelve las tres métricas base junto con la medida seleccionada y calcula el total general directamente sobre los filtros; los grupos del resultado pueden compartir pacientes si se agrupa por dimensiones distintas. En el constructor, Y exige que se cumplan todos los criterios del grupo y O permite que se cumpla cualquiera; además, cada conexión entre grupos se configura individualmente. Si se mezclan conectores, Y tiene precedencia sobre O, como en SQL. El periodo de atención siempre se conserva como filtro general. El KPI de pacientes registrados y el buscador del padrón cuentan `MaestroPaciente` completo, incluyendo personas sin filas en `NProduccion`. La edad se toma de `Edad_Reg` únicamente cuando `Tipo_Edad = 'A'` (años registrados en la atención), no se recalcula con la fecha actual. Los agregados se ejecutan en SQL Server; los valores LAB no numéricos y la categoría `10+` se gestionan de forma segura para evitar errores de conversión. Al sumar o promediar LAB, `10+` se computa como `10` (límite inferior de la categoría, no el valor real), y la interfaz lo identifica para evitar presentar ese resultado como exacto. Fuera de la importación de archivos reservada a administradores, la API no expone operaciones para registrar o modificar pacientes ni atenciones.

Salvo `/api/health`, el inicio de sesión y la comprobación de sesión, los endpoints de la API requieren una sesión vigente. Los archivos fuente incluyen comentarios por módulo, vista, función y bloque funcional para explicar responsabilidades y reglas de negocio. Los archivos JSON de configuración se mantienen sin comentarios porque el formato JSON no los admite.

## Requisitos

- Node.js 22 o superior.
- Acceso de red a una instancia de SQL Server compatible con la configuración de `mssql`.
- Dependencias del proyecto instaladas con npm.

## Configuración del entorno

Crea un archivo `.env` en la raíz del repositorio con las variables necesarias:

```dotenv
DB_USER=
DB_PASSWORD=
DB_SERVER=
DB_DATABASE=
DB_PORT=1433
PORT=3000

# Datos para crear el primer administrador en una base de datos sin cuentas.
AUTH_ADMIN_USERNAME=
AUTH_ADMIN_PASSWORD=
AUTH_ADMIN_FULL_NAME=
AUTH_ADMIN_DNI=
AUTH_ADMIN_EMAIL=
AUTH_ADMIN_PHONE=
CORS_ORIGIN=
```

Completa las variables de SQL Server y los datos del primer administrador. La contraseña de aplicación debe tener al menos 12 caracteres. El administrador inicial se crea una sola vez si la tabla de usuarios está vacía; después, los administradores pueden registrar cuentas desde **Mi perfil**. No reutilices la contraseña de SQL Server como contraseña de la aplicación. No incluyas credenciales reales en archivos versionados, capturas o registros. `.env` está excluido mediante `.gitignore`; el backend carga este archivo desde una ruta explícita, independiente del directorio desde el que se inicie.

`CORS_ORIGIN` solo se necesita si el frontend se sirve desde otro origen; en ese caso debe ser el origen exacto y confiable de la interfaz. En local, Express sirve el frontend y la API desde el mismo origen.
En producción, publica el servicio detrás de HTTPS y establece `NODE_ENV=production` para que la cookie de sesión use el atributo `Secure`.

## Instalación y ejecución

Desde la raíz del proyecto, instala las dependencias y arranca el servidor:

```powershell
npm install
npm start
```

Abre `http://localhost:3000` en el navegador. Para desarrollo con reinicio automático al detectar cambios:

```powershell
npm run dev
```

En Windows, si la política de PowerShell bloquea `npm.ps1`, usa el ejecutable `.cmd`:

```powershell
npm.cmd install
npm.cmd start
npm.cmd run dev
```

El comando `npm start` ejecuta `backend/server.js`; `npm run dev` utiliza el modo de observación de Node.js.

## API HTTP

La API usa el prefijo `/api`. Endpoints de uso frecuente:

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `GET` | `/api/health` | Comprueba que el servidor HTTP está activo. |
| `POST` | `/api/auth/login` | Inicia sesión con una cuenta activa y establece una cookie de sesión HTTP-only. |
| `POST` | `/api/auth/logout` | Invalida la sesión actual. |
| `GET` | `/api/auth/session` | Comprueba si el navegador tiene una sesión activa. |
| `GET` | `/api/auth/me` | Devuelve el perfil de la cuenta autenticada. |
| `GET` | `/api/auth/personal?q=...` | Busca médicos del catálogo HIS (solo administrador). |
| `POST` | `/api/auth/users` | Crea una cuenta de administrador o médico (solo administrador). |
| `GET` | `/api/pacientes?page=1&pageSize=50&q=...` | Devuelve una página del padrón completo `MaestroPaciente` y el total coincidente. `q` es opcional; sin él se puede recorrer todo el padrón. |
| `GET` | `/api/pacientes?tipoDocumento=...&documento=...` | Busca un paciente por tipo y número de documento. |
| `GET` | `/api/pacientes/:id/panel` | Devuelve resumen, historial y diagnósticos del paciente. Acepta ID o documento. |
| `GET` | `/api/maestros/personal?q=...` | Busca profesionales en el catálogo de personal. |
| `GET` | `/api/maestros/items?q=...` | Busca códigos HIS (CIE-10 y CPMS) para el autocompletado del constructor. |
| `GET` | `/api/maestros/personal/:id/actividad` | Devuelve actividad HIS del profesional; acepta ID o documento. |
| `GET` | `/api/atenciones/reportes` | Genera métricas de filas HIS, citas y pacientes distintos, con desgloses por mes, código, establecimiento y profesional. Acepta `fechaInicio` y `fechaFin` en formato `AAAA-MM-DD`; fechas inválidas o un rango invertido devuelven HTTP 400. |
| `GET` | `/api/consultas/metadata` | Devuelve los campos (con categoría y catálogo de autocompletado), medidas, agrupaciones, ámbitos y operadores permitidos en el constructor. |
| `GET` | `/api/consultas/dashboard` | Devuelve los indicadores globales y tendencias del tablero. |
| `POST` | `/api/consultas/ejecutar` | Valida y ejecuta una consulta parametrizada. Con `mode: "resumen"` devuelve agregados; con `mode: "listado"` devuelve atenciones paginadas (`page`, `pageSize` hasta 200) con todos sus ítems HIS. `drill` agrega filtros exactos que siempre se combinan con Y. |
| `GET` | `/api/importacion/resumen?anio=2026` | Totales de los maestros y producción del año por mes (solo administrador). |
| `POST` | `/api/importacion/archivos?nombre=...` | Sube un CSV como `application/octet-stream` (solo administrador). |
| `POST` | `/api/importacion/ejecutar` | Inicia la importación de maestros o de la trama nominal en segundo plano (solo administrador). |
| `GET` | `/api/importacion/estado` | Progreso y registro de la importación en curso o de la última realizada (solo administrador). |

Los filtros de fecha utilizan `fechaInicio` y `fechaFin` en formato `AAAA-MM-DD`; la fecha final incluye el día completo, también en los reportes por paciente y profesional. En producción, `Registros HIS` cuenta filas por ítem, `Citas` cuenta `Id_Cita` distintos y `Pacientes` cuenta `Id_Paciente` distintos; estos totales no son intercambiables y los pacientes pueden aparecer en más de una fila agrupada. La API HIS no incluye rutas para insertar atenciones o pacientes. El listado completo de rutas de cada dominio está en `backend/routes/`.

## Datos y consultas

- `MaestroPaciente` aporta identificación y datos demográficos del paciente.
- `NProduccion` almacena los registros HIS por ítem, el identificador de cita (`Id_Cita`), los códigos, resultados LAB, edad registrada y relaciones con personal, establecimiento y UPS.
- El padrón de pacientes y la producción son universos distintos: la búsqueda lista el maestro completo sin exigir que el paciente tenga filas en `NProduccion`; el historial clínico solo puede mostrar producción que esté registrada.
- `MaestroPersonal` identifica al profesional que produjo cada registro.
- Las tablas `MAESTRO_HIS_*` aportan descripciones de códigos, servicios, establecimientos, profesiones y otros catálogos.

Los campos, medidas, agrupaciones, operadores y conectores lógicos del constructor se restringen a listas permitidas. Cada grupo tiene su propio conector Y/O y cada conexión entre grupos también tiene un operador independiente; cuando se mezclan operadores, Y tiene precedencia sobre O. El periodo se aplica globalmente y no puede quedar excluido por una condición O. Las consultas guardadas se almacenan localmente con el nombre elegido por el usuario y conservan sus grupos y conectores. Los valores se envían como parámetros SQL; el cliente no envía expresiones SQL ni recibe las expresiones internas del motor. Para proteger SQL Server y el navegador, una consulta admite hasta 100 criterios, 20 grupos, 500 valores por lista y devuelve como máximo 5,000 filas agrupadas; cuando el resultado supera ese límite, la interfaz lo indica para que se afinen los filtros. Cada condición tiene un **ámbito**: «El registro cumple» evalúa la misma fila HIS; «La atención tiene / NO tiene» busca en cualquier registro de la misma cita (`EXISTS` / `NOT EXISTS` por `Id_Cita`); «El paciente tiene / NO tiene» busca en cualquier atención del paciente dentro del periodo (por `Id_Paciente`). Así se encuentran, por ejemplo, atenciones con dos códigos a la vez o pacientes con un diagnóstico sin una actividad. Los catálogos (paciente, personal, establecimiento, UPS, CIE/CPMS, financiador) solo se unen cuando un filtro o agrupación los usa, deduplicados a una fila por identificador. El campo «Edad en años (incluye meses y días)» convierte `Tipo_Edad` M y D a años; «Profesional» usa el nombre completo del catálogo de personal.

## Importación de datos

La vista **Importar datos** está disponible solo para administradores y realiza lo mismo que el script `carga_de_datos` de la Unidad de Estadística, sin `BULK INSERT` ni `xp_cmdshell`: el navegador sube los CSV al servidor Node y este los inserta en SQL Server con la conexión de la aplicación. SQL Server no necesita acceso a carpetas del disco.

- **Formato:** igual que el script: campos separados por coma, la primera fila es el encabezado y los campos se asignan a las columnas de la tabla en su orden. La codificación puede ser ANSI de Windows (como `CODEPAGE = 'ACP'`), UTF-8 o detectarse automáticamente. Las fechas se aceptan como `AAAA-MM-DD` o `DD/MM/AAAA`.
- **Formulario:** sigue la pantalla «Importación de archivos planos» de la aplicación de escritorio HIS: filas Paciente, Personal, Registrador y Nominal, cada una con su archivo (botón «…») y su modo, y los botones **Importar** y **Salir**. Solo se importan las filas con archivo, en ese orden.
- **Maestros** (`MaestroPaciente`, `MaestroPersonal`, `MaestroRegistrador`), cada uno en su propia transacción:
  - *Acumular:* los registros cuyo identificador ya existe se actualizan con la versión del archivo y los nuevos se agregan.
  - *Reemplazar:* se vacía el maestro y se carga completo desde el archivo.
  - En ambos modos se eliminan los duplicados por `Id_Paciente`, `Id_Personal` o `Id_Registrador`, como en el script.
- **Nominal** (`NProduccion`), todos los archivos en una sola transacción:
  - *Acumular:* agrega los registros sin borrar nada (si un mes ya estaba cargado, queda duplicado).
  - *Reemplazar AAAA:* elimina la producción de ese año y la carga de nuevo, como la carga múltiple del script. Si algún registro no es de ese año, se cancela la importación nominal.
- Si una fila falla, lo importado antes queda guardado y lo demás no se modifica. El mensaje indica el archivo, la línea y la columna con problemas. Cualquier modo *Reemplazar* exige una confirmación explícita.
- Solo se ejecuta una importación a la vez. El progreso se puede seguir desde cualquier navegador del administrador y los archivos temporales se eliminan al terminar.

Variables opcionales en `.env`: `IMPORT_TMP_DIR` (carpeta temporal; por defecto la del sistema), `IMPORT_MAX_MB` (tamaño máximo por archivo, 2048) e `IMPORT_TIMEOUT_MIN` (minutos máximos por sentencia SQL durante la importación, 60). La cuenta de SQL Server de `.env` necesita permisos de `SELECT`, `INSERT` y `DELETE` sobre esas tablas.

## Verificación y resolución de problemas

1. Abre `http://localhost:3000/api/health`. Una respuesta HTTP 200 confirma que Express está activo.
2. Si la interfaz informa que no puede consultar la base, comprueba que SQL Server esté disponible y revisa `DB_SERVER`, `DB_DATABASE`, el puerto y las credenciales locales.
3. Para revisar los nombres de tablas y columnas visibles en la conexión configurada, ejecuta `node backend/check_schema.js`.
4. Los errores de conexión transitorios en lecturas se reintentan de forma limitada. Si el servicio de base de datos sigue sin estar disponible, la API devuelve un error recuperable y registra el detalle en la consola del servidor.
5. Si el frontend y la API se alojan en direcciones diferentes, actualiza la URL base en la vista **Configuración** y restringe CORS a los orígenes que correspondan.

## Seguridad y operación

La información HIS puede contener datos personales y clínicos. Limita el acceso a la aplicación, protege las credenciales de SQL Server y evita compartir datos reales en reportes de depuración. Antes de publicar el servicio fuera de un entorno local controlado, configura autenticación y autorización, restringe CORS, habilita HTTPS y define controles de copias de seguridad, auditoría y conservación de datos.

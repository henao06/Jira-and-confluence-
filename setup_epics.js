/**
 * setup_epics.js
 * Carga la estructura QA (JSON con test cases) en los 9 Epics de Jira (QAA-1 a QAA-9).
 * Ejecutar UNA sola vez: node setup_epics.js
 * Requiere que el servidor esté corriendo: node Server.JS
 */

const http = require('http');

const PROXY = { host: 'localhost', port: 8080 };

const EPICS_META = {
  'login':      { epicKey: 'QAA-1', prefix: 'LG', nombre: 'Login & Autenticación',       moduloSistema: 'modulo-app-web',  severidadDefault: 'mayor'   },
  'lecciones':  { epicKey: 'QAA-2', prefix: 'LC', nombre: 'Lecciones',                   moduloSistema: 'modulo-app-web',  severidadDefault: 'mayor'   },
  'tareas':     { epicKey: 'QAA-3', prefix: 'TA', nombre: 'Tareas',                       moduloSistema: 'modulo-app-web',  severidadDefault: 'medio'   },
  'foros':      { epicKey: 'QAA-4', prefix: 'FO', nombre: 'Foros',                        moduloSistema: 'modulo-app-web',  severidadDefault: 'medio'   },
  'calendario': { epicKey: 'QAA-5', prefix: 'CA', nombre: 'Calendario',                   moduloSistema: 'modulo-app-web',  severidadDefault: 'medio'   },
  'chatkit':    { epicKey: 'QAA-6', prefix: 'CH', nombre: 'ChatKit IA',                   moduloSistema: 'modulo-chatkit',  severidadDefault: 'critico' },
  'cursos':     { epicKey: 'QAA-7', prefix: 'CR', nombre: 'Creación de Cursos',           moduloSistema: 'modulo-app-web',  severidadDefault: 'mayor'   },
  'reportes':   { epicKey: 'QAA-8', prefix: 'RP', nombre: 'Reportes y Calificaciones',    moduloSistema: 'modulo-app-web',  severidadDefault: 'medio'   },
  'perfil':     { epicKey: 'QAA-9', prefix: 'PR', nombre: 'Perfil',                       moduloSistema: 'modulo-app-web',  severidadDefault: 'menor'   },
};

const TEST_CASES = {
  'login': [
    { id:'LG-TC-001', titulo:'Login exitoso con credenciales válidas', tipoTest:'funcional', severidadSiFalla:'critico',
      precondiciones:['El usuario tiene una cuenta activa en Hybred','El usuario NO está logueado actualmente','El servidor está disponible'],
      pasos:['Navegar a https://app.hybred.edu.co/login','Ingresar email válido','Ingresar contraseña correcta','Hacer clic en "Iniciar sesión"'],
      resultadoEsperado:'El sistema autentica al usuario y lo redirige al dashboard correspondiente a su rol' },
    { id:'LG-TC-002', titulo:'Login fallido con credenciales inválidas', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario NO está logueado actualmente','El servidor está disponible'],
      pasos:['Navegar a https://app.hybred.edu.co/login','Ingresar un email inválido o inexistente','Ingresar cualquier contraseña','Hacer clic en "Iniciar sesión"'],
      resultadoEsperado:'El sistema muestra un mensaje de error claro indicando credenciales incorrectas. No se otorga acceso.' },
    { id:'LG-TC-003', titulo:'Cierre de sesión (logout)', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado en el sistema'],
      pasos:['Hacer clic en el avatar o menú de usuario','Seleccionar la opción "Cerrar sesión"'],
      resultadoEsperado:'La sesión se destruye, el usuario es redirigido a /login y no puede acceder a rutas protegidas' },
  ],
  'lecciones': [
    { id:'LC-TC-001', titulo:'Visualización de lección con contenido multimedia', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado como Estudiante','Existe al menos una lección publicada con video/imagen'],
      pasos:['Navegar al curso asignado','Seleccionar una lección disponible','Verificar que el contenido carga correctamente','Reproducir el video si existe'],
      resultadoEsperado:'El contenido multimedia se carga sin errores, el video reproduce correctamente y el texto es legible' },
    { id:'LC-TC-002', titulo:'Marcado de lección como completada', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado como Estudiante','Existe una lección no completada en el curso activo'],
      pasos:['Abrir una lección no completada','Consumir el contenido de la lección','Hacer clic en "Marcar como completada"'],
      resultadoEsperado:'La lección queda marcada como completada, el progreso del curso se actualiza visualmente' },
    { id:'LC-TC-003', titulo:'Navegación secuencial entre lecciones', tipoTest:'funcional', severidadSiFalla:'medio',
      precondiciones:['El usuario está logueado como Estudiante','El curso tiene al menos 2 lecciones publicadas'],
      pasos:['Abrir la primera lección del curso','Hacer clic en "Siguiente lección"','Verificar que carga la lección siguiente','Hacer clic en "Lección anterior"'],
      resultadoEsperado:'La navegación entre lecciones funciona correctamente, sin pérdida de estado ni errores de carga' },
  ],
  'tareas': [
    { id:'TA-TC-001', titulo:'Entrega de tarea dentro del plazo', tipoTest:'funcional', severidadSiFalla:'critico',
      precondiciones:['El usuario está logueado como Estudiante','Existe una tarea activa con fecha de entrega futura'],
      pasos:['Navegar a la sección "Tareas"','Seleccionar una tarea pendiente','Completar el formulario de entrega o adjuntar archivo','Hacer clic en "Entregar"'],
      resultadoEsperado:'La entrega se registra correctamente, el estado cambia a "Entregada" y se confirma con mensaje de éxito' },
    { id:'TA-TC-002', titulo:'Visualización de calificación de tarea', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado como Estudiante','El docente ya calificó al menos una tarea del usuario'],
      pasos:['Navegar a "Tareas"','Seleccionar una tarea con estado "Calificada"','Revisar la nota y el feedback del docente'],
      resultadoEsperado:'Se muestra la calificación, los comentarios del docente y cualquier rúbrica aplicada de forma clara' },
    { id:'TA-TC-003', titulo:'Intento de entrega de tarea vencida', tipoTest:'funcional', severidadSiFalla:'medio',
      precondiciones:['El usuario está logueado como Estudiante','Existe una tarea cuya fecha de entrega ya venció'],
      pasos:['Navegar a "Tareas"','Seleccionar la tarea vencida','Intentar entregar aunque esté vencida'],
      resultadoEsperado:'El sistema bloquea la entrega o muestra advertencia de entrega tardía según la política del docente' },
  ],
  'foros': [
    { id:'FO-TC-001', titulo:'Publicación de hilo en foro', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado','Existe al menos un foro disponible en el curso'],
      pasos:['Navegar a la sección "Foros"','Seleccionar un foro activo','Hacer clic en "Nueva publicación"','Completar el título y cuerpo del mensaje','Publicar'],
      resultadoEsperado:'El hilo se publica y aparece en la lista del foro, visible para otros participantes del curso' },
    { id:'FO-TC-002', titulo:'Respuesta a hilo existente', tipoTest:'funcional', severidadSiFalla:'medio',
      precondiciones:['El usuario está logueado','Existe al menos un hilo publicado en el foro'],
      pasos:['Navegar al foro y seleccionar un hilo existente','Hacer clic en "Responder"','Escribir la respuesta','Publicar la respuesta'],
      resultadoEsperado:'La respuesta se agrega al hilo correctamente, visible debajo del mensaje original con la autoría correcta' },
  ],
  'calendario': [
    { id:'CA-TC-001', titulo:'Visualización de eventos en el calendario', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado','Existen eventos programados en el calendario del curso'],
      pasos:['Navegar a la sección "Calendario"','Verificar que los eventos del mes actual aparecen en las fechas correctas','Cambiar de mes y verificar eventos futuros'],
      resultadoEsperado:'Los eventos se muestran en sus fechas correctas, con etiquetas diferenciando el tipo de evento' },
    { id:'CA-TC-002', titulo:'Detalle de evento al hacer clic', tipoTest:'funcional', severidadSiFalla:'medio',
      precondiciones:['El usuario está logueado','Existe al menos un evento visible en el calendario'],
      pasos:['Navegar a "Calendario"','Hacer clic sobre un evento visible','Revisar los detalles que aparecen'],
      resultadoEsperado:'Se muestra un detalle con la información completa del evento, con opción de navegar a la sección relacionada' },
  ],
  'chatkit': [
    { id:'CH-TC-001', titulo:'Envío de mensaje de texto al ChatKit IA', tipoTest:'funcional', severidadSiFalla:'critico',
      precondiciones:['El usuario está logueado','El servicio de ChatKit IA está disponible','El usuario tiene acceso habilitado'],
      pasos:['Navegar a la sección "ChatKit IA"','Escribir una pregunta en el campo de texto','Presionar Enter o hacer clic en enviar','Esperar la respuesta del modelo IA'],
      resultadoEsperado:'El ChatKit IA responde con contenido relevante, sin errores de timeout ni mensajes de fallo visible al usuario' },
    { id:'CH-TC-002', titulo:'Historial de conversación se mantiene en sesión', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado','El usuario ya tiene al menos 2 mensajes enviados en la sesión actual'],
      pasos:['Enviar un primer mensaje y obtener respuesta','Enviar un segundo mensaje que haga referencia al primero','Verificar que la IA mantiene el contexto'],
      resultadoEsperado:'La IA responde considerando el contexto del mensaje anterior, demostrando que el historial de sesión se preserva' },
    { id:'CH-TC-003', titulo:'Manejo de error cuando el servicio IA no responde', tipoTest:'funcional', severidadSiFalla:'critico',
      precondiciones:['El usuario está logueado','El servicio de IA está inaccesible o con timeout'],
      pasos:['Navegar a "ChatKit IA"','Enviar cualquier mensaje','Observar el comportamiento ante la falta de respuesta'],
      resultadoEsperado:'El sistema muestra un mensaje de error amigable (no un stack trace) y permite reintentar' },
  ],
  'cursos': [
    { id:'CR-TC-001', titulo:'Creación de nuevo curso por docente', tipoTest:'funcional', severidadSiFalla:'critico',
      precondiciones:['El usuario está logueado como Docente o Administrador'],
      pasos:['Navegar a "Mis Cursos"','Hacer clic en "Crear nuevo curso"','Completar nombre, descripción y configuración básica','Guardar/Publicar el curso'],
      resultadoEsperado:'El curso se crea correctamente y aparece en el listado del docente con estado "Borrador" o "Publicado"' },
    { id:'CR-TC-002', titulo:'Agregar lección a curso existente', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado como Docente','Existe al menos un curso creado por el docente'],
      pasos:['Ingresar al editor del curso','Hacer clic en "Agregar lección"','Completar el título y contenido de la lección','Guardar la lección'],
      resultadoEsperado:'La lección se agrega al curso y aparece en el listado de contenido en el orden correcto' },
    { id:'CR-TC-003', titulo:'Publicación de curso para estudiantes', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado como Docente','Existe un curso en estado "Borrador" con al menos una lección'],
      pasos:['Navegar al curso en estado borrador','Hacer clic en "Publicar curso"','Confirmar la publicación'],
      resultadoEsperado:'El curso cambia a "Publicado" y queda visible y accesible para los estudiantes matriculados' },
  ],
  'reportes': [
    { id:'RP-TC-001', titulo:'Visualización de reporte de progreso de estudiante', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado como Docente o Administrador','Existen estudiantes matriculados con actividad registrada'],
      pasos:['Navegar a "Reportes" o "Calificaciones"','Seleccionar un curso con estudiantes activos','Ver el reporte de progreso individual de un estudiante'],
      resultadoEsperado:'Se muestra el progreso del estudiante: lecciones completadas, tareas entregadas y calificaciones obtenidas' },
    { id:'RP-TC-002', titulo:'Exportación de calificaciones', tipoTest:'funcional', severidadSiFalla:'medio',
      precondiciones:['El usuario está logueado como Docente o Administrador','Existen calificaciones registradas para el curso'],
      pasos:['Navegar a la sección de calificaciones del curso','Buscar opción de exportar (CSV, Excel u otro formato)','Iniciar la descarga'],
      resultadoEsperado:'Se descarga un archivo con las calificaciones en el formato esperado, con los datos correctos y sin errores' },
  ],
  'perfil': [
    { id:'PR-TC-001', titulo:'Edición de datos de perfil de usuario', tipoTest:'funcional', severidadSiFalla:'medio',
      precondiciones:['El usuario está logueado en la plataforma'],
      pasos:['Navegar a "Mi Perfil"','Hacer clic en "Editar perfil"','Modificar nombre, foto u otros datos permitidos','Guardar los cambios'],
      resultadoEsperado:'Los cambios se guardan correctamente y se reflejan inmediatamente en la UI' },
    { id:'PR-TC-002', titulo:'Cambio de contraseña', tipoTest:'funcional', severidadSiFalla:'mayor',
      precondiciones:['El usuario está logueado'],
      pasos:['Navegar a "Mi Perfil" → "Seguridad"','Ingresar la contraseña actual','Ingresar la nueva contraseña y confirmarla','Guardar el cambio'],
      resultadoEsperado:'La contraseña se actualiza, el usuario sigue logueado con la sesión actual y la nueva contraseña funciona en el próximo login' },
  ],
};

// ── Helpers HTTP ──────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      ...PROXY, method, path,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Construir ADF con la estructura QA ────────────────────────────────────────

function buildADF(modulo, meta, testCases) {
  const estructura = { meta, testCases };
  const jsonStr = JSON.stringify(estructura, null, 2);

  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'heading',
        attrs: { level: 2 },
        content: [{ type: 'text', text: `${meta.prefix} — ${meta.nombre}` }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: `Módulo: ${modulo} | Epic: ${meta.epicKey} | ${testCases.length} test cases` }],
      },
      {
        type: 'rule',
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'QA_STRUCTURE_START' }],
      },
      {
        type: 'codeBlock',
        attrs: { language: 'json' },
        content: [{ type: 'text', text: jsonStr }],
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'QA_STRUCTURE_END' }],
      },
    ],
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🚀 Setup Epics QAA — Cargando estructuras QA en Jira\n');

  for (const [modulo, epicMeta] of Object.entries(EPICS_META)) {
    const { epicKey } = epicMeta;
    const testCases = TEST_CASES[modulo] || [];
    process.stdout.write(`  ${epicKey} (${modulo}) → `);

    const adf = buildADF(modulo, epicMeta, testCases);

    const res = await request('PUT', `/jira/rest/api/3/issue/${epicKey}`, {
      fields: { description: adf },
    });

    if (res.status === 204 || res.status === 200) {
      console.log(`✅ OK (${testCases.length} TCs)`);
    } else {
      console.log(`❌ HTTP ${res.status}`);
      console.log('   ', JSON.stringify(res.body).substring(0, 200));
    }
  }

  console.log('\n✅ Listo. Recargá el formulario — los módulos ahora cargan desde Jira.\n');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

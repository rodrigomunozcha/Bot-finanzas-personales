/**
 * Respaldo automatico de la planilla en Google Drive.
 *
 * Antes el respaldo era manual y tenia tres pasos: descargar la planilla desde
 * el navegador, correr respaldar.py en el Mac y escribirle /respaldado al bot,
 * que lo recordaba cada semana. Un sistema cuya idea es que el usuario solo
 * elija categorias no puede depender de que se acuerde de respaldar.
 *
 * Ahora un activador exporta la planilla cada domingo como .xlsx a la carpeta
 * "Finanzas - Respaldos" del Drive del usuario, y el bot solo habla si falla.
 *
 * Tres decisiones que importan:
 *
 * 1. Se usa la API de Drive con UrlFetchApp, no DriveApp. El manifiesto declara
 *    el permiso drive.file, que solo alcanza a los archivos que crea este
 *    script. DriveApp pide acceso a TODO el Drive del usuario, y para guardar
 *    un archivo propio en una carpeta propia no hace falta ver el resto. Hay un
 *    efecto a favor: la busqueda de la carpeta solo ve carpetas creadas por el
 *    script, asi que si el usuario tiene otra con el mismo nombre, no se
 *    escribe en la suya.
 *
 * 2. Se comprueba que lo descargado sea de verdad un .xlsx antes de subirlo.
 *    Cuando a Google le falta un permiso, la exportacion puede no fallar con un
 *    error sino responder una pagina de inicio de sesion con codigo 200. Sin
 *    esta comprobacion se guardaria esa pagina con nombre de respaldo y el bot
 *    creeria que todo salio bien. Un .xlsx es un zip, y todo zip empieza con
 *    las letras "PK".
 *
 * 3. El manifiesto declara el servicio avanzado de Drive aunque el codigo no lo
 *    use. Es la forma sancionada de encender la API de Drive en el proyecto de
 *    Google que hay detras del script, y sin eso todo pedido responde 403
 *    accessNotConfigured. No agrega permisos: la lista de oauthScopes esta
 *    escrita a mano en el manifiesto y esa lista manda sobre la que Apps Script
 *    deduciria sola, asi que el alcance sigue siendo drive.file.
 *
 * 4. Nunca se borra un respaldo viejo. Cada uno pesa pocos KB, asi que un año
 *    entero ocupa unos pocos MB de los 15 GB gratis, y el borrado de archivos
 *    del usuario lo hace el usuario.
 */

var RESPALDO_CARPETA = 'Finanzas - Respaldos';
var RESPALDO_TIPO_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
var RESPALDO_TIPO_CARPETA = 'application/vnd.google-apps.folder';
var RESPALDO_DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
var RESPALDO_DRIVE_SUBIDA = 'https://www.googleapis.com/upload/drive/v3/files' +
  '?uploadType=multipart&fields=id,name';

/**
 * Exporta la planilla y la deja en Drive. Devuelve {id, nombre}.
 *
 * Si algo falla lanza un error que explica en que paso. Quien la llama decide
 * que hacer con el: respaldarAhora lo muestra, el activador lo anota para el
 * latido diario.
 */
function exportarRespaldo() {
  var propiedades = PropertiesService.getScriptProperties();
  var hojaId = propiedades.getProperty('HOJA_ID');
  if (!hojaId) throw new Error('Falta HOJA_ID. Corre instalar() primero.');

  // El token se pide en cada respaldo y nunca se guarda: dura una hora, y
  // guardarlo solo agregaria un secreto mas que cuidar.
  var token = ScriptApp.getOAuthToken();

  var archivo = _respaldoDescargarXlsx(hojaId, token);
  var carpetaId = _respaldoCarpeta(token);
  // "Finanzas" en el nombre no es decorativo: respaldar.py solo toma los Excel
  // cuyo nombre lo contiene.
  var nombre = 'Finanzas respaldo ' + diaDe(new Date()) + '.xlsx';
  var subido = _respaldoSubir(archivo, nombre, carpetaId, token);

  propiedades.setProperty('ULTIMO_RESPALDO', String(Date.now()));
  propiedades.deleteProperty('RESPALDO_ERROR');
  // Y la marca de "esta falla ya la avise", o un error identico mas adelante se
  // daria por avisado y el latido se lo callaria.
  propiedades.deleteProperty('RESPALDO_ERROR_AVISADO');
  return { id: subido.id, nombre: nombre };
}

/** Lo dispara el activador cada domingo. Una falla se anota, no revienta. */
function respaldoSemanalAutomatico() {
  try {
    exportarRespaldo();
  } catch (error) {
    // Se anota para que el latido diario la cuente con su causa. Dejar que
    // reviente solo marcaria una ejecucion fallida en un panel que nadie mira.
    PropertiesService.getScriptProperties().setProperty('RESPALDO_ERROR',
      String(error && error.message ? error.message : error).substring(0, 300));
    console.error('respaldo: ' + error);
  }
}

/** "hoy", "hace 1 día", "hace 5 días", o "todavía ninguno". */
function textoUltimoRespaldo() {
  var ultimo = Number(
    PropertiesService.getScriptProperties().getProperty('ULTIMO_RESPALDO') || 0);
  if (!ultimo) return 'todavía ninguno';
  var dias = Math.floor((Date.now() - ultimo) / 86400000);
  if (dias <= 0) return 'hoy';
  return 'hace ' + dias + (dias === 1 ? ' día' : ' días');
}

/**
 * Hace el pedido y lanza un error claro si Google no responde con exito.
 *
 * El cuerpo de la respuesta de error NO se incluye en el mensaje. Ese mensaje
 * termina en Telegram y en revisarSalud, que es la pantalla que uno pega al
 * pedir ayuda, y una pagina de error de Google puede traer el correo de la
 * cuenta. Alcanza con saber en que paso fallo y con que codigo.
 */
function _respaldoPedir(url, opciones, paso) {
  opciones.muteHttpExceptions = true;
  var respuesta = UrlFetchApp.fetch(url, opciones);
  var codigo = respuesta.getResponseCode();
  if (codigo >= 200 && codigo < 300) return respuesta;

  var motivo = _respaldoMotivo(respuesta);
  var pista = (codigo === 401 || codigo === 403)
    ? ' Suele ser un permiso que falta: corre instalar() de nuevo y autoriza lo que pida.'
    : '';
  throw new Error(paso + ' respondió con el código ' + codigo +
    (motivo ? ' (' + motivo + ')' : '') + '.' + pista);
}

/**
 * Saca de la respuesta de error el codigo interno de Google, o '' si no hay.
 *
 * La primera version no miraba el cuerpo del error en absoluto, y eso costo una
 * ronda entera de diagnostico: un 403 puede ser "falta el permiso" o "la API de
 * Drive esta apagada en el proyecto", que se arreglan de formas distintas, y el
 * mensaje no alcanzaba para distinguirlos.
 *
 * El cuerpo completo sigue sin salir de aqui, porque una pagina de error de
 * Google puede traer el correo de la cuenta. De el se toma un solo campo, y aun
 * asi se comprueba su forma antes de dejarlo pasar: solo letras y guion bajo.
 * Los codigos de Google son de esa forma (accessNotConfigured,
 * insufficientPermissions), y un dato personal no lo es, porque lleva espacios,
 * arroba, numeros o puntos.
 */
function _respaldoMotivo(respuesta) {
  try {
    var error = JSON.parse(respuesta.getContentText()).error || {};
    var motivo = (error.errors && error.errors[0] && error.errors[0].reason) ||
      error.status || '';
    return /^[A-Za-z_]{1,60}$/.test(motivo) ? motivo : '';
  } catch (ignorado) {
    return '';
  }
}

function _respaldoDescargarXlsx(hojaId, token) {
  var respuesta = _respaldoPedir(
    'https://docs.google.com/spreadsheets/d/' + hojaId + '/export?format=xlsx',
    { headers: { Authorization: 'Bearer ' + token } },
    'La exportación de la planilla');

  var archivo = respuesta.getBlob();
  var bytes = archivo.getBytes();
  if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
    throw new Error('Google no devolvió un Excel sino otra cosa, probablemente ' +
      'una página de inicio de sesión. Suele ser un permiso que falta: corre ' +
      'instalar() de nuevo y autoriza lo que pida.');
  }
  return archivo;
}

function _respaldoCarpeta(token) {
  var consulta = "name = '" + RESPALDO_CARPETA + "' and mimeType = '" +
    RESPALDO_TIPO_CARPETA + "' and trashed = false";

  var busqueda = JSON.parse(_respaldoPedir(
    RESPALDO_DRIVE_API + '?q=' + encodeURIComponent(consulta) + '&fields=files(id)',
    { headers: { Authorization: 'Bearer ' + token } },
    'La búsqueda de la carpeta en Drive').getContentText());
  if (busqueda.files && busqueda.files.length) return busqueda.files[0].id;

  var creada = JSON.parse(_respaldoPedir(RESPALDO_DRIVE_API + '?fields=id', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ name: RESPALDO_CARPETA, mimeType: RESPALDO_TIPO_CARPETA }),
    headers: { Authorization: 'Bearer ' + token },
  }, 'La creación de la carpeta en Drive').getContentText());
  return creada.id;
}

/**
 * Sube el archivo con nombre y carpeta en un solo pedido.
 *
 * El formato "multipart" junta los datos del archivo y su contenido en un mismo
 * cuerpo, separados por un limite. Hacerlo en dos pedidos (subir y despues
 * mover) dejaria un archivo sin nombre suelto en la raiz del Drive si el
 * segundo falla.
 */
function _respaldoSubir(archivo, nombre, carpetaId, token) {
  var limite = 'respaldo_finanzas_' + Date.now();
  var inicio = '--' + limite + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify({ name: nombre, parents: [carpetaId] }) + '\r\n' +
    '--' + limite + '\r\n' +
    'Content-Type: ' + RESPALDO_TIPO_XLSX + '\r\n\r\n';
  var fin = '\r\n--' + limite + '--';

  var cuerpo = Utilities.newBlob(inicio).getBytes()
    .concat(archivo.getBytes())
    .concat(Utilities.newBlob(fin).getBytes());

  return JSON.parse(_respaldoPedir(RESPALDO_DRIVE_SUBIDA, {
    method: 'post',
    contentType: 'multipart/related; boundary=' + limite,
    payload: cuerpo,
    headers: { Authorization: 'Bearer ' + token },
  }, 'La subida del respaldo a Drive').getContentText());
}

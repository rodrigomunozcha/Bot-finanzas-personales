/**
 * Respaldo automatico en Google Drive.
 *
 * Estas pruebas corren contra un doble de Drive. Recordatorio de CLAUDE.md: en
 * este proyecto el doble ya mintio tres veces sobre como se comporta Google.
 * Que pasen no reemplaza la verificacion en vivo, que es el primer respaldo que
 * hace instalar().
 */

const test = require('node:test');
const assert = require('node:assert');
const { crearEntorno } = require('./ayuda/entorno.js');

test('guarda un .xlsx en la carpeta de respaldos y anota la fecha', () => {
  const e = crearEntorno();
  const r = e.contexto.exportarRespaldo();

  assert.equal(e.drive.carpetas.length, 1);
  assert.equal(e.drive.carpetas[0].name, 'Finanzas - Respaldos');
  assert.equal(e.drive.archivos.length, 1);
  assert.equal(e.drive.archivos[0].carpeta, e.drive.carpetas[0].id);
  assert.match(e.drive.archivos[0].nombre, /^Finanzas respaldo \d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.equal(r.nombre, e.drive.archivos[0].nombre);
  assert.ok(Number(e.propiedades.ULTIMO_RESPALDO) > 0);
});

// respaldar.py solo toma los Excel cuyo nombre contiene "finanzas".
test('el nombre del archivo es uno que respaldar.py reconoce', () => {
  const e = crearEntorno();
  e.contexto.exportarRespaldo();
  assert.ok(e.drive.archivos[0].nombre.toLowerCase().includes('finanzas'));
});

test('la segunda vez usa la misma carpeta, no crea otra', () => {
  const e = crearEntorno();
  e.contexto.exportarRespaldo();
  e.contexto.exportarRespaldo();

  assert.equal(e.drive.carpetas.length, 1);
  assert.equal(e.drive.archivos.length, 2);
});

// El borrado de archivos del usuario lo hace el usuario, siempre.
test('nunca pide borrar nada en Drive', () => {
  const e = crearEntorno();
  for (let i = 0; i < 3; i++) e.contexto.exportarRespaldo();

  assert.equal(e.drive.pedidos.some((p) => p.metodo === 'delete'), false);
  assert.equal(e.drive.archivos.length, 3, 'los respaldos viejos se quedan');
});

// Cuando falta un permiso, Google puede responder una página de inicio de sesión
// con código 200 en vez de un error. Sin la comprobación, esa página quedaría
// guardada con nombre de respaldo y el bot creería que todo salió bien.
test('si Google devuelve una página en vez de un Excel, no se guarda nada', () => {
  const e = crearEntorno();
  e.drive.respuestaExportacion = {
    codigo: 200,
    bytes: Array.from(Buffer.from('<!DOCTYPE html><html>')),
  };

  e.contexto.respaldoSemanalAutomatico();

  assert.equal(e.drive.archivos.length, 0);
  assert.equal(e.propiedades.ULTIMO_RESPALDO, undefined);
  assert.match(e.propiedades.RESPALDO_ERROR, /no devolvió un Excel/);
});

test('si Drive rechaza la subida, se anota la causa y no revienta', () => {
  const e = crearEntorno();
  e.drive.fallarSubidaCon = 403;

  assert.doesNotThrow(() => e.contexto.respaldoSemanalAutomatico());
  assert.equal(e.propiedades.ULTIMO_RESPALDO, undefined);
  assert.match(e.propiedades.RESPALDO_ERROR, /código 403/);
  assert.match(e.propiedades.RESPALDO_ERROR, /instalar\(\)/, 'y dice qué hacer');
});

// Ese mensaje termina en Telegram y en revisarSalud, y una página de error de
// Google puede traer el correo de la cuenta.
test('el mensaje de error no copia la respuesta de Google', () => {
  const e = crearEntorno();
  e.drive.fallarSubidaCon = 403;
  e.drive.cuerpoDeError = 'alguien@example.com no tiene permiso';

  e.contexto.respaldoSemanalAutomatico();

  assert.equal(e.propiedades.RESPALDO_ERROR.includes('alguien@example.com'), false);
});

test('un respaldo exitoso limpia el error anterior', () => {
  const e = crearEntorno();
  e.propiedades.RESPALDO_ERROR = 'una falla vieja';

  e.contexto.respaldoSemanalAutomatico();

  assert.equal(e.propiedades.RESPALDO_ERROR, undefined);
});

// El token de Google da acceso a la cuenta durante una hora. No puede quedar
// escrito en ninguna parte.
test('el token de Google no queda guardado ni se manda a Telegram', () => {
  const e = crearEntorno();
  e.contexto.respaldoSemanalAutomatico();
  e.contexto.manejarTexto('/datos');

  const todo = JSON.stringify([e.propiedades, e.enviados, e.hojas]);
  assert.equal(todo.includes(e.drive.token), false);
});

test('respaldarAhora muestra el resultado, bueno o malo', () => {
  const bien = crearEntorno();
  assert.throws(() => bien.contexto.respaldarAhora(), /Respaldo guardado en tu Google Drive/);

  const mal = crearEntorno();
  mal.drive.fallarSubidaCon = 403;
  assert.throws(() => mal.contexto.respaldarAhora(), /NO se guardó[\s\S]*403/);
});

test('/datos dice dónde está el respaldo y cuándo fue el último', () => {
  const e = crearEntorno();
  e.contexto.respaldoSemanalAutomatico();
  e.contexto.manejarTexto('/datos');

  assert.match(e.ultimoTexto(), /Finanzas - Respaldos/);
  assert.match(e.ultimoTexto(), /Último respaldo: hoy/);
  assert.equal(/\/respaldado/.test(e.ultimoTexto()), false, 'ya no pide avisar');
});

// Un 403 puede ser "falta el permiso" o "la API de Drive está apagada en el
// proyecto", y se arreglan distinto. Sin este dato hubo que adivinar en vivo.
test('el mensaje de error incluye el código interno de Google', () => {
  const e = crearEntorno();
  e.drive.fallarSubidaCon = 403;
  e.drive.cuerpoDeError = JSON.stringify({
    error: { errors: [{ reason: 'accessNotConfigured' }], status: 'PERMISSION_DENIED' },
  });

  e.contexto.respaldoSemanalAutomatico();

  assert.match(e.propiedades.RESPALDO_ERROR, /código 403 \(accessNotConfigured\)/);
});

// El código de Google es lo único que sale de su respuesta, así que si ese
// campo trajera otra cosa, esa otra cosa saldría con él.
test('si ese código no tiene forma de código, no sale', () => {
  const e = crearEntorno();
  e.drive.fallarSubidaCon = 403;
  e.drive.cuerpoDeError = JSON.stringify({
    error: { errors: [{ reason: 'alguien@example.com no tiene permiso' }] },
  });

  e.contexto.respaldoSemanalAutomatico();

  assert.equal(e.propiedades.RESPALDO_ERROR.includes('alguien@example.com'), false);
  assert.match(e.propiedades.RESPALDO_ERROR, /código 403\./);
});

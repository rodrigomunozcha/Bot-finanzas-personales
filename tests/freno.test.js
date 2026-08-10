const test = require('node:test');
const assert = require('node:assert');
const { crearEntorno } = require('./ayuda/entorno.js');

const nuevos = (e) => e.enviados.filter((x) => x.metodo === 'sendMessage');
const textos = (e) => nuevos(e).map((x) => x.cuerpo.text);

test('bajo el tope no interfiere con nada', () => {
  const e = crearEntorno({ TOPE_MENSAJES_POR_HORA: '5' });
  for (let i = 0; i < 5; i++) e.contexto.tgEnviar('mensaje ' + i);

  assert.equal(nuevos(e).length, 5);
  assert.equal(textos(e).some((t) => t.includes('Dejé de mandarte mensajes')), false);
});

test('al pasarse avisa una sola vez y después se calla', () => {
  const e = crearEntorno({ TOPE_MENSAJES_POR_HORA: '3' });
  for (let i = 0; i < 20; i++) e.contexto.tgEnviar('mensaje ' + i);

  const enviados = textos(e);
  assert.equal(enviados.length, 4, '3 normales + 1 aviso, y nada más');

  const avisos = enviados.filter((t) => t.includes('Dejé de mandarte mensajes'));
  assert.equal(avisos.length, 1, 'el aviso no se puede repetir');
  assert.match(avisos[0], /\/reanudar/);
});

// El caso que motivó todo esto: un aviso que se reprocesa sin parar.
test('un fallo en bucle se corta en pocos mensajes, no en cientos', () => {
  const e = crearEntorno({ TOPE_MENSAJES_POR_HORA: '10' });
  for (let i = 0; i < 500; i++) e.contexto.tgEnviar('otra vez lo mismo');

  assert.ok(nuevos(e).length <= 11, `se enviaron ${nuevos(e).length}`);
});

test('/reanudar levanta el freno y el bot vuelve a hablar', () => {
  const e = crearEntorno({ TOPE_MENSAJES_POR_HORA: '2' });
  for (let i = 0; i < 10; i++) e.contexto.tgEnviar('mensaje');
  const frenados = nuevos(e).length;

  e.contexto.manejarTexto('/reanudar');
  assert.match(e.ultimoTexto(), /Freno levantado/);

  e.contexto.tgEnviar('después de reanudar');
  assert.equal(nuevos(e).length, frenados + 2, 'la respuesta y el mensaje siguiente pasan');
});

// Editar no genera notificacion en el telefono, asi que no debe gastar cuota.
test('editar un mensaje no consume el tope', () => {
  const e = crearEntorno({ TOPE_MENSAJES_POR_HORA: '2' });
  for (let i = 0; i < 10; i++) e.contexto.tgEditar(1, 'texto editado', []);

  e.contexto.tgEnviar('uno');
  e.contexto.tgEnviar('dos');
  assert.equal(nuevos(e).length, 2, 'las ediciones no gastaron la cuota');
});

test('la ventana se reinicia sola después de una hora', () => {
  const e = crearEntorno({ TOPE_MENSAJES_POR_HORA: '2' });
  for (let i = 0; i < 10; i++) e.contexto.tgEnviar('mensaje');
  const antes = nuevos(e).length;

  // Se envejece la ventana como si hubiera pasado hora y media.
  e.propiedades.FRENO_INICIO = String(Date.now() - 5400000);

  e.contexto.tgEnviar('en la ventana siguiente');
  assert.equal(nuevos(e).length, antes + 1);
});

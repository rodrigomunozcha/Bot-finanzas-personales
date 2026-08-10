const test = require('node:test');
const assert = require('node:assert');
const { crearEntorno } = require('./ayuda/entorno.js');

const COMPRA = {
  asunto: 'Cargo en cuenta',
  cuerpo: 'Te informamos que se ha realizado una compra por $12.500 con cargo a ' +
    'Cuenta ****1234 en JUMBO CENTRAL el 01/08/2026 13:20.',
};

function entra(e, correoId = 'm' + Math.random()) {
  e.contexto.procesarMensaje({
    getId: () => correoId,
    getSubject: () => COMPRA.asunto,
    getPlainBody: () => COMPRA.cuerpo,
  });
}

// Telegram deja el boton girando hasta recibir answerCallbackQuery. Si se manda
// al final, el telefono se ve congelado durante todo el trabajo con la hoja.
test('la pulsación se confirma antes de tocar la hoja de cálculo', () => {
  const e = crearEntorno();
  entra(e);
  const antes = e.enviados.length;

  e.apretar('Sí, guardar así');

  const primera = e.enviados[antes];
  assert.equal(primera.metodo, 'answerCallbackQuery',
    'lo primero tras apretar debe ser confirmarle a Telegram');
});

test('cada pulsación se confirma una sola vez', () => {
  const e = crearEntorno();
  entra(e);
  const antes = e.enviados.length;

  e.apretar('Sí, guardar así');

  const confirmaciones = e.enviados.slice(antes)
    .filter((x) => x.metodo === 'answerCallbackQuery');
  assert.equal(confirmaciones.length, 1,
    'Telegram rechaza que se confirme dos veces la misma pulsación');
});

test('el botón Terminar deja el mensaje sin teclado', () => {
  const e = crearEntorno();
  entra(e);
  e.apretar('Sí, guardar así');
  e.apretar('Listo, quitar botones');

  const teclado = e.ultimoTeclado();
  assert.deepEqual(teclado, [], 'no deben quedar botones');
  assert.match(e.ultimoTexto(), /JUMBO CENTRAL/);
  assert.match(e.ultimoTexto(), /🍴 Alimentación/);
});

test('Terminar conserva la nota si había una', () => {
  const e = crearEntorno();
  entra(e);
  e.apretar('Sí, guardar así');
  e.apretar('Agregar nota');
  e.contexto.manejarTexto('el asado del domingo');
  e.apretar('Listo, quitar botones');

  assert.match(e.ultimoTexto(), /📝 el asado del domingo/);
});

test('el botón dice "Cambiar categoría", no solo "Cambiar"', () => {
  const e = crearEntorno();
  entra(e);

  const textos = e.ultimoTeclado().flat().map((b) => b.text);
  assert.ok(textos.includes('✏️ Cambiar categoría'));
});

// Sin memoria, cada hoja() reabria el archivo entero. Era casi toda la demora.
test('el libro se abre una sola vez por ejecución', () => {
  let aperturas = 0;
  const e = crearEntorno();
  const original = e.contexto.SpreadsheetApp.openById;
  e.contexto.SpreadsheetApp.openById = function (id) {
    aperturas++;
    return original(id);
  };

  entra(e);
  e.apretar('Sí, guardar así');

  assert.equal(aperturas, 1, `se abrió ${aperturas} veces`);
});

// La cache guarda el movimiento al crearlo, asi que responder a un boton no
// necesita abrir la planilla. Abrirla es cerca de un segundo de espera.
test('apretar un botón no abre la planilla si el gasto está en caché', () => {
  const e = crearEntorno();
  entra(e);

  let aperturas = 0;
  const original = e.contexto.SpreadsheetApp.openById;
  e.contexto.SpreadsheetApp.openById = function (id) {
    aperturas++;
    return original(id);
  };

  const costo = e.medir(() => e.apretar('Sí, guardar así'));

  assert.equal(costo.lecturas, 0, 'no debe leer nada de la hoja para responder');
  assert.ok(aperturas <= 1, `abrió la planilla ${aperturas} veces`);
});

// El usuario tiene que ver el resultado antes de que empiece lo lento.
test('el mensaje se edita antes de escribir en la planilla', () => {
  const e = crearEntorno();
  entra(e);

  const orden = [];
  const editarOriginal = e.contexto.tgEditar;
  const guardarOriginal = e.contexto.guardarMovimiento;
  e.contexto.tgEditar = function (...args) { orden.push('editar'); return editarOriginal(...args); };
  e.contexto.guardarMovimiento = function (...args) { orden.push('guardar'); return guardarOriginal(...args); };

  e.apretar('Sí, guardar así');

  assert.equal(orden[0], 'editar', `el orden fue ${orden.join(' → ')}`);
});

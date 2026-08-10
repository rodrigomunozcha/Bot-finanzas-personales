const test = require('node:test');
const assert = require('node:assert');
const { crearEntorno } = require('./ayuda/entorno.js');

const cuerpo = (comercio) =>
  'Te informamos que se ha realizado una compra por $12.500 con cargo a ' +
  'Cuenta ****1234 en ' + comercio + ' el 01/08/2026 13:20.';

function entra(e, comercio, id) {
  e.contexto.procesarMensaje({
    getId: () => id,
    getSubject: () => 'Cargo en cuenta',
    getPlainBody: () => cuerpo(comercio),
  });
}

/**
 * Cada lectura o escritura contra Sheets cuesta cerca de un segundo en Apps
 * Script, y es casi toda la demora que se siente en el telefono. Estos topes
 * estan para que una mejora futura no meta de vuelta una lectura extra sin que
 * nadie se de cuenta.
 */
function entornoConDatos() {
  const e = crearEntorno();
  for (let i = 0; i < 5; i++) {
    entra(e, 'COMERCIO ' + i, 'previo' + i);
    e.apretar('🍴 Alimentación');
    e.apretar('Guardar sin subcategoría');
  }
  return e;
}

test('un gasto entrante cuesta a lo más 2 lecturas y 1 escritura', () => {
  const e = entornoConDatos();
  const costo = e.medir(() => entra(e, 'JUMBO CENTRAL', 'nuevo'));

  assert.ok(costo.lecturas <= 2, `lecturas: ${costo.lecturas}`);
  assert.ok(costo.escrituras <= 1, `escrituras: ${costo.escrituras}`);
});

test('apretar un botón cuesta a lo más 3 lecturas y 2 escrituras', () => {
  const e = entornoConDatos();
  entra(e, 'JUMBO CENTRAL', 'nuevo');
  const costo = e.medir(() => e.apretar('Sí, guardar así'));

  assert.ok(costo.lecturas <= 3, `lecturas: ${costo.lecturas}`);
  assert.ok(costo.escrituras <= 2, `escrituras: ${costo.escrituras}`);
});

test('el índice de filas se rehace después de agregar o borrar', () => {
  const e = entornoConDatos();
  entra(e, 'JUMBO CENTRAL', 'nuevo');
  e.apretar('Sí, guardar así');

  // Si el indice quedara viejo, /olvidar borraria la fila equivocada.
  e.contexto.manejarTexto('/olvidar COMERCIO 3');
  const quedan = e.aprendizaje().map((a) => a.comercio);

  assert.equal(quedan.includes('COMERCIO 3'), false);
  assert.equal(quedan.includes('JUMBO CENTRAL'), true);
  assert.equal(quedan.length, 5);
});

const test = require('node:test');
const assert = require('node:assert');
const c = require('../apps_script/clasificador.js');

test('el numero de local no crea un comercio distinto', () => {
  const esperado = 'JUMBO CENTRAL';
  for (const bruto of ['JUMBO CENTRAL', 'JUMBO CENTRAL 0111', 'jumbo  central ', 'JUMBO*CENTRAL']) {
    assert.equal(c.normalizarComercio(bruto), esperado, bruto);
  }
});

test('comercio desconocido no propone nada', () => {
  assert.equal(c.proponerClasificacion('ALMACEN DON JOSE', {}), null);
});

test('la semilla propone pero nunca clasifica sola', () => {
  const r = c.proponerClasificacion('JUMBO CENTRAL', {});
  assert.equal(r.categoria, '🍴 Alimentación');
  assert.equal(r.subcategoria, '🛒 Supermercado');
  assert.equal(r.origen, 'semilla');
  assert.equal(r.automatico, false, 'la semilla es un supuesto, no una confirmacion del usuario');
});

test('lo aprendido gana sobre la semilla', () => {
  const aprendizaje = {
    'JUMBO CENTRAL': { categoria: '🎁 Regalos', subcategoria: null, confirmaciones: 1 },
  };
  const r = c.proponerClasificacion('JUMBO CENTRAL', aprendizaje);
  assert.equal(r.categoria, '🎁 Regalos');
  assert.equal(r.origen, 'aprendido');
});

test('a la tercera confirmacion deja de preguntar', () => {
  let aprendizaje = {};
  for (let i = 1; i <= 3; i++) {
    const r = c.registrarRespuesta(aprendizaje, 'JUMBO CENTRAL', '🍴 Alimentación', '🛒 Supermercado');
    assert.equal(r.confirmaciones, i);
    aprendizaje[r.comercio] = r;
  }
  assert.equal(c.proponerClasificacion('JUMBO CENTRAL', aprendizaje).automatico, true);
  assert.equal(c.faltanParaAutomatico(3), 0);
  assert.equal(c.faltanParaAutomatico(1), 2);
});

// Sin esto, un comercio con historial viejo seguiria clasificandose solo con la
// categoria equivocada aunque el usuario ya la hubiera corregido.
test('corregir la categoria reinicia la cuenta', () => {
  const aprendizaje = {
    'UBER EATS': { categoria: '🚖 Transporte', subcategoria: '🚕 Uber u otro', confirmaciones: 5 },
  };
  const r = c.registrarRespuesta(aprendizaje, 'UBER EATS', '🍴 Alimentación', '🛵 Delivery');
  assert.equal(r.confirmaciones, 1, 'una correccion no hereda las confirmaciones anteriores');

  aprendizaje[r.comercio] = r;
  assert.equal(c.proponerClasificacion('UBER EATS', aprendizaje).automatico, false);
});

test('cambiar solo la subcategoria tambien reinicia', () => {
  const aprendizaje = {
    JUMBO: { categoria: '🍴 Alimentación', subcategoria: '🛒 Supermercado', confirmaciones: 4 },
  };
  const r = c.registrarRespuesta(aprendizaje, 'JUMBO', '🍴 Alimentación', '🥗 Feria / Mercado');
  assert.equal(r.confirmaciones, 1);
});

test('UBER EATS no cae en Transporte por culpa de UBER', () => {
  const r = c.proponerClasificacion('UBER EATS SPA', {});
  assert.equal(r.categoria, '🍴 Alimentación');
  assert.equal(r.subcategoria, '🛵 Delivery');
});

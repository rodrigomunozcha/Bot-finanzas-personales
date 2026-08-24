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

// --- Categorías que el usuario agrega desde el bot -------------------------

test('nombreDeCategoriaValido limpia espacios sobrantes', () => {
  assert.equal(c.nombreDeCategoriaValido('  🐾 Mascotas  '), '🐾 Mascotas');
  assert.equal(c.nombreDeCategoriaValido('Con    varios   espacios'), 'Con varios espacios');
});

test('nombreDeCategoriaValido rechaza vacío y nombres demasiado largos', () => {
  assert.equal(c.nombreDeCategoriaValido(''), null);
  assert.equal(c.nombreDeCategoriaValido('   '), null);
  assert.equal(c.nombreDeCategoriaValido('a'.repeat(c.MAX_LARGO_CATEGORIA + 1)), null);
  assert.ok(c.nombreDeCategoriaValido('a'.repeat(c.MAX_LARGO_CATEGORIA)));
});

test('claveDeCategoria hace que mayúsculas y espacios no cuenten como distinto', () => {
  assert.equal(c.claveDeCategoria('Mascotas'), c.claveDeCategoria('  mascotas '));
  assert.equal(c.claveDeCategoria('Mascotas'), c.claveDeCategoria('MASCOTAS'));
});

const ARBOL_BASE = [
  { nombre: '🍴 Alimentación', subcategorias: ['🛒 Supermercado', '🥗 Feria'] },
  { nombre: '🎁 Regalos', subcategorias: [] },
];

test('arbolConPersonalizadas agrega una categoría nueva al final', () => {
  const arbol = c.arbolConPersonalizadas(ARBOL_BASE, [
    { categoria: '🐾 Mascotas', subcategoria: '' },
  ]);
  assert.equal(arbol.length, 3);
  assert.equal(arbol[2].nombre, '🐾 Mascotas');
  assert.deepEqual(arbol[2].subcategorias, []);
});

test('arbolConPersonalizadas agrega una subcategoría a una categoría que ya existía', () => {
  const arbol = c.arbolConPersonalizadas(ARBOL_BASE, [
    { categoria: '🎁 Regalos', subcategoria: 'Cumpleaños' },
  ]);
  assert.equal(arbol.length, 2, 'no debe crear una categoría duplicada');
  assert.deepEqual(arbol[1].subcategorias, ['Cumpleaños']);
});

// El mismo emoji, distinta mayúscula o espacios: cuenta como la misma
// categoría. Un emoji distinto o ausente, en cambio, cuenta como otra: eso se
// prueba aparte, porque es la decisión de diseño contraria.
test('arbolConPersonalizadas no duplica si cambia solo mayúsculas o espacios', () => {
  const arbol = c.arbolConPersonalizadas(ARBOL_BASE, [
    { categoria: '  🍴 alimentación  ', subcategoria: '' },
    { categoria: '🍴 ALIMENTACIÓN', subcategoria: '🛒 SUPERMERCADO' },
  ]);
  assert.equal(arbol.length, 2, 'el mismo emoji con otra capitalización es la misma categoría');
  assert.deepEqual(arbol[0].subcategorias, ['🛒 Supermercado', '🥗 Feria'],
    'la subcategoría ya existía con otra capitalización, no se duplica');
});

test('un emoji distinto, o ninguno, sí cuenta como categoría distinta', () => {
  const arbol = c.arbolConPersonalizadas(ARBOL_BASE, [
    { categoria: 'Alimentación', subcategoria: '' },
  ]);
  assert.equal(arbol.length, 3, 'sin el emoji del banco, es una categoría nueva a propósito');
});

test('arbolConPersonalizadas no modifica el arbol original', () => {
  const copia = JSON.parse(JSON.stringify(ARBOL_BASE));
  c.arbolConPersonalizadas(ARBOL_BASE, [{ categoria: '🐾 Mascotas', subcategoria: '' }]);
  assert.deepEqual(ARBOL_BASE, copia);
});

test('una categoría nueva agregada dos veces en la misma corrida no se duplica', () => {
  const arbol = c.arbolConPersonalizadas(ARBOL_BASE, [
    { categoria: '🐾 Mascotas', subcategoria: 'Veterinario' },
    { categoria: '🐾 Mascotas', subcategoria: 'Comida' },
  ]);
  assert.equal(arbol.length, 3);
  assert.deepEqual(arbol[2].subcategorias, ['Veterinario', 'Comida']);
});

test('indiceDeCategoria encuentra por nombre sin importar mayúsculas', () => {
  assert.equal(c.indiceDeCategoria(ARBOL_BASE, '🎁 regalos'), 1);
  assert.equal(c.indiceDeCategoria(ARBOL_BASE, 'no existe'), -1);
});

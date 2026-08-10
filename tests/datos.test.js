const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', 'datos');
const leer = (n) => JSON.parse(fs.readFileSync(path.join(raiz, n), 'utf8'));

const gasto = leer('categorias_gasto.json');
const ingreso = leer('categorias_ingreso.json');
const semilla = leer('comercios_semilla.json');

test('el arbol de gasto conserva lo que habia en Money Manager', () => {
  assert.equal(gasto.length, 12, '12 categorias raiz');
  const subs = gasto.reduce((n, c) => n + c.subcategorias.length, 0);
  assert.equal(subs, 39, '39 subcategorias');
});

test('ninguna categoria ni subcategoria viene repetida', () => {
  for (const arbol of [gasto, ingreso]) {
    const raices = arbol.map((c) => c.nombre);
    assert.equal(new Set(raices).size, raices.length);
    for (const c of arbol) {
      assert.equal(new Set(c.subcategorias).size, c.subcategorias.length, c.nombre);
    }
  }
});

// Sin esta prueba, un dedazo en un emoji o un espacio de mas dejaria un comercio
// apuntando a una categoria inexistente, y el bot fallaria recien al usarlo.
test('cada regla de la semilla apunta a una categoria que existe', () => {
  const porNombre = new Map(gasto.map((c) => [c.nombre, c.subcategorias]));
  for (const r of semilla.reglas) {
    assert.ok(porNombre.has(r.categoria), `categoria inexistente: "${r.categoria}" (${r.patron})`);
    if (r.subcategoria !== null) {
      assert.ok(
        porNombre.get(r.categoria).includes(r.subcategoria),
        `subcategoria inexistente: "${r.subcategoria}" en "${r.categoria}" (${r.patron})`
      );
    }
  }
});

test('no hay dos reglas con el mismo patron', () => {
  const patrones = semilla.reglas.map((r) => r.patron);
  assert.equal(new Set(patrones).size, patrones.length);
});

// Con busqueda por subcadena, un patron contenido en otro tapa al mas especifico
// si queda antes en la lista. Ejemplo: "UBER" antes que "UBER EATS" mandaria
// todos los delivery a Transporte.
test('los patrones especificos van antes que los genericos que los contienen', () => {
  const patrones = semilla.reglas.map((r) => r.patron);
  patrones.forEach((generico, i) => {
    patrones.forEach((especifico, j) => {
      if (i < j && especifico !== generico && especifico.includes(generico)) {
        assert.fail(`"${generico}" (posicion ${i}) tapa a "${especifico}" (posicion ${j})`);
      }
    });
  });
});

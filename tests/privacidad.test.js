const test = require('node:test');
const assert = require('node:assert');
const p = require('../apps_script/parsers.js');
const { crearEntorno } = require('./ayuda/entorno.js');

test('se tachan RUT, correo y número de cuenta', () => {
  const censurado = p.censurarDatosPersonales(
    'Rut 12.345.678-9 y tambien 12345678-9, correo alguien@gmail.com, ' +
    'Cuenta Corriente 00-000-00000-00, telefono 900000000'
  );

  for (const dato of ['12.345.678-9', '12345678-9', 'alguien@gmail.com',
    '00-000-00000-00', '900000000']) {
    assert.equal(censurado.includes(dato), false, `quedó sin tachar: ${dato}`);
  }
});

// El extracto existe para poder escribir despues el lector que falta, asi que
// tiene que seguir mostrando la forma del correo y los montos.
test('los montos y el texto sobreviven a la censura', () => {
  const censurado = p.censurarDatosPersonales(
    'Te informamos que se realizó una transferencia por $185.000 el 01/08/2026'
  );
  assert.match(censurado, /\$185\.000/);
  assert.match(censurado, /01\/08\/2026/);
  assert.match(censurado, /Te informamos/);
});

test('un correo no reconocido se guarda sin datos personales', () => {
  const e = crearEntorno();
  e.contexto.procesarMensaje({
    getId: () => 'desconocido',
    getSubject: () => 'Aviso nuevo del banco',
    getPlainBody: () => 'Estimado Nombre Apellido, rut 11.111.111-1, ' +
      'cuenta 00-000-00000-00, correo alguien@example.com. Monto $50.000.',
  });

  const [, ...filas] = e.hojas.no_entendidos._filas;
  assert.equal(filas.length, 1);

  const extracto = filas[0][3];
  for (const dato of ['11.111.111-1', '00-000-00000-00', 'alguien@example.com']) {
    assert.equal(extracto.includes(dato), false, `se guardó en la hoja: ${dato}`);
  }
  assert.match(extracto, /\$50\.000/, 'el monto sí debe quedar, sirve para el lector');
});

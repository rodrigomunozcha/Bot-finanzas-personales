/**
 * La red que impide que un dato de una persona entre a este sistema.
 *
 * Esto no es una prueba más: es la que existe para que no vuelva a pasar.
 *
 * Ya pasó tres veces. La última fue así: el lector de transferencias enviadas
 * tomaba el campo "Mensaje" del correo y lo usaba como nombre de comercio. En
 * un correo real ese mensaje era la dirección de una vivienda,
 * escrita para que quien recibía el pago supiera quién le había pagado. Esa dirección
 * iba a quedar en la hoja de movimientos, en la tabla de aprendizaje, en el
 * mensaje de Telegram y en el respaldo local, y ninguna de las 169 pruebas que
 * había en ese momento se habría dado cuenta.
 *
 * El intento anterior de resolverlo fue una lista negra: una función que
 * tachaba lo que parecía sensible con expresiones regulares. No sirve. Un RUT
 * tiene forma, un correo tiene forma, un número de cuenta tiene forma. Un
 * nombre propio y una dirección no tienen ninguna, y salían intactos.
 *
 * Así que el enfoque es al revés y esta prueba lo verifica de dos maneras:
 *
 *   1. Lista blanca de campos. Un lector solo puede devolver lo que está en
 *      CAMPOS_PERMITIDOS. Lo demás se descarta antes de salir de parsers.js.
 *   2. Canarios. Cada formato de correo se alimenta con datos sensibles metidos
 *      en todos sus huecos de texto libre, y se comprueba que ninguno aparece
 *      ni en la lectura, ni en las hojas, ni en lo que se manda a Telegram.
 *
 * Si alguien escribe un lector nuevo que extraiga texto libre, esta prueba
 * falla. Ese es todo su propósito.
 */

const test = require('node:test');
const assert = require('node:assert');
const p = require('../apps_script/parsers.js');
const { crearEntorno } = require('./ayuda/entorno.js');

/**
 * Datos sensibles inventados, uno por cada tipo que puede aparecer en un correo
 * del banco. Ninguno es real. Se meten en el cuerpo y no pueden salir por
 * ningún lado.
 */
const CANARIOS = [
  'Nombre Inventado',       // titular de la cuenta
  'Otra Persona Falsa',     // la persona del otro lado
  '11.111.111-1',           // RUT con puntos
  '11111111-1',             // RUT sin puntos
  '00-000-00000-00',        // número de cuenta
  'alguien@example.com',    // correo
  'Depto 000 Calle Falsa',  // dirección, el caso que se escapó de verdad
  '+56900000000',           // teléfono
  'Banco Inventado',        // con quién se banquea
];

/** Mete todos los canarios en un texto, separados por espacios. */
const todosLosCanarios = () => CANARIOS.join(' ');

/**
 * Un correo de cada formato, con canarios en todos los huecos de texto libre.
 *
 * La compra con tarjeta es el único caso donde el nombre SÍ se extrae, y es a
 * propósito: ahí el texto es el nombre de un comercio, lo escribe el banco y es
 * el dato central del sistema. Por eso su canario va en el texto de alrededor,
 * no en el hueco del comercio.
 */
const CORREOS = [
  {
    nombre: 'compra con tarjeta',
    asunto: 'Cargo en cuenta',
    cuerpo: 'Estimado ' + todosLosCanarios() + '. Te informamos que se ha ' +
      'realizado una compra por $12.500 con cargo a Cuenta ****1234 en ' +
      'JUMBO CENTRAL el 01/08/2026 13:20. ' + todosLosCanarios(),
  },
  {
    nombre: 'transferencia recibida',
    asunto: 'Aviso de transferencia de fondos',
    cuerpo: 'Comprobante de transferencia electrónica de fondos Estimado(a): ' +
      'Nombre Inventado Te informamos que nuestro(a) cliente Otra Persona Falsa ' +
      'ha efectuado una transferencia de fondos a tu cuenta con el siguiente ' +
      'detalle: Datos de cuenta Fecha Asunto 01/08/2026 Depto 000 Calle Falsa ' +
      'Datos de destinatario Nombre y Apellido Rut Email Banco Cuenta destino ' +
      'Nombre Inventado 11111111-1 alguien@example.com Banco Inventado ' +
      'Cuenta Corriente 00-000-00000-00 Monto $185.000',
  },
  {
    nombre: 'transferencia enviada',
    asunto: 'Comprobante de Transferencia a terceros',
    cuerpo: `Comprobante de Transferencia a terceros
Estimado(a): Nombre Inventado
Te informamos que has realizado una Transferencia a terceros en forma exitosa con el siguiente detalle:
Origen
Tipo de Cuenta 	Cuenta Corriente
Nº de Cuenta 	00-000-00000-00
Destino
Nombre y Apellido 	Otra Persona Falsa
Rut 	11.111.111-1
Tipo de Cuenta 	Cuenta Vista
Nº de Cuenta 	00-000-00000-00
Banco 	Banco Inventado
Email 	alguien@example.com
Monto 	$40.000
Mensaje 	Depto 000 Calle Falsa +56900000000

 Fecha y Hora:

martes 11 de agosto de 2026 17:08`,
  },
  {
    nombre: 'pago de tarjeta internacional',
    asunto: 'Comprobante pago Tarjeta de Crédito Internacional',
    cuerpo: 'Estimado ' + todosLosCanarios() + ' Monto pagado US$150,00 ' +
      'Utilizado US$0,00 Tipo de cambio $949 Monto $142.403 ' +
      '01 de agosto de 2026 10:30 ' + todosLosCanarios(),
  },
];

/** Falla nombrando el canario y el lugar exacto donde se escapó. */
function sinCanarios(texto, donde) {
  const plano = String(texto);
  for (const canario of CANARIOS) {
    assert.equal(plano.includes(canario), false,
      `se escapó "${canario}" a ${donde}`);
  }
}

// --- 1. Lista blanca de campos ---------------------------------------------

test('ningún lector puede devolver un campo fuera de la lista blanca', () => {
  for (const correo of CORREOS) {
    const lectura = correo.nombre === 'pago de tarjeta internacional'
      ? require('../apps_script/tarjeta.js').leerPagoTarjeta(correo.asunto, correo.cuerpo)
      : p.leerCorreo(correo.asunto, correo.cuerpo);

    assert.ok(lectura, `no reconoció el correo de ${correo.nombre}`);

    const permitidos = correo.nombre === 'pago de tarjeta internacional'
      ? p.CAMPOS_PERMITIDOS_PAGO : p.CAMPOS_PERMITIDOS;

    for (const campo of Object.keys(lectura)) {
      assert.ok(permitidos.includes(campo),
        `${correo.nombre} devolvió el campo "${campo}", que no está permitido`);
    }
  }
});

// Es lo que protege de un lector futuro escrito sin cuidado: aunque devuelva el
// dato, no llega a salir del archivo.
test('un campo que no está en la lista se descarta, no se filtra', () => {
  const colada = p.soloCamposPermitidos({
    monto: 40000,
    comercio: 'JUMBO CENTRAL',
    remitente: 'Otra Persona Falsa',
    glosa: 'Depto 000 Calle Falsa',
    rutDestinatario: '11111111-1',
  });

  assert.equal(colada.monto, 40000);
  assert.equal(colada.comercio, 'JUMBO CENTRAL');
  assert.equal(colada.remitente, undefined);
  assert.equal(colada.glosa, undefined);
  assert.equal(colada.rutDestinatario, undefined);
  sinCanarios(JSON.stringify(colada), 'la salida del colador');
});

// --- 2. Canarios en la lectura ---------------------------------------------

for (const correo of CORREOS) {
  test(`${correo.nombre}: ningún dato sensible sale del lector`, () => {
    const lectura = correo.nombre === 'pago de tarjeta internacional'
      ? require('../apps_script/tarjeta.js').leerPagoTarjeta(correo.asunto, correo.cuerpo)
      : p.leerCorreo(correo.asunto, correo.cuerpo);

    assert.ok(lectura, 'no reconoció el correo');
    sinCanarios(JSON.stringify(lectura), `la lectura de ${correo.nombre}`);
  });
}

// --- 3. Canarios en todo el sistema ----------------------------------------

test('ningún dato sensible llega a las hojas ni a Telegram', () => {
  for (const correo of CORREOS) {
    const e = crearEntorno();
    e.contexto.procesarMensaje({
      getId: () => 'canario-' + correo.nombre,
      getSubject: () => correo.asunto,
      getPlainBody: () => correo.cuerpo,
    });

    sinCanarios(JSON.stringify(e.hojas), `las hojas, con ${correo.nombre}`);
    sinCanarios(JSON.stringify(e.enviados), `Telegram, con ${correo.nombre}`);
    sinCanarios(JSON.stringify(e.propiedades),
      `las propiedades del script, con ${correo.nombre}`);
  }
});

// El caso completo, hasta el final: clasificar también escribe, y escribe en
// dos sitios (movimientos y aprendizaje).
test('clasificar una transferencia tampoco escribe nada sensible', () => {
  const enviada = CORREOS.find((c) => c.nombre === 'transferencia enviada');
  const e = crearEntorno();
  e.contexto.procesarMensaje({
    getId: () => 'canario-cierre',
    getSubject: () => enviada.asunto,
    getPlainBody: () => enviada.cuerpo,
  });

  e.apretar('🏠 Hogar');
  e.apretar('Guardar sin subcategoría');

  sinCanarios(JSON.stringify(e.hojas), 'las hojas después de clasificar');
  sinCanarios(JSON.stringify(e.enviados), 'Telegram después de clasificar');
});

// --- 4. El correo que no se entiende ---------------------------------------

test('de un correo que no se entiende no se guarda ni una palabra del cuerpo', () => {
  const e = crearEntorno();
  const cuerpo = 'Aviso nuevo del banco. ' + todosLosCanarios() +
    ' Monto $50.000. Referencia interna 987654321.';

  e.contexto.procesarMensaje({
    getId: () => 'formato-desconocido',
    getSubject: () => 'Aviso nuevo del banco',
    getPlainBody: () => cuerpo,
  });

  const [, ...filas] = e.hojas.no_entendidos._filas;
  assert.equal(filas.length, 1, 'el correo no se puede perder en silencio');

  // Queda el asunto, para saber qué formato falta.
  assert.equal(filas[0][1], 'Aviso nuevo del banco');

  sinCanarios(JSON.stringify(filas), 'la hoja de correos no entendidos');

  // Antes se guardaba un extracto de 400 caracteres del cuerpo. Ya no se
  // guarda nada del cuerpo, ni siquiera lo que parece inofensivo.
  const guardado = JSON.stringify(filas);
  assert.equal(guardado.includes('987654321'), false, 'quedó texto del cuerpo');
  assert.equal(guardado.includes('$50.000'), false, 'quedó texto del cuerpo');
});

// La función que tachaba con expresiones regulares se borró. Esta prueba existe
// para que no vuelva: mientras exista, alguien la va a usar creyendo que basta.
test('ya no existe ninguna función que "tache" datos sensibles', () => {
  assert.equal(p.censurarDatosPersonales, undefined,
    'tachar es una lista negra y los nombres no tienen forma reconocible');
});

// --- 5. Que el usuario se entere de que hay que limpiar --------------------
//
// La función de limpieza no sirve de nada si hay que saber su nombre de memoria
// para encontrarla entre las de un desplegable. revisarSalud la nombra sola, y
// solo cuando hay algo que limpiar.

/** Corre revisarSalud, que reporta lanzando una excepción a propósito. */
function saludComoTexto(e) {
  try {
    e.contexto.revisarSalud();
  } catch (error) {
    return String(error.message);
  }
  return '';
}

test('revisarSalud avisa y nombra la función cuando hay texto viejo guardado', () => {
  const e = crearEntorno();
  e.hojas.no_entendidos._filas.push([
    new Date(), 'Aviso viejo del banco', 'id-viejo',
    'Estimado Nombre Inventado, cuenta 00-000-00000-00, Monto $50.000',
  ]);

  const texto = saludComoTexto(e);
  assert.match(texto, /HAY TEXTO DE CORREOS GUARDADO DE ANTES/);
  assert.match(texto, /limpiarContenidoDeCorreosGuardado/,
    'tiene que decir el nombre exacto, no "una función de limpieza"');
  assert.match(texto, /Ejecutar/, 'y dónde apretar');
});

test('sin texto viejo guardado, revisarSalud no molesta con ese aviso', () => {
  const e = crearEntorno();
  e.hojas.no_entendidos._filas.push([
    new Date(), 'Aviso nuevo', 'id-nuevo',
    'https://mail.google.com/mail/u/0/#inbox/abc123',
  ]);

  assert.equal(saludComoTexto(e).includes('HAY TEXTO DE CORREOS'), false);
});

test('la limpieza deja el asunto y borra el texto del correo', () => {
  const e = crearEntorno();
  e.hojas.no_entendidos._filas.push([
    new Date(), 'Aviso viejo del banco', 'id-viejo',
    'Estimado Nombre Inventado, Depto 000 Calle Falsa, Monto $50.000',
  ]);

  try { e.contexto.limpiarContenidoDeCorreosGuardado(); } catch (error) { /* reporta lanzando */ }

  const fila = e.hojas.no_entendidos._filas[1];
  assert.equal(fila[1], 'Aviso viejo del banco', 'el asunto sirve y se queda');
  assert.equal(String(fila[3] || ''), '', 'el texto del correo se va');
  sinCanarios(JSON.stringify(e.hojas.no_entendidos._filas), 'la hoja ya limpiada');
});

// --- 6. La pantalla de diagnóstico -----------------------------------------
//
// revisarSalud es la pantalla que uno copia y pega cuando pide ayuda con algo
// que no anda. Todo lo que muestre se va a repartir, así que no puede mostrar
// identificadores enteros. Antes tapaba solo el token.

test('revisarSalud no muestra entero ningún identificador', () => {
  const e = crearEntorno();
  const TOKEN = '8000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const CHAT_ID = '1234567890';
  const HOJA_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

  Object.assign(e.propiedades, {
    TELEGRAM_TOKEN: TOKEN,
    TELEGRAM_CHAT_ID: CHAT_ID,
    HOJA_ID: HOJA_ID,
  });

  const texto = saludComoTexto(e);

  for (const secreto of [TOKEN, CHAT_ID, HOJA_ID]) {
    assert.equal(texto.includes(secreto), false,
      `se mostró entero: ${secreto.substring(0, 6)}...`);
  }

  // Pero sigue sirviendo para diagnosticar: se ve que están puestos y cuánto
  // miden, que es con lo que se caza un carácter perdido al copiar.
  assert.match(texto, /TELEGRAM_TOKEN = 8000…/, 'de un valor largo se ven 4');
  assert.match(texto, /TELEGRAM_CHAT_ID = •••/, 'de uno corto, ninguno');
  assert.match(texto, /10 caracteres/, 'el largo del chat id sí se ve');
  assert.match(texto, new RegExp(TOKEN.length + ' caracteres'), 'y el del token también');
});

test('revisarSalud sigue avisando si falta un valor o trae espacios', () => {
  const e = crearEntorno();
  Object.assign(e.propiedades, {
    TELEGRAM_TOKEN: '8000000000:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA ',
    TELEGRAM_CHAT_ID: '',
  });

  const texto = saludComoTexto(e);
  assert.match(texto, /FALTA: TELEGRAM_CHAT_ID/);
  assert.match(texto, /OJO: tiene espacios sobrantes/);
});

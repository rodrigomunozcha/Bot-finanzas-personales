const test = require('node:test');
const assert = require('node:assert');
const { crearEntorno } = require('./ayuda/entorno.js');

const MIO = 999;

const texto = (id, contenido, chat = MIO) => ({
  update_id: id,
  message: { chat: { id: chat }, text: contenido },
});

const nuevos = (e) => e.enviados.filter((x) => x.metodo === 'sendMessage');

test('un aviso de texto se atiende al consultar', () => {
  const e = crearEntorno();
  e.encolarAvisos(texto(10, '/pendientes'));

  e.contexto.revisarTelegram();

  assert.match(e.ultimoTexto(), /Nada pendiente/);
});

// El offset es lo que le confirma a Telegram que puede descartar el aviso.
// Sin esto la cola no se vacía nunca, que es justo el problema del webhook.
test('el offset avanza para confirmarle la entrega a Telegram', () => {
  const e = crearEntorno();
  e.encolarAvisos(texto(10, '/pendientes'), texto(11, '/pendientes'));

  e.contexto.revisarTelegram();
  assert.equal(e.offset(), 12, 'debe quedar en el mayor recibido más uno');
});

test('lo ya atendido no se vuelve a atender en la consulta siguiente', () => {
  const e = crearEntorno();
  e.encolarAvisos(texto(10, '/pendientes'));

  e.contexto.revisarTelegram();
  const despuesDeLaPrimera = nuevos(e).length;

  e.contexto.revisarTelegram();
  e.contexto.revisarTelegram();

  assert.equal(nuevos(e).length, despuesDeLaPrimera, 'no debe repetir la respuesta');
});

test('los avisos de otro chat se ignoran', () => {
  const e = crearEntorno();
  e.encolarAvisos(texto(10, '/pendientes', 12345));

  e.contexto.revisarTelegram();

  assert.equal(nuevos(e).length, 0, 'no se responde a desconocidos');
  assert.equal(e.offset(), 11, 'pero igual se confirma, para que no quede atascado');
});

// Un aviso que revienta no puede quedar reintentándose para siempre: sería
// volver al problema de los mensajes repetidos toda la noche.
test('un aviso que falla no bloquea a los siguientes', () => {
  const e = crearEntorno();
  let veces = 0;
  const original = e.contexto.manejarTexto;
  e.contexto.manejarTexto = function (t) {
    veces++;
    if (veces === 1) throw new Error('se rompió el primero');
    return original(t);
  };

  e.encolarAvisos(texto(10, '/pendientes'), texto(11, '/pendientes'));
  e.contexto.revisarTelegram();

  assert.match(nuevos(e)[0].cuerpo.text, /Se cayó algo/);
  assert.match(e.ultimoTexto(), /Nada pendiente/, 'el segundo sí se atendió');
  assert.equal(e.offset(), 12, 'el offset avanza pese a la falla');
});

test('sin avisos nuevos no se hace nada', () => {
  const e = crearEntorno();
  e.contexto.revisarTelegram();

  assert.equal(nuevos(e).length, 0);
  assert.equal(e.offset(), 0, 'no se mueve el offset si no llegó nada');
});

// --- Ritmo de consulta -----------------------------------------------------

const consultas = (e) => e.enviados.filter((x) => x.metodo === 'getUpdates').length;

// Este es el caso de casi todo el día. Tiene que ser barato o se agota la cuota.
test('sin nada que hacer consulta una sola vez y sale', () => {
  const e = crearEntorno();
  e.contexto.revisarTelegram();

  assert.equal(consultas(e), 1);
});

// Un gasto son tres toques. A una consulta por minuto eso son tres minutos de
// espera, que es justo lo que hacía frustrante usarlo.
test('con conversación en curso consulta muchas veces en la misma pasada', () => {
  const e = crearEntorno();
  e.encolarAvisos(texto(10, '/pendientes'));

  e.contexto.revisarTelegram();

  assert.ok(consultas(e) > 10, `solo consultó ${consultas(e)} veces`);
});

test('la conversación se da por terminada tras dos minutos sin nada', () => {
  const e = crearEntorno();
  e.contexto.marcarConversacion();
  assert.equal(e.contexto.hayConversacionEnCurso(), true);

  e.adelantarReloj(130000);
  assert.equal(e.contexto.hayConversacionEnCurso(), false);
});

// Un gasto recién anunciado significa que viene una respuesta enseguida.
test('anunciar un gasto abre conversación para responder rápido', () => {
  const e = crearEntorno();
  e.contexto.procesarMensaje({
    getId: () => 'x1',
    getSubject: () => 'Cargo en cuenta',
    getPlainBody: () => 'Te informamos que se ha realizado una compra por $12.500 ' +
      'con cargo a Cuenta ****1234 en JUMBO CENTRAL el 01/08/2026 13:20.',
  });

  assert.equal(e.contexto.hayConversacionEnCurso(), true);
});

// Google corta el script sin aviso al pasarse de 90 minutos diarios. El tope
// propio se agota antes y solo apaga las consultas rápidas, no el sistema.
test('agotado el presupuesto diario vuelve al ritmo lento', () => {
  const e = crearEntorno();
  e.propiedades.PRESUPUESTO_DIA = new Date().toISOString().substring(0, 10);
  e.propiedades.PRESUPUESTO_USADO = '99999';
  e.encolarAvisos(texto(10, '/pendientes'));

  e.contexto.revisarTelegram();

  assert.equal(consultas(e), 1, 'no debe entrar en modo rápido');
  assert.match(e.ultimoTexto(), /Nada pendiente/, 'pero sí atiende lo que llegó');
});

test('el presupuesto se reinicia cada día', () => {
  const e = crearEntorno();
  e.propiedades.PRESUPUESTO_DIA = '2020-01-01';
  e.propiedades.PRESUPUESTO_USADO = '99999';

  assert.equal(e.contexto.quedaPresupuesto(), true);
  assert.equal(e.propiedades.PRESUPUESTO_USADO, '0');
});

// --- Latido diario ---------------------------------------------------------

// Un aviso diario de "todo bien" se vuelve ruido en tres días y se deja de
// leer, que es peor que no tenerlo.
test('si no hay nada que arreglar el latido no dice nada', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now());

  e.contexto.latidoDiario();

  assert.equal(nuevos(e).length, 0);
});

test('avisa de los gastos que quedaron sin categoría', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now());
  e.contexto.procesarMensaje({
    getId: () => 'x1',
    getSubject: () => 'Cargo en cuenta',
    getPlainBody: () => 'Te informamos que se ha realizado una compra por $12.500 ' +
      'con cargo a Cuenta ****1234 en JUMBO CENTRAL el 01/08/2026 13:20.',
  });

  e.contexto.latidoDiario();

  assert.match(e.ultimoTexto(), /<b>1<\/b> gasto sin categoría/);
  assert.match(e.ultimoTexto(), /\/pendientes/);
});

// El respaldo ya no es manual: muchos días sin respaldo significa que el
// automático está fallando, y el aviso tiene que decir eso, no pedir pasos.
test('si el respaldo falla, el latido avisa la causa y cómo reintentar', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now() - 10 * 86400000);
  e.propiedades.RESPALDO_ERROR = 'La subida del respaldo a Drive respondió con el código 403.';

  e.contexto.latidoDiario();

  assert.match(e.ultimoTexto(), /No pude guardar la copia/);
  assert.match(e.ultimoTexto(), /código 403/, 'tiene que decir la causa');
  assert.match(e.ultimoTexto(), /\/respaldar/, 'y cómo reintentar desde el chat');
  assert.equal(/respaldar\.py|\/respaldado|Descargar|Apps Script/.test(e.ultimoTexto()), false,
    'ya no le pide al usuario pasos manuales ni abrir el editor');
});

// Lo que el usuario pidió: nunca un recordatorio de respaldar, solo un aviso si
// algo salió mal. Nueve días de silencio por un permiso que se arregla en un
// minuto sería un silencio caro.
test('un respaldo que falló se avisa al día siguiente, sin esperar nueve días', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now());
  e.propiedades.ULTIMO_RESPALDO = String(Date.now() - 86400000);
  e.propiedades.RESPALDO_ERROR = 'La búsqueda de la carpeta en Drive respondió con el código 403.';

  e.contexto.latidoDiario();

  assert.match(e.ultimoTexto(), /No pude guardar la copia/);
});

// Un aviso diario del mismo problema se vuelve ruido en tres días y se deja de
// leer, que es justo lo contrario de lo que sirve.
test('la misma falla no se avisa dos veces', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now());
  e.propiedades.ULTIMO_RESPALDO = String(Date.now() - 86400000);
  e.propiedades.RESPALDO_ERROR = 'La subida del respaldo a Drive respondió con el código 403.';

  e.contexto.latidoDiario();
  const avisos = e.enviados.length;
  e.contexto.latidoDiario();

  assert.equal(e.enviados.length, avisos, 'el segundo día no dice nada');
});

// Si no se limpiara la marca, una falla idéntica más adelante se daría por
// avisada y el latido se la callaría.
test('un respaldo exitoso deja que la misma falla se vuelva a avisar', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now());
  e.propiedades.ULTIMO_RESPALDO = String(Date.now() - 86400000);
  const falla = 'La subida del respaldo a Drive respondió con el código 403.';
  e.propiedades.RESPALDO_ERROR = falla;

  e.contexto.latidoDiario();
  e.contexto.exportarRespaldo();
  e.propiedades.ULTIMO_RESPALDO = String(Date.now() - 86400000);
  e.propiedades.RESPALDO_ERROR = falla;
  const avisos = e.enviados.length;
  e.contexto.latidoDiario();

  assert.ok(e.enviados.length > avisos, 'la vuelve a avisar');
});

// El respaldo ya es automático. El bot no puede pedirle que respalde.
test('cuando el respaldo anda bien, el latido no lo menciona', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now());
  e.propiedades.ULTIMO_RESPALDO = String(Date.now() - 86400000);
  e.propiedades.PRESUPUESTO_USADO = String(e.contexto.TOPE_DIARIO_SEGUNDOS * 0.95);

  e.contexto.latidoDiario();

  assert.match(e.ultimoTexto(), /Cuota diaria/, 'sí habla de lo que de verdad pasa');
  assert.equal(/respald/i.test(e.ultimoTexto()), false);
});

test('/respaldar guarda una copia en el momento y lo confirma', () => {
  const e = crearEntorno();

  e.contexto.manejarTexto('/respaldar');

  assert.equal(e.drive.archivos.length, 1);
  assert.match(e.ultimoTexto(), /Copia guardada/);
  assert.match(e.ultimoTexto(), /Finanzas - Respaldos/);
});

test('si /respaldar falla, lo dice y tranquiliza sobre los datos', () => {
  const e = crearEntorno();
  e.drive.fallarSubidaCon = 403;

  assert.doesNotThrow(() => e.contexto.manejarTexto('/respaldar'));

  assert.match(e.ultimoTexto(), /No pude guardar la copia/);
  assert.match(e.ultimoTexto(), /código 403/);
  assert.match(e.ultimoTexto(), /no se perdió nada/);
  assert.match(e.propiedades.RESPALDO_ERROR, /código 403/, 'y queda anotado para el latido');
});

// El activador corre cada domingo. Reclamar al séptimo día sería reclamar el
// mismo día en que le toca, antes de que alcance a correr.
test('una semana exacta sin respaldo todavía no es una falla', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now());
  e.propiedades.ULTIMO_RESPALDO = String(Date.now() - 7 * 86400000);

  e.contexto.latidoDiario();

  assert.equal(nuevos(e).length, 0);
});

// Si /respaldado siguiera marcando la fecha, serviría para callar un respaldo
// que de verdad está fallando.
test('/respaldado ya no calla el aviso, solo explica que es automático', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now() - 10 * 86400000);

  e.contexto.manejarTexto('/respaldado');
  assert.match(e.ultimoTexto(), /Ya no hace falta avisarme/);
  assert.equal(e.propiedades.ULTIMO_RESPALDO, undefined);

  e.contexto.latidoDiario();
  assert.match(e.ultimoTexto(), /No pude guardar la copia/);
});

test('avisa cuando la cuota diaria pasa del 90%', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now());
  e.propiedades.PRESUPUESTO_USADO = String(e.contexto.TOPE_DIARIO_SEGUNDOS * 0.95);

  e.contexto.latidoDiario();

  assert.match(e.ultimoTexto(), /Cuota diaria al <b>95%<\/b>/);
});

// Un correo que no se supo leer es un gasto que no se está registrando.
test('avisa de los correos no entendidos una sola vez', () => {
  const e = crearEntorno();
  e.propiedades.INSTALADO_EN = String(Date.now());
  e.contexto.procesarMensaje({
    getId: () => 'raro',
    getSubject: () => 'Aviso nuevo del banco',
    getPlainBody: () => 'algo que no calza con ningún lector',
  });

  e.contexto.latidoDiario();
  assert.match(e.ultimoTexto(), /<b>1<\/b> correos del banco que no supe leer/);

  const antes = nuevos(e).length;
  e.contexto.latidoDiario();
  assert.equal(nuevos(e).length, antes, 'no debe repetir el mismo aviso cada día');
});

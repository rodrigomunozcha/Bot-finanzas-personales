/**
 * Fechas para las pruebas, en hora local.
 *
 * Existe por un fallo real y molesto: las pruebas de informes y de graficos
 * armaban las fechas con `new Date().toISOString()`, que devuelve la fecha en
 * UTC, mientras que el codigo las arma con diaDe(), que usa la fecha local.
 *
 * En Chile (UTC-4) las dos coinciden durante 20 de las 24 horas del dia. Entre
 * las 20:00 y la medianoche no: para el reloj del Mac todavia es dia 23 y para
 * UTC ya es 24. Ahi la prueba creaba un gasto fechado manana y el informe,
 * mirando hasta hoy, no lo encontraba. Resultado: cuatro pruebas que fallaban
 * todas las noches durante cuatro horas y volvian a pasar solas.
 *
 * Eso es peor que un fallo permanente. Una suite que se pone roja sola, por
 * algo que no tiene que ver con el codigo, enseña a ignorar los fallos, y este
 * proyecto usa "npm test pasa" como el criterio para subir a produccion.
 *
 * La regla: en las pruebas, las fechas se arman como las arma el codigo. Si
 * aparece un toISOString() nuevo en una prueba de fechas, es este bug de vuelta.
 */

/** "2026-08-23", en hora local. Igual que diaDe() en informes.js. */
function dia(fecha) {
  var d = fecha || new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

/** Hoy, en hora local. */
function hoy() {
  return dia();
}

/** Hace n dias, en hora local. */
function haceDias(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dia(d);
}

/** Un dia del mes pasado, en hora local. */
function delMesPasado() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1, 15);
  return dia(d);
}

module.exports = { dia, hoy, haceDias, delMesPasado };

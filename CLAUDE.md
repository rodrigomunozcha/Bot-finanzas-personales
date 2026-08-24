# Bot de finanzas - reglas de este repositorio

**Este archivo aplica solo a `la carpeta del proyecto` y a nada más.** No es una
guía transversal ni vale para los otros proyectos del usuario. El orquestador de
estudio tiene su propio `CLAUDE.md` en `~/la carpeta del proyecto`, que es una
carpeta hermana de esta: ninguna está dentro de la otra, así que los dos archivos
nunca se cargan juntos ni se pisan.

Clasifica gastos por Telegram leyendo los correos de Banco de Chile. El README
explica qué hace y cómo se instala. Este archivo dice cómo se trabaja sobre él.

## Español neutro, siempre

Es la máxima principal del usuario, por encima de cualquier detalle técnico.
Aplica a **todo**: la conversación con él, el código, los comentarios, la
documentación, los mensajes de commit y los textos que el bot le manda.

**Nada de voseo rioplatense.** Es la forma concreta en que ya falló:

| Nunca | Siempre |
|---|---|
| tenés, querés, podés, hacés | tienes, quieres, puedes, haces |
| escribís, apretás, elegís | escribes, aprietas, eliges |
| agregá, apretá, mirá, revisá | agrega, aprieta, mira, revisa |
| vos, sos, contame, decime | tú, eres, cuéntame, dime |

Tampoco mexicanismos, españolismos ni chilenismos, aunque él sea chileno.
Neutro significa que funciona en cualquier país hispanohablante.

Sin em-dash ni punto y coma: usa " - " con espacios a ambos lados, o parte la
frase en dos.

El riesgo real no está en el código, que se revisa con calma. Está en los
mensajes de cierre al final de una sesión larga, cuando baja la guardia. Ahí
fue donde falló.

## La regla que manda sobre todas las demás

**El sistema nunca obtiene datos personales. No los tacha después: no los lee.**

Esto no es una preferencia de estilo. Es un sistema que vive dentro de la cuenta
de correo de una persona y le lee la plata. Si filtra un dato, no sirve, por bien
que funcione todo lo demás.

Ya falló tres veces, y la tercera fue así: el lector de transferencias enviadas
tomaba el campo "Mensaje" del correo y lo usaba como nombre de comercio. En el
correo real ese mensaje era la dirección de una vivienda, escrita
para que quien recibía el pago supiera quién le había pagado. Esa dirección iba a quedar en
la hoja de movimientos, en la tabla de aprendizaje, en el mensaje de Telegram y
en el respaldo local. Las 169 pruebas que existían pasaban.

### Por qué tachar no sirve

Hubo una función `censurarDatosPersonales` que borraba con expresiones regulares
lo que parecía sensible. Se eliminó. Un RUT tiene forma, un correo tiene forma,
un número de cuenta tiene forma. **Un nombre propio y una dirección no tienen
ninguna**, así que salían intactos. Verificado corriéndola: `Nombre Apellido`
pasaba entero.

Toda lista negra tiene ese problema. Solo bloquea lo que alguien pensó en
escribir.

### Cómo está resuelto

1. **Lista blanca de campos.** `CAMPOS_PERMITIDOS` y `CAMPOS_PERMITIDOS_PAGO` en
   `parsers.js`. Un lector solo puede devolver lo que está ahí. Todo lo demás se
   descarta antes de salir del archivo. Los dos caminos desde un correo hacia el
   sistema (`leerCorreo` y `leerPagoTarjeta`) pasan por su colador.
2. **Prueba de canarios.** `tests/privacidad.test.js` alimenta cada formato de
   correo con datos sensibles metidos en todos sus huecos de texto libre, y
   comprueba que no aparecen ni en la lectura, ni en las hojas, ni en Telegram,
   ni en las propiedades del script.
3. **De un correo no reconocido no se guarda el cuerpo.** Solo el asunto y un
   enlace para abrirlo en Gmail. El extracto existía para comodidad de quien
   programa, no para que el sistema funcione, y eso no justifica guardar el
   correo de nadie.

### Al escribir un lector nuevo

- **El texto libre de un correo no se lee. Nunca.** Glosas, mensajes,
  referencias, comentarios. Ese texto lo escribe una persona para otra persona, y
  ahí cabe una dirección, un teléfono, un diagnóstico médico. No hay validación
  que lo arregle.
- **Los nombres de personas no se leen**, ni completos ni abreviados a la
  inicial. La persona del otro lado no eligió estar en este sistema.
- **Lo que no se usa no se extrae.** Si nadie consume un campo, no debe salir del
  lector. Los cuatro dígitos de la cuenta se leían y no los usaba nadie.
- Un comercio de una compra con tarjeta **sí** se lee: lo escribe el banco, es el
  nombre de un negocio, y es el dato central del sistema.
- Antes de dar por buena la prueba de canarios, **rómpela a propósito** y
  comprueba que falla. Una prueba que no puede fallar no protege nada.

### Antes de cada commit

```bash
cd la carpeta del proyecto && git diff | grep -niE 'nombre real|rut real|dirección'
```

Rastrea los datos reales del dueño del repositorio sobre lo que se va a
versionar. En las pruebas, la estructura del correo real se conserva y **todos**
los valores se reemplazan por inventados.

## Costo cero, no negociable

Corre con el plan Claude Pro y nada más. Nada de APIs con tarifa ni servicios que
cobren por uso. Si una mejora solo funciona pagando, no la implementes: dilo,
nombra el sacrificio de la alternativa gratis, y deja que el usuario decida.

## Claridad de la interfaz

Cada mensaje y cada botón dice qué hace y qué va a pasar. Quien usa esto no tiene
la terminal abierta ni sabe cómo está hecho por dentro. No des el contexto por
supuesto.

## Estilo de los comentarios

El idioma está arriba del todo, en "Español neutro, siempre", y no se repite
aquí: dos listas con la misma regla terminan separándose y una queda mintiendo.

Los comentarios explican **por qué**, no qué. El estilo del repo es dejar dicho
qué se probó y qué falló, para que nadie lo vuelva a intentar.

## Apps Script tiene trampas propias

- **Todos los archivos comparten un mismo ámbito global.** Dos archivos con
  `var MESES` no dan error: el segundo pisa al primero y cuál gana depende del
  orden de carga. Ya pasó. Antes de declarar algo global, busca el nombre en
  `apps_script/`.
- **Verifica en vivo lo que toca servicios de Google.** En este proyecto el doble
  de pruebas mintió tres veces: caché sin función de borrar, fechas al revés, y
  Sheets convirtiendo textos que en realidad no convierte. Una prueba que pasa no
  garantiza nada si el doble está mal.
- **El bot consulta a Telegram, no al revés.** Un webhook no funciona: Apps Script
  responde con redirección y Telegram lo rechaza con *"Wrong response from the
  webhook: 302 Found"*, acumula la cola y reintenta durante horas.
- **Cada lectura o escritura en Sheets cuesta cerca de un segundo.** Hay pruebas
  que fijan el techo por operación.

## Al hacer cambios

```bash
cd la carpeta del proyecto && npm test && node herramientas/generar_datos_js.js && npx --yes @google/clasp@latest push
```

- `datos.gen.js` es generado. Se edita el JSON de `datos/`, no el `.js`.
- Si agregas una etapa, decide qué pasa si falla. El patrón del repo es degradar,
  no abortar: perder una sección es mucho mejor que perder el movimiento.

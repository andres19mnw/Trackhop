# TRACK SYNC — Especificación

## Objetivo
Implementar una herramienta global llamada `Track Sync` en mi aplicación de sincronización musical, desarrollada en Kotlin.

Su propósito es revisar, administrar y corregir las canciones sincronizadas, sus matches y las canciones ignoradas.

**Antes de implementar, investiga exhaustivamente el código existente.** No asumas cómo funciona el almacenamiento ni inventes estructuras. Identifica y reutiliza la lógica actual.

## 1. Análisis del sistema
Investiga en todo el proyecto:

- Dónde y cómo se almacenan las canciones sincronizadas.
- Cómo se relacionan canciones originales y matches.
- Cómo se registran las canciones ignoradas y sus motivos.
- Cómo se relacionan los registros con playlists y servicios.
- Modelos, entidades, repositorios, DAO, bases de datos y servicios involucrados.
- Cómo funciona actualmente la búsqueda y asignación de matches.
- Qué información se conserva de cada canción (nombre, artista, álbum, duración, URL, ID, servicio, playlist, etc.).

Identifica qué se puede reutilizar, qué falta y qué debe modificarse. No dupliques almacenamiento ni elimines datos históricos.

## 2. Ubicación y navegación
Agregar `Track Sync` dentro de:

`Tools → Your music`

Debe aparecer junto a:
- Trackhop in numbers
- Manage playlists
- Repeats across playlists

Descripción sugerida: "Review matched and ignored tracks across your synced playlists."

Debe tener icono propio y abrir una pantalla independiente.

### Independencia
La herramienta debe ser global, NO depender del selector `Service for the tools` (YouTube Music / Spotify web).

Debe:
- Consultar sincronizaciones de todos los servicios compatibles.
- Identificar automáticamente el servicio de origen y destino.
- Permitir revisar playlists independientemente del servicio.
- No estar integrada exclusivamente en Spotify o YouTube Music.

No modificar el comportamiento de las demás herramientas.

## 3. Reemplazar la herramienta anterior
Actualmente existe `Tracked and ignored tracks`.

Reemplazarla por `Track Sync`:
- Eliminar su entrada de navegación y su interfaz obsoleta.
- Reutilizar su lógica y almacenamiento cuando corresponda.
- Conservar todos los registros históricos.
- No eliminar modelos, tablas o funciones todavía utilizadas.
- Evitar funcionalidades duplicadas.

Toda la gestión de canciones matcheadas e ignoradas debe quedar centralizada en Track Sync.

## 4. Pantalla principal
Crear una interfaz moderna, completa e intuitiva, coherente con el diseño actual de la aplicación.

Debe permitir seleccionar cualquier playlist sincronizada y consultar sus canciones.

### Información de cada canción
Mostrar:
- Canción original (origen).
- Artista y demás información disponible.
- Servicio de origen.
- Canción encontrada (match).
- Servicio de destino.
- Estado de sincronización.

La relación origen → match debe ser visualmente evidente, facilitando la comparación de ambas canciones.

### Organización
Incluir:
- Selector de playlists.
- Resumen de canciones sincronizadas, ignoradas y pendientes, si estos estados existen.
- Filtros: Todas, Matcheadas e Ignoradas.
- Búsqueda por canción o artista.
- Identificación visual de los servicios.
- Estados claramente diferenciados.
- Acciones accesibles para modificar registros.

Evitar una tabla básica. Priorizar tarjetas o filas bien organizadas, con jerarquía visual y navegación intuitiva.

## 5. Canciones matcheadas
Permitir editar cualquier match existente.

Funciones:
- Reemplazar el match actual.
- Pegar directamente el enlace de la canción correcta.
- Validar el enlace e identificar el servicio y la canción.
- Mostrar una vista previa antes de confirmar.
- Guardar la nueva relación entre origen y destino.
- Actualizar la interfaz inmediatamente.

La modificación debe actualizar el registro existente, sin generar duplicados ni ejecutar innecesariamente toda la sincronización.

## 6. Canciones ignoradas
Mostrar todas las canciones ignoradas dentro de la misma pantalla.

Para cada una:
- Mostrar información original y playlist.
- Mostrar el motivo de exclusión, si está disponible.
- Permitir restaurarla.
- Permitir asignarle un match manual mediante un enlace.

Restaurar debe modificar correctamente su estado persistente, conservando su información original y evitando duplicados.

Asignar un match manual debe permitir establecer correctamente la relación origen → destino y actualizar su estado.

## 7. UX y comportamiento
Implementar:
- Estados de carga, error y listas vacías.
- Confirmaciones para modificaciones importantes.
- Validación de enlaces.
- Mensajes de éxito y error.
- Actualización de datos después de cada operación.
- Búsqueda y filtros funcionales.
- Navegación intuitiva y diseño adaptable.
- Indicadores visuales claros para cada estado.

Mantener coherencia con los componentes, colores, tipografía y patrones visuales existentes.

## 8. Requisitos técnicos
- Respetar la arquitectura actual de Kotlin.
- Reutilizar modelos, repositorios, servicios y persistencia.
- Modificar esquemas o modelos únicamente cuando sea necesario.
- Mantener compatibilidad con los datos existentes.
- Evitar duplicaciones e inconsistencias.
- Validar correctamente los enlaces según los servicios compatibles.
- No romper la sincronización actual.
- No utilizar datos simulados para funcionalidades que deben trabajar con registros reales.

Si alguna funcionalidad no es posible con la arquitectura actual, identificar primero la limitación y resolverla sin introducir soluciones paralelas innecesarias.

## 9. Verificación
Comprobar:
1. Se muestran correctamente las canciones y sus matches.
2. Se identifican los servicios de origen y destino.
3. Se muestran las canciones ignoradas.
4. Restaurar cambia correctamente su estado.
5. Se pueden reemplazar matches existentes.
6. Se pueden asignar matches mediante enlaces.
7. Los cambios persisten al reiniciar la aplicación.
8. No se generan duplicados ni se pierden registros.
9. Las playlists de ambos servicios se pueden consultar.
10. Las demás herramientas y procesos de sincronización siguen funcionando.

## Resultado esperado
Una herramienta global `Track Sync`, ubicada en `Tools → Your music`, que centralice la revisión y administración de canciones sincronizadas e ignoradas.

Debe permitir inspeccionar, corregir y restaurar registros reales desde una única interfaz moderna, sin depender de un servicio musical específico.
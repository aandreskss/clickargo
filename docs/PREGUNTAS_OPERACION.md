# Preguntas de operación — Box To Go

Este documento lista las dudas de operación logística que el código no puede deducir solo del
enunciado. Respóndelas para que los campos, validaciones y flujos sean correctos para el
primer cliente.

**Instrucciones:** responde en la columna "Respuesta / Decisión". Si un campo debe quedar
opcional hasta que se aclare, ya está marcado como opcional en el código y lo listaremos aquí.

---

## Cuentas (clientes, navieras, proveedores, agentes)

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| C1 | ¿Cuántos días de crédito son el estándar para clientes nuevos? ¿0 (contado), 30, 45? | |
| C2 | ¿Manejan lista de precios por cliente (tarifas especiales) o todos pagan la misma tarifa? | |
| C3 | ¿La "persona de contacto" de una cuenta puede ser múltiple (varios contactos por empresa), o solo uno? | |
| C4 | ¿Necesitan el campo "web / sitio" para las cuentas? | |

---

## Embarques — General

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| E1 | ¿Cómo llaman internamente a la **prefactura** (proforma, liquidación, factura proforma, cotización de servicios)? El nombre aparecerá en pantalla. | |
| E2 | ¿Con qué número empieza la numeración de embarques? ¿`EMB-000001` o hay un prefijo diferente (p. ej. `BTG-000001`)? | |
| E3 | ¿Manejan **embarques parciales** (un BL que llega en varias entregas)? | |
| E4 | ¿Registran el **agente en origen** (agente en el país exportador) en el expediente? | |
| E5 | ¿El campo "descripción de mercancía" es texto libre o hay una lista de categorías? | |

---

## Embarques — Marítimo importación

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| M1 | ¿Qué navieras usan actualmente (Maersk, MSC, CMA CGM, Hapag-Lloyd, otras)? | |
| M2 | ¿El MBL (Master Bill of Lading) siempre lo emite la naviera, o a veces trabajan con SWB (Sea Waybill)? | |
| M3 | ¿El HBL (House Bill of Lading) lo emiten ustedes, o solo lo reciben del agente en origen? | |
| M4 | ¿Manejan **FCL** (contenedor completo), **LCL** (carga suelta) o ambos? | |
| M5 | Para FCL: ¿cuántos contenedores puede tener un embarque típico? (ayuda a diseñar la tabla de contenedores) | |
| M6 | ¿El campo **peso** va en kg, toneladas métricas, o ambos? | |
| M7 | ¿Registran el **puerto de carga** y **puerto de descarga** siempre, o solo el de descarga (p. ej. siempre es Santo Domingo)? | |
| M8 | ¿Qué campos de la **DGA** (Dirección General de Aduanas RD) son obligatorios para el despacho? ¿Número de declaración, liquidación, otros? | |

---

## Embarques — Marítimo exportación

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| X1 | ¿Manejan exportaciones actualmente, o es futuro? | |
| X2 | ¿El flujo de exportación es simétrico al de importación o tiene pasos distintos (booking, instrucciones de embarque, VGM)? | |

---

## Embarques — Aéreo importación

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| A1 | ¿Qué aerolíneas / consolidadores usan? | |
| A2 | ¿Manejan **MAWB** + **HAWB**, o solo MAWB? | |
| A3 | ¿El campo **peso bruto** vs **peso volumétrico** — necesitan ambos en la pantalla? | |
| A4 | ¿Hay algún campo aduanero específico para carga aérea en RD que el sistema deba registrar? | |

---

## Cargos y prefactura

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| P1 | ¿Los cargos que le cobran ustedes al cliente son siempre en USD, o también en DOP? | |
| P2 | ¿Los costos internos (lo que pagan al proveedor) también son en USD, o mixtos? | |
| P3 | ¿La prefactura tiene número propio (PRE-000001) o usa el número del embarque? | |
| P4 | ¿Los cargos tienen categorías fijas (flete, handling, almacenaje, aduanas, otros) o son texto libre? | |
| P5 | ¿Aplican ITBIS (18 %) a alguno de los cargos? ¿A cuáles? | |
| P6 | ¿La prefactura se envía al cliente por correo directamente desde el sistema, o la exportan y la envían manualmente? | |

---

## Almacenaje con terceros

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| AL1 | ¿Con qué almacenes trabajan (nombre del almacén)? | |
| AL2 | ¿La tarifa de almacenaje es diaria, semanal, o por período? | |
| AL3 | ¿El almacenaje tiene un período libre (p. ej. 5 días gratis) antes de cobrar? | |
| AL4 | ¿Registran la **fecha de entrada** y **fecha de retiro** del almacén en el expediente? | |

---

## Tracking y portal del cliente

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| T1 | ¿Los clientes acceden al portal con un link público (sin login) o con una cuenta propia? | |
| T2 | ¿Qué información puede ver el cliente en el portal? ¿Estado del embarque, documentos, o también cargos? | |
| T3 | ¿Manejan notificaciones automáticas al cliente por correo cuando el estado cambia? | |
| T4 | ¿El tracking de navieras (p. ej. Maersk API) es algo que quieren integrar, o solo registro manual de estados? | |

---

## Documentos / archivos

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| D1 | ¿Qué documentos adjuntan típicamente a un embarque? (BL, factura comercial, packing list, certificado de origen, permisos, otros) | |
| D2 | ¿Los documentos los sube el operador, el cliente (portal), o ambos? | |
| D3 | ¿Hay documentos que el sistema debe **generar** (PDF) vs documentos que se **adjuntan** (upload)? | |

---

## Reportes

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| R1 | ¿Qué reportes genera Box To Go actualmente (en Excel, Word, o manualmente)? | |
| R2 | ¿El reporte más importante es el de embarques activos, ingresos del mes, o algo específico? | |
| R3 | ¿Necesitan exportar a Excel, o es suficiente con PDF? | |

---

## Usuarios y roles

| # | Pregunta | Respuesta / Decisión |
|---|----------|----------------------|
| U1 | ¿Cuántos usuarios tendrá Box To Go aproximadamente al inicio? | |
| U2 | ¿El rol "agente aduanal" (`customs_broker`) es un empleado de Box To Go o un externo con acceso limitado? | |
| U3 | ¿Necesitan que el agente aduanal solo vea los embarques asignados a él, o todos? | |

---

*Añadir preguntas nuevas a medida que avancen los módulos de cotizaciones, embarques y cargos.*

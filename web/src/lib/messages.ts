export const MSG = {
  // éxitos
  cuenta_guardada:    "Cuenta guardada.",
  cuenta_actualizada: "Cuenta actualizada.",
  cuenta_eliminada:   "Cuenta eliminada.",
  empresa_creada:     "Empresa creada. El dueño recibirá acceso al registrarse.",
  // errores de cuentas
  nombre_obligatorio:   "El nombre es obligatorio.",
  tipo_invalido:        "Tipo de cuenta inválido.",
  id_fiscal_invalido:   "ID fiscal inválido.",
  correo_invalido:      "El correo no parece válido.",
  sin_permiso_crear:    "Tu rol no puede crear cuentas.",
  sin_permiso_editar:   "No tienes permiso para editar.",
  sin_permiso_eliminar: "Solo dueño, administrador o gerente pueden eliminar.",
  empresa_suspendida:   "La empresa está suspendida. Contacta a soporte.",
  id_invalido:          "Identificador inválido.",
  // errores de auth
  credenciales_invalidas: "Correo o contraseña incorrectos.",
  correo_existente:       "Ese correo ya tiene cuenta. Inicia sesión.",
  password_corta:         "La contraseña debe tener al menos 12 caracteres.",
  sin_confirmacion:       "Confirma tu correo antes de entrar.",
  revisa_correo:          "Revisa tu correo para confirmar la cuenta y luego inicia sesión.",
  sin_invitacion:         "El registro requiere una invitación válida.",
  invitacion_vencida:     "La invitación ha vencido. Solicita una nueva al administrador.",
  mfa_requerido:          "Esta sección requiere verificación en dos pasos.",
  // errores de slug/empresa
  slug_invalido:    "Subdominio inválido: usa 3–32 letras minúsculas, números o guiones.",
  slug_reservado:   "Ese subdominio está reservado. Elige otro.",
  subdominio_en_uso: "Ese subdominio ya está en uso.",
  // cotizaciones — éxitos
  cotizacion_guardada:    "Cotización guardada.",
  cotizacion_actualizada: "Cotización actualizada.",
  cotizacion_eliminada:   "Cotización eliminada.",
  cotizacion_duplicada:   "Cotización duplicada.",
  cotizacion_enviada:     "Cotización marcada como enviada.",
  cotizacion_aceptada:    "Cotización marcada como aceptada.",
  cotizacion_rechazada:   "Cotización marcada como rechazada.",
  // cotizaciones — errores
  cliente_obligatorio:    "Debes seleccionar un cliente.",
  servicio_obligatorio:   "El tipo de servicio es obligatorio.",
  lineas_obligatorias:    "Debe haber al menos una línea de servicio.",
  precio_invalido:        "El precio no puede ser negativo.",
  cantidad_invalida:      "La cantidad debe ser mayor que cero.",
  estado_invalido:        "Cambio de estado no permitido.",
  cotizacion_no_editable: "Solo se pueden editar cotizaciones en borrador.",
  // equipo
  invitacion_enviada:         "Invitación enviada.",
  invitacion_ya_pendiente:    "Ya hay una invitación pendiente para ese correo.",
  invitacion_limite:          "Límite de invitaciones alcanzado. Intenta en una hora.",
  rol_cambiado:               "Rol actualizado.",
  miembro_desactivado:        "Miembro desactivado.",
  miembro_reactivado:         "Miembro reactivado.",
  miembro_eliminado:          "Miembro eliminado.",
  costos_actualizados:        "Acceso a costos actualizado.",
  ultimo_owner:               "No puedes dejar la empresa sin dueño.",
  no_auto_degradar:           "No puedes cambiar tu propio rol.",
  // ajustes de empresa
  ajustes_guardados:          "Ajustes guardados.",
  logo_subido:                "Logo actualizado.",
  logo_muy_grande:            "El logo no puede superar 2 MB.",
  logo_tipo_invalido:         "Solo se permiten imágenes PNG, JPG o WebP.",
  logo_firma_invalida:        "El archivo no es una imagen válida.",
  // numeración
  contador_actualizado:       "Numeración actualizada.",
  // tipos de cargo
  cargo_guardado:             "Tipo de cargo guardado.",
  cargo_desactivado:          "Tipo de cargo desactivado.",
  cargos_sembrados:           "Cargos por defecto agregados.",
  // embarques — éxitos
  embarque_guardado:         "Embarque guardado.",
  embarque_actualizado:      "Embarque actualizado.",
  embarque_avanzado:         "Etapa actualizada.",
  embarque_cancelado:        "Embarque cancelado.",
  cotizacion_convertida:     "Cotización convertida en embarque.",
  // embarques — errores
  cliente_embarque_obligatorio: "Debes seleccionar un cliente.",
  modo_obligatorio:             "El modo de transporte es obligatorio.",
  etapa_invalida:               "Cambio de etapa no permitido.",
  campos_faltantes_etapa:       "Faltan campos obligatorios para avanzar.",
  embarque_no_editable:         "Este embarque no puede modificarse.",
  razon_obligatoria:            "El motivo es obligatorio para esta acción.",
  sin_permiso_avanzar:          "Tu rol no puede realizar este cambio.",
  cotizacion_no_convertible:    "Solo se puede convertir una cotización aceptada.",
  // masters — éxitos
  master_guardado:            "Master guardado.",
  master_actualizado:         "Master actualizado.",
  master_eliminado:           "Master eliminado.",
  house_vinculado:            "Embarque vinculado al master.",
  house_desvinculado:         "Embarque desvinculado del master.",
  tracking_habilitado:        "Tracking activado.",
  tracking_evento_registrado: "Evento de tracking registrado.",
  sugerencia_aceptada:        "Etapa actualizada en los embarques.",
  sugerencia_descartada:      "Sugerencia descartada.",
  // masters — errores
  master_no_encontrado:       "Master no encontrado.",
  master_no_editable:         "Este master no puede modificarse.",
  campos_faltantes_master:    "Faltan campos obligatorios del master.",
  mode_incompatible:          "El embarque no tiene el mismo modo que el master.",
  tracking_no_configurado:    "El tracking está en modo manual. Configura un proveedor para activar el tracking automático.",
  firma_webhook_invalida:     "Firma del webhook inválida.",
  timestamp_webhook_invalido: "El webhook fue rechazado por marca de tiempo fuera de rango.",
  // cargos de embarque — éxitos
  cargo_de_embarque_guardado:    "Cargo registrado.",
  cargo_de_embarque_actualizado: "Cargo actualizado.",
  cargo_de_embarque_eliminado:   "Cargo eliminado.",
  cargos_importados_cotizacion:  "Cargos importados desde la cotización.",
  costo_guardado:                "Costo registrado.",
  costo_actualizado:             "Costo actualizado.",
  costo_eliminado:               "Costo eliminado.",
  tasa_guardada:                 "Tasa de cambio guardada.",
  // cargos de embarque — errores
  cargo_bloqueado_prefactura:    "El cargo ya fue prefacturado y no puede editarse.",
  cargos_obligatorios:           "Debe haber al menos un cargo para prefacturar.",
  sin_permiso_ver_costos:        "Tu rol no tiene acceso a costos internos.",
  cargo_sin_precio:              "El precio unitario debe ser mayor que cero.",
  // prefacturas — éxitos
  prefactura_creada:             "Prefactura generada.",
  prefactura_anulada:            "Prefactura anulada. Los cargos quedaron disponibles.",
  prefactura_enviada:            "Prefactura enviada al sistema ERP.",
  factura_registrada:            "Número de factura registrado.",
  credenciales_erp_guardadas:    "Credenciales ERP guardadas.",
  // prefacturas — errores
  prefactura_no_editable:        "Una prefactura confirmada no puede modificarse.",
  prefactura_ya_anulada:         "La prefactura ya fue anulada.",
  prefactura_ya_facturada:       "Una prefactura ya facturada no puede anularse.",
  prefactura_no_encontrada:      "Prefactura no encontrada.",
  error_erp:                     "No se pudo conectar con el sistema ERP. Intenta de nuevo.",
  erp_no_configurado:            "No hay credenciales ERP configuradas para esta empresa.",
  // documentos adjuntos
  documento_subido:          "Documento subido correctamente.",
  documento_eliminado:        "Documento eliminado.",
  documento_tipo_invalido:    "Solo se permiten PDF, JPEG, PNG o WebP.",
  documento_muy_grande:       "El archivo no puede superar 20 MB.",
  documento_firma_invalida:   "El archivo no es del tipo declarado.",
  // correos
  correo_enviado:             "Correo enviado correctamente.",
  correo_no_configurado:      "Configura el correo de envío en Ajustes → Integración.",
  correo_limite:              "Límite de correos alcanzado. Espera un momento e intenta de nuevo.",
  correo_error:               "No se pudo enviar el correo. Intenta de nuevo.",
  // PDF
  pdf_error:                  "No se pudo generar el PDF.",
  // plantillas de documentos
  plantilla_guardada:         "Plantilla de documento actualizada.",
  visibilidad_actualizada:    "Visibilidad del documento actualizada.",
  // almacenaje con terceros
  entrada_registrada:        "Entrada de almacenaje registrada.",
  salida_registrada:         "Salida de almacenaje registrada.",
  cargo_ya_creado:           "El cargo de esta estadía ya fue creado.",
  cargo_almacenaje_creado:   "Cargo de almacenaje creado.",
  almacenaje_eliminado:      "Estadía de almacenaje eliminada.",
  almacenaje_bloqueado:      "No se puede eliminar una estadía que ya tiene cargo creado.",
  fecha_salida_invalida:     "La fecha de salida no puede ser anterior a la fecha de entrada.",
  // genérico
  sin_permiso_ajustes:           "Solo dueño o administrador puede acceder a los ajustes.",
  error_generico:                "No se pudo completar la acción. Inténtalo de nuevo.",
} as const;

export type MsgKey = keyof typeof MSG;

/** Valida que `key` sea un código conocido y devuelve el texto. Si no, devuelve undefined. */
export function decode(key: string | undefined): string | undefined {
  if (!key || !(key in MSG)) return undefined;
  return MSG[key as MsgKey];
}

/** Genera una URL con ?ok=CODE para mensajes de éxito/información. */
export function okUrl(base: string, key: MsgKey): string {
  return `${base}?ok=${key}`;
}

/** Genera una URL con ?error=CODE para mensajes de error. */
export function errUrl(base: string, key: MsgKey): string {
  return `${base}?error=${key}`;
}

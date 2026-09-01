function formatCategoryLabel(
  category: string,
  status: 'confirmed' | 'ambiguous' | 'fallback' | 'none',
): string {
  if (status === 'none') return '❓ Sin categoría';
  return category;
}

function categoryStatusNote(status: 'confirmed' | 'ambiguous' | 'fallback' | 'none'): string {
  if (status === 'ambiguous') return ' (¿correcto?)';
  if (status === 'fallback') return ' (sugerida)';
  return '';
}

export const expenseCopies = {
  clarificationAmount: () => '¿Cuánto gastaste?',
  clarificationCurrency: () => '¿En qué moneda fue ese gasto?',
  zeroAmountConfirmation: () => '¿Querías registrar un gasto de $0?',
  saving: () => 'Guardando tu gasto…',
  saveNetworkFailure: () =>
    'No pude confirmar el guardado por un problema de conexión. Respondé *reintentar* dentro de los próximos 10 minutos.',
  saveAuthorizationFailure: () =>
    'No pude acceder a tu planilla. Respondé *empezar* para volver a conectar tu cuenta.',
  saveStructureFailure: () =>
    'No pude guardar el gasto porque la hoja o sus columnas cambiaron. Respondé *reconfigurar* para revisar la configuración.',
  saveRetryExpired: () =>
    'El tiempo para reintentar este guardado venció. Verificá tu planilla y registrá el gasto nuevamente.',
  saveManualCopyFallback: (input: { concept: string; amount: number; currency: string }): string =>
    [
      'No pude confirmar que el gasto se haya guardado. Copiá estos datos manualmente en tu planilla:',
      `• Concepto: ${input.concept.slice(0, 80)}`,
      `• Monto: ${input.amount} ${input.currency}`,
    ].join('\n'),
  cancelled: () => 'Registro cancelado. No se guardó nada.',
  noActiveExpenseToCancel: () => 'No hay ningún registro pendiente para cancelar.',
  expenseQueueFull: () =>
    'Ya tenés 3 gastos en curso. Confirmá o cancelá el actual antes de agregar otro.',
  expenseQueueNotice: (pendingCount: 1 | 2) =>
    `Tenés ${pendingCount} gasto${pendingCount === 1 ? '' : 's'} pendiente${pendingCount === 1 ? '' : 's'}. Vamos con el siguiente:`,
  expenseQueueNonFinancialReminder: (pendingCount: number) =>
    `Todavía tenés un gasto pendiente de confirmación y ${pendingCount} más en la cola. ¿Querés confirmar, corregir o cancelar el actual?`,
  expenseQueueExpirationAdvance: () =>
    'El registro anterior venció sin confirmación y fue cancelado. Vamos con el siguiente gasto pendiente:',
  expenseQueueClosingSummary: (registeredCount: number) =>
    `¡Listo! Registré ${registeredCount} gasto${registeredCount === 1 ? '' : 's'}. Ya no tenés gastos pendientes.`,
  ambiguousResponse: () => '¿Confirmamos el registro tal como está, lo corregimos o lo cancelamos?',
  fallbackError: () => 'Parece que algo falló. Vamos a empezar de nuevo.',
  expenseRegistrationUnavailable: () =>
    'El registro de gastos no está disponible en este momento. Volvé a intentarlo más tarde.',
  undoDeleted: (concept: string, amount: number, currency: string) =>
    `Listo, se eliminó el último registro (${concept.slice(0, 80)}, ${amount} ${currency}).`,
  undoNotFound: () => 'No encontré un registro reciente para deshacer.',
  undoConfirmationRequired: (concept: string, amount: number, currency: string, savedAt: Date) =>
    `¿Querés eliminar '${concept.slice(0, 80)}, ${amount} ${currency}' registrado a las ${savedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}? Respondé sí o cancelar.`,
  undoCancelled: () => 'No se eliminó ningún registro.',
  undoDeletionFailed: () =>
    'No pude eliminar el último registro en este momento. Verificá tu planilla e intentá de nuevo más tarde.',
  clarificationInterrupted: () => 'El registro anterior fue cancelado. Procesando el nuevo gasto…',
  highAmountWarning: () => '⚠️ *Monto inusualmente alto*',
  highAmountConfirmationPrompt: () =>
    'Este monto supera notablemente tu gasto promedio. ¿Confirmamos que es correcto?',
  reviewTimeoutWarning: (pendingCount?: number) =>
    [
      '¿Confirmamos el registro? Respondé *sí*, *corregir*, o *cancelar*.',
      ...(pendingCount && pendingCount > 0
        ? [
            `(También tenés ${pendingCount} gasto${pendingCount === 1 ? '' : 's'} esperando en la cola.)`,
          ]
        : []),
    ].join('\n'),
  reviewCancellation: () => 'Registro cancelado. No se guardó nada.',
  expenseSavedConfirmation: (input: {
    concept: string;
    amount: number;
    currency: string;
    sheetName: string;
    rowIndex?: number | undefined;
  }): string => {
    const location =
      input.rowIndex === undefined
        ? `Guardado en '${input.sheetName}'`
        : `Guardado en '${input.sheetName}', fila ${input.rowIndex}`;

    return [
      '✅ *Gasto guardado*',
      `• Concepto: ${input.concept.slice(0, 80)}`,
      `• Monto: ${input.amount} ${input.currency}`,
      `• Ubicación: ${location}`,
    ].join('\n');
  },
  expenseCorrectionPrompt: () =>
    '¿Qué querés corregir? Escribí la corrección en lenguaje natural.\n\n' +
    'Por ejemplo:\n' +
    '• "no, fueron 15"\n' +
    '• "ponlo en transporte"\n' +
    '• "fue ayer"\n' +
    '• "no, fueron 15 y es transporte" (varios campos en un solo mensaje)',
  correctionApplied: (field: string, value: string | number): string => {
    const labels: Record<string, string> = {
      monto: 'Monto',
      moneda: 'Moneda',
      categoria: 'Categoría',
      fecha: 'Fecha',
    };
    return `✅ *${labels[field] ?? field}* actualizado: ${value}`;
  },
  correctionCycleLimitReached: () =>
    'Llegamos al límite de correcciones. ¿Confirmamos el gasto como está o lo cancelamos?',
  correctionHighAmountConfirmation: () =>
    'El monto corregido es inusualmente alto. ¿Confirmamos que es correcto? Respondé *sí* o *cancelar*.',
  clarificationReformulation: (options: string[]): string => {
    if (options.length === 0) {
      return '¿En qué moneda fue ese gasto?';
    }
    if (options.length === 1) {
      return `¿El gasto fue en ${options[0]}?`;
    }
    const lastOption = options[options.length - 1];
    const precedingOptions = options.slice(0, -1).join(', ');
    return `¿El gasto fue en ${precedingOptions} o ${lastOption}?`;
  },

  expenseSummary: (payload: {
    rawMessage: string;
    monto: number | string | null;
    moneda: string | null;
    category: string;
    categoryConfidence: string;
    categoryStatus: 'confirmed' | 'ambiguous' | 'fallback' | 'none';
    date: string;
  }): string => {
    const confidenceNote = payload.categoryConfidence === 'baja' ? ' (¿correcto?)' : '';
    const categoryLabel = formatCategoryLabel(payload.category, payload.categoryStatus);
    const statusNote = categoryStatusNote(payload.categoryStatus);
    return [
      '📋 *Resumen del gasto:*',
      `• Concepto: ${payload.rawMessage.slice(0, 80)}`,
      `• Monto: ${payload.monto ?? ''} ${payload.moneda ?? ''}`,
      `• Categoría: ${categoryLabel}${confidenceNote}${statusNote}`,
      `• Fecha: ${payload.date}`,
      '',
      '¿Confirmamos? Responde *sí*, *corregir campo: valor*, o *cancelar*.',
    ].join('\n');
  },

  updatedSummary: (payload: {
    monto: number | string | null;
    moneda: string | null;
    category: string;
    categoryStatus: 'confirmed' | 'ambiguous' | 'fallback' | 'none';
    date: string;
  }): string => {
    const categoryLabel = formatCategoryLabel(payload.category, payload.categoryStatus);
    const statusNote = categoryStatusNote(payload.categoryStatus);
    return [
      '📋 *Resumen actualizado:*',
      `• Monto: ${payload.monto ?? ''} ${payload.moneda ?? ''}`,
      `• Categoría: ${categoryLabel}${statusNote}`,
      `• Fecha: ${payload.date}`,
      '',
      '¿Confirmamos? Responde *sí*, *corregir campo: valor*, o *cancelar*.',
    ].join('\n');
  },
};

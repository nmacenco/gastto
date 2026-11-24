import { CANCEL_EXIT_HINT, composeMessage, type MessageBlocks } from './compose-message';
import type { RecoveryContext } from '../services/recovery-context';
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

/** Structured copies shared by direct replies and current-state recovery. */
export const expenseGuidanceBlocks = {
  clarificationAmount: (): MessageBlocks => ({
    action: '¿Cuánto gastaste?',
    exit: CANCEL_EXIT_HINT,
  }),
  clarificationCurrency: (): MessageBlocks => ({
    action: '¿En qué moneda fue ese gasto?',
    exit: CANCEL_EXIT_HINT,
  }),
  fallback: (): MessageBlocks => ({
    explanation: 'Parece que algo falló.',
    action: 'Revisá el último mensaje del chat.',
  }),
  retryChoice: (): MessageBlocks => ({
    explanation: 'Verificá tu planilla antes de registrar el gasto nuevamente.',
    action:
      'Respondé *reintentar* para volver a guardar o *reconfigurar* para revisar la planilla.',
    exit: CANCEL_EXIT_HINT,
  }),
  correction: (): MessageBlocks => ({
    explanation: '¿Qué querés corregir?',
    action:
      'Escribí la corrección en lenguaje natural.\n\nPor ejemplo:\n• "no, fueron 15"\n• "ponlo en transporte"\n• "es comida, subcategoría restaurante"\n• "la subcategoría es supermercado"\n• "lo pagué con Visa" o "sin medio de pago"\n• "fue ayer"\n• "no, fueron 15 y es transporte" (varios campos en un solo mensaje).',
    exit: CANCEL_EXIT_HINT,
  }),
  ambiguousReview: (): MessageBlocks => ({
    action: '¿Confirmamos el registro tal como está o lo corregimos?',
    exit: CANCEL_EXIT_HINT,
  }),
};

export const expenseCopies = {
  reviewActions: (highAmount = false) =>
    composeMessage({
      explanation: highAmount
        ? 'Este monto supera notablemente tu gasto promedio. ¿Confirmamos que es correcto?'
        : '',
      action: '¿Confirmamos? Responde *sí* o *corregir campo: valor*.',
      exit: CANCEL_EXIT_HINT,
    }),

  paymentUnresolved: () =>
    composeMessage({
      explanation: 'Antes de guardar, elegí una opción:',
      action: '• medio de pago: Nombre\n• agregar medio de pago\n• sin medio de pago',
      exit: CANCEL_EXIT_HINT,
    }),
  clarificationAmount: () => composeMessage(expenseGuidanceBlocks.clarificationAmount()),
  clarificationCurrency: () => composeMessage(expenseGuidanceBlocks.clarificationCurrency()),
  zeroAmountConfirmation: () =>
    composeMessage({
      explanation: '¿Querías registrar un gasto de $0?',
      action: 'Respondé sí.',
      exit: CANCEL_EXIT_HINT,
    }),
  saving: () => 'Guardando tu gasto…',
  saveNetworkFailure: () =>
    composeMessage({
      explanation:
        'No pude confirmar el guardado por un problema de conexión.\n\nVerificá tu planilla antes de registrar el gasto nuevamente.',
      action: 'Respondé *reintentar* dentro de los próximos 10 minutos.',
      exit: CANCEL_EXIT_HINT,
    }),
  financialOutcomeUnknown: () =>
    composeMessage({
      explanation:
        'Esa operación sigue pendiente de resolución. No puedo iniciar otra hasta que el equipo de soporte la revise.',
      action: 'Contactá al administrador de Gastto.',
    }),
  staleReview: () =>
    composeMessage({
      explanation: 'Ese botón o respuesta corresponde a otro resumen.',
      action: 'Revisá el resumen actual y confirmalo de nuevo.',
    }),
  expiredReview: () =>
    composeMessage({
      explanation: 'Ese resumen expiró.',
      action: 'Revisá el nuevo resumen antes de confirmar.',
    }),
  noActiveReview: () => 'No hay un gasto pendiente de confirmación.',
  saveAuthorizationFailure: () =>
    composeMessage({
      explanation: 'No pude acceder a tu planilla.',
      action: 'Respondé *empezar* para volver a conectar tu cuenta.',
    }),
  queuedAuthorizationFailure: () =>
    composeMessage({
      explanation: 'No pude continuar con los gastos pendientes.',
      action:
        'Respondé *empezar* para reconectar tu cuenta y después enviá esos gastos nuevamente.',
    }),
  saveStructureFailure: () =>
    composeMessage({
      explanation: 'No pude guardar el gasto porque la hoja o sus columnas cambiaron.',
      action: 'Respondé *reconfigurar* para revisar la configuración.',
    }),
  saveRetryExpired: () =>
    composeMessage({
      explanation: 'El tiempo para reintentar este guardado venció.',
      action: 'Verificá tu planilla y registrá el gasto nuevamente.',
    }),
  saveRetryCancelled: () =>
    composeMessage({
      explanation: 'Saliste del flujo de guardado.',
      action: 'Verificá tu planilla antes de registrar el gasto nuevamente.',
    }),
  saveRetryRecoveryChoice: () => composeMessage(expenseGuidanceBlocks.retryChoice()),
  staleFinancialAction: () =>
    composeMessage({
      explanation: 'Esa respuesta corresponde a otra operación.',
      action: 'Revisá la solicitud actual y confirmala de nuevo.',
    }),
  saveManualCopyFallback: (input: { concept: string; amount: number; currency: string }): string =>
    composeMessage({
      explanation: 'No pude confirmar que el gasto se haya guardado.',
      action: `Copiá estos datos manualmente en tu planilla:\n• Concepto: ${input.concept.slice(0, 80)}\n• Monto: ${input.amount} ${input.currency}`,
    }),
  cancelled: () => 'Registro cancelado. No se guardó nada.',
  noActiveExpenseToCancel: () => 'No hay ningún registro pendiente para cancelar.',
  expenseQueueFull: () =>
    composeMessage({
      explanation: 'Ya tenés 3 gastos en curso.',
      action: 'Confirmá o cancelá el actual antes de agregar otro.',
    }),
  expenseQueueNotice: (pendingCount: 1 | 2) =>
    `Tenés ${pendingCount} gasto${pendingCount === 1 ? '' : 's'} pendiente${pendingCount === 1 ? '' : 's'}. Vamos con el siguiente:`,
  expenseQueueNonFinancialReminder: (pendingCount: number) =>
    composeMessage({
      explanation: `Todavía tenés un gasto pendiente de confirmación y ${pendingCount} más en la cola.`,
      action: '¿Querés confirmar o corregir el actual?',
      exit: CANCEL_EXIT_HINT,
    }),
  expenseQueueExpirationAdvance: () =>
    'El registro anterior venció sin confirmación y fue cancelado. Vamos con el siguiente gasto pendiente:',
  expenseQueueClosingSummary: (registeredCount: number) =>
    `¡Listo! Registré ${registeredCount} gasto${registeredCount === 1 ? '' : 's'}. Ya no tenés gastos pendientes.`,
  ambiguousResponse: () => composeMessage(expenseGuidanceBlocks.ambiguousReview()),
  fallbackError: (context: RecoveryContext = 'unknown') =>
    recoveryGuidance(expenseGuidanceBlocks.fallback(), context),
  extractionTimeout: () =>
    composeMessage({
      explanation: 'La interpretación tardó demasiado. No guardé este gasto.',
      action: 'Volvé a enviarlo para intentar de nuevo',
    }),
  extractionFailed: () =>
    composeMessage({
      explanation: 'No pude interpretar este gasto. No lo guardé.',
      action: 'Volvé a enviarlo para intentar de nuevo',
    }),
  expenseRegistrationUnavailable: () =>
    composeMessage({
      explanation: 'El registro de gastos no está disponible en este momento.',
      action: 'Volvé a intentarlo más tarde.',
    }),
  semanticExpenseGuidance: (
    reason:
      | 'ambiguous_intent'
      | 'mixed_intents'
      | 'unsupported_action'
      | 'stale_context'
      | 'registration_unavailable'
      | 'invalid_state_context'
      | 'correction_not_interpretable'
      | 'invalid_subcategory'
      | 'correction_cycle_limit'
      | 'dispatch_failed',
  ) =>
    reason === 'ambiguous_intent' || reason === 'mixed_intents'
      ? composeMessage({
          explanation: 'No me quedó claro qué gasto querés registrar.',
          action: 'Indicá un solo gasto con monto y moneda.',
        })
      : composeMessage({
          explanation: 'No pude procesar ese gasto de forma segura.',
          action: 'Indicá el gasto con monto y moneda para intentarlo de nuevo.',
        }),
  semanticControlGuidance: (
    reason:
      | 'ambiguous_intent'
      | 'mixed_intents'
      | 'stale_context'
      | 'invalid_state_context'
      | 'unsupported_action'
      | 'dispatch_failed',
  ) =>
    reason === 'ambiguous_intent' || reason === 'mixed_intents'
      ? composeMessage({
          explanation: 'No me quedó claro qué querés hacer.',
          action: 'Pedime una sola acción.',
        })
      : composeMessage({
          explanation: 'Esa solicitud ya no corresponde al estado actual.',
          action: 'Revisá la conversación e intentá de nuevo.',
        }),
  undoDeleted: (concept: string, amount: number, currency: string) =>
    `Listo, se eliminó el último registro (${concept.slice(0, 80)}, ${amount} ${currency}).`,
  undoNotFound: () => 'No encontré un registro reciente para deshacer.',
  undoConfirmationRequired: (concept: string, amount: number, currency: string, savedAt: Date) =>
    composeMessage({
      explanation: `¿Querés eliminar '${concept.slice(0, 80)}, ${amount} ${currency}' registrado a las ${savedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}?`,
      action: 'Respondé sí.',
      exit: CANCEL_EXIT_HINT,
    }),
  undoCancelled: () => 'No se eliminó ningún registro.',
  undoExpired: () => 'La confirmación para eliminar ese registro venció. No se eliminó nada.',
  undoDeletionFailed: () =>
    composeMessage({
      explanation: 'No pude eliminar el último registro en este momento.',
      action: 'Verificá tu planilla e intentá de nuevo más tarde.',
    }),
  undoPreparationFailed: () =>
    composeMessage({
      explanation: 'No llegué a eliminar el registro.',
      action: 'Podés seguir usando el chat o escribir deshacer para solicitarlo de nuevo.',
    }),
  clarificationInterrupted: () => 'El registro anterior fue cancelado. Procesando el nuevo gasto…',
  highAmountWarning: () => '⚠️ *Monto inusualmente alto*',
  highAmountConfirmationPrompt: () =>
    'Este monto supera notablemente tu gasto promedio. ¿Confirmamos que es correcto?',
  reviewTimeoutWarning: (pendingCount?: number) =>
    composeMessage({
      explanation:
        pendingCount && pendingCount > 0
          ? `(También tenés ${pendingCount} gasto${pendingCount === 1 ? '' : 's'} esperando en la cola.)`
          : '',
      action: '¿Confirmamos el registro? Respondé *sí* o *corregir*.',
      exit: CANCEL_EXIT_HINT,
    }),
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
  expenseCorrectionPrompt: () => composeMessage(expenseGuidanceBlocks.correction()),
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
    composeMessage({
      explanation: 'Llegamos al límite de correcciones.',
      action: '¿Confirmamos el gasto como está?',
      exit: CANCEL_EXIT_HINT,
    }),
  invalidSubcategory: (input: {
    parentCategory: string;
    attemptedSubcategory: string;
    allowedSubcategories: string[];
  }): string => {
    const guidance =
      input.allowedSubcategories.length === 0
        ? 'Esa categoría no tiene subcategorías configuradas.'
        : `Podés elegir: ${input.allowedSubcategories.join(', ')}.`;
    return composeMessage({
      explanation: `No encontré la subcategoría "${input.attemptedSubcategory}" dentro de "${input.parentCategory}".\n\n${guidance}`,
      action: 'Escribí la subcategoría con su categoría padre.',
      exit: CANCEL_EXIT_HINT,
    });
  },
  categoryChoice: (input: {
    attemptedName: string;
    suggestedName: string | null;
    baseline: { categories: Array<{ name: string; isActive: boolean }> };
  }) => {
    const candidates = input.baseline.categories
      .filter((item) => item.isActive)
      .map((item) => item.name);
    return composeMessage({
      explanation: input.suggestedName
        ? `No encontré "${input.attemptedName}" entre tus categorías. ¿Quisiste decir "${input.suggestedName}"?`
        : `No encontré "${input.attemptedName}" entre tus categorías.`,
      action: `${candidates.length ? `Categorías disponibles: ${candidates.join(', ')}.\n\n` : ''}Escribí "elegir Nombre" para usar una existente${input.suggestedName ? ', o "sí" para usar la sugerida' : ''}. Escribí "agregar" para crear "${input.attemptedName}". Escribí "volver" para regresar al gasto sin este cambio.`,
      exit: CANCEL_EXIT_HINT,
    });
  },
  categoryAddConfirmation: (name: string) =>
    composeMessage({
      explanation: `¿Querés agregar "${name}" a tus categorías? Quedará disponible para futuros gastos aunque canceles este.`,
      action:
        'Escribí "confirmar agregar" para crearla, "no" para elegir otra opción o "volver" para regresar al gasto.',
      exit: CANCEL_EXIT_HINT,
    }),
  subcategoryChoice: (input: {
    attemptedName: string;
    suggestedName: string | null;
    parentCategoryId: string | null;
    parentCategoryName: string | null;
    subcategoryColumnMapped: boolean;
    baseline: { subcategories: Array<{ categoryId: string; name: string; isActive: boolean }> };
  }) => {
    const parent = input.parentCategoryName ?? 'esta categoría';
    const candidates = input.baseline.subcategories
      .filter((child) => child.categoryId === input.parentCategoryId && child.isActive)
      .map((child) => child.name);
    return composeMessage({
      explanation: `No encontré la subcategoría "${input.attemptedName}" dentro de "${parent}".${input.suggestedName ? ` ¿Quisiste decir "${input.suggestedName}"?` : ''}${input.subcategoryColumnMapped ? '' : '\n\nSi la agregás, quedará en Gastto, pero no se escribirá en la planilla porque no hay una columna de subcategoría configurada.'}`,
      action: `${candidates.length ? `Subcategorías disponibles en "${parent}": ${candidates.join(', ')}.\n\n` : `"${parent}" todavía no tiene subcategorías activas.\n\n`}Escribí "elegir Nombre" para usar una existente${input.suggestedName ? ', o "sí" para usar la sugerida' : ''}. Escribí "agregar" para crear "${input.attemptedName}" dentro de "${parent}". Escribí "volver" para regresar al gasto sin este cambio.`,
      exit: CANCEL_EXIT_HINT,
    });
  },
  subcategoryAddConfirmation: (child: string, parent: string) =>
    composeMessage({
      explanation: `¿Querés agregar la subcategoría "${child}" dentro de "${parent}"? Quedará disponible para futuros gastos aunque canceles este.`,
      action:
        'Escribí "confirmar agregar" para crearla, "no" para elegir otra opción o "volver" para regresar al gasto.',
      exit: CANCEL_EXIT_HINT,
    }),
  correctionHighAmountConfirmation: () =>
    composeMessage({
      explanation: 'El monto corregido es inusualmente alto.',
      action: '¿Confirmamos que es correcto? Respondé *sí*.',
      exit: CANCEL_EXIT_HINT,
    }),
  clarificationReformulation: (options: string[]): string => {
    if (options.length === 0) {
      return expenseCopies.clarificationCurrency();
    }
    if (options.length === 1) {
      return composeMessage({ action: `¿El gasto fue en ${options[0]}?`, exit: CANCEL_EXIT_HINT });
    }
    const lastOption = options[options.length - 1];
    const precedingOptions = options.slice(0, -1).join(', ');
    return composeMessage({
      action: `¿El gasto fue en ${precedingOptions} o ${lastOption}?`,
      exit: CANCEL_EXIT_HINT,
    });
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
      expenseCopies.reviewActions(),
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
      expenseCopies.reviewActions(),
    ].join('\n');
  },
};

/** Shared feedback must not advertise actions while a financial claim is unresolved.
 * An omitted exit requests the standard hint; an explicit empty exit suppresses it
 * (for example, when cancellation is already a required step in the action block).
 */
export function recoveryGuidance(blocks: MessageBlocks, context: RecoveryContext): string {
  if (context === 'financially-blocked') return expenseCopies.financialOutcomeUnknown();
  return composeMessage({
    ...blocks,
    exit: context === 'cancellable' ? (blocks.exit ?? CANCEL_EXIT_HINT) : '',
  });
}

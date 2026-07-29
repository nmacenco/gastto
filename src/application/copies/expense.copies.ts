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
  cancelled: () => 'Registro cancelado. No se guardó nada.',
  ambiguousResponse: () => '¿Querías confirmar, corregir o cancelar el registro?',
  fallbackError: () => 'Parece que algo falló. Vamos a empezar de nuevo.',
  expenseRegistrationUnavailable: () =>
    'El registro de gastos no está disponible en este momento. Volvé a intentarlo más tarde.',
  clarificationInterrupted: () => 'El registro anterior fue cancelado. Procesando el nuevo gasto…',
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

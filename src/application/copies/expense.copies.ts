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

  expenseSummary: (payload: {
    rawMessage: string;
    monto: number | string | null;
    moneda: string | null;
    category: string;
    categoryConfidence: string;
    date: string;
  }): string => {
    const confidenceNote = payload.categoryConfidence === 'baja' ? ' (¿correcto?)' : '';
    return [
      '📋 *Resumen del gasto:*',
      `• Concepto: ${payload.rawMessage.slice(0, 80)}`,
      `• Monto: ${payload.monto ?? ''} ${payload.moneda ?? ''}`,
      `• Categoría: ${payload.category}${confidenceNote}`,
      `• Fecha: ${payload.date}`,
      '',
      '¿Confirmamos? Responde *sí*, *corregir campo: valor*, o *cancelar*.',
    ].join('\n');
  },

  updatedSummary: (payload: {
    monto: number | string | null;
    moneda: string | null;
    category: string;
    date: string;
  }): string =>
    [
      '📋 *Resumen actualizado:*',
      `• Monto: ${payload.monto ?? ''} ${payload.moneda ?? ''}`,
      `• Categoría: ${payload.category}`,
      `• Fecha: ${payload.date}`,
      '',
      '¿Confirmamos? Responde *sí*, *corregir campo: valor*, o *cancelar*.',
    ].join('\n'),
};

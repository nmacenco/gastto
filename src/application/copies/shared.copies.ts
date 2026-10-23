export const sharedCopies = {
  welcome: (username?: string) =>
    username
      ? `¡Hola, ${username}! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Escribime un gasto y lo registro en tu planilla automáticamente.`
      : '¡Hola! Bienvenido a Gastto. Soy tu asistente financiero conversacional. Escribime un gasto y lo registro en tu planilla automáticamente.',
  unsupportedMessage: () =>
    'For now I only process text messages. Tell me about your expense by typing it.',
  processingAcknowledgment: () => 'Recibido, procesando tu mensaje…',
  expenseGuidance: () =>
    "¡Hola! Para registrar un gasto escribime el monto y el concepto, por ejemplo: 'Almuerzo 12 euros'.",
};

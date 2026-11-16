import { composeMessage } from './compose-message';
export const sharedCopies = {
  welcome: (username?: string) =>
    composeMessage({
      explanation: username
        ? `¡Hola, ${username}! Bienvenido a Gastto. Soy tu asistente financiero conversacional.`
        : '¡Hola! Bienvenido a Gastto. Soy tu asistente financiero conversacional.',
      action: 'Escribime un gasto y lo registro en tu planilla automáticamente.',
    }),
  unsupportedMessage: () =>
    composeMessage({
      explanation: 'For now I only process text messages.',
      action: 'Tell me about your expense by typing it.',
    }),
  processingAcknowledgment: () => 'Recibido, procesando tu mensaje…',
  processingContentionExhausted: () =>
    composeMessage({
      explanation: 'No pude procesar este mensaje porque todavía estaba terminando el anterior.',
      action: 'Cuando termine, volvé a enviar el mensaje que quedó pendiente.',
    }),
  expenseGuidance: () =>
    "¡Hola! Para registrar un gasto escribime el monto y el concepto, por ejemplo: 'Almuerzo 12 euros'.",
};

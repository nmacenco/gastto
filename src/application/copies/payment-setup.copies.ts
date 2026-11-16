import { CANCEL_EXIT_HINT, composeMessage } from './compose-message';

function review(names: string[], mapped: boolean, confirmation: string): string {
  return composeMessage({
    explanation: `Revisá los medios de pago:\n${names.map((name) => `• ${name}`).join('\n') || '(sin medios de pago)'}${mapped ? '' : '\n\nSin columna mapeada: se guardarán solo en Gastto.'}`,
    action: `Opciones:\n• ${confirmation}\n• agregar Nombre\n• renombrar Nombre a Otro\n• quitar Nombre`,
    exit: CANCEL_EXIT_HINT,
  });
}

export const paymentSetupCopies = {
  onboardingReview: (names: string[], mapped: boolean) =>
    review(names, mapped, 'Escribí confirmar para activar toda la configuración.'),
  settingsReview: (names: string[], mapped: boolean) => review(names, mapped, 'Escribí confirmar.'),
  readFailure: () =>
    composeMessage({
      explanation: 'No pudimos leer los medios de pago.',
      action: 'Escribí confirmar para reintentar.',
      exit: CANCEL_EXIT_HINT,
    }),
};

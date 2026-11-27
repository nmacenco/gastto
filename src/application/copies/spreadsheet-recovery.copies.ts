import { SpreadsheetError } from '../../domain/errors/SpreadsheetError';
import { CANCEL_EXIT_HINT, composeMessage } from './compose-message';

export type SpreadsheetRecoveryFlow = 'onboarding' | 'settings';

export const spreadsheetRecoveryCopies = {
  unsupportedFormat: () =>
    composeMessage({
      explanation: 'Ese archivo no es una planilla nativa de Google.',
      action:
        '1. Abrilo en Google Sheets y guardalo como una planilla de Google.\n2. Pegá el enlace del archivo convertido o elegí otra planilla compatible.',
      exit: CANCEL_EXIT_HINT,
    }),
  chooseAnotherFile: (flow: SpreadsheetRecoveryFlow) =>
    flow === 'onboarding'
      ? 'Para elegir otro archivo:\n1. Escribí cancelar para salir de la configuración actual.\n2. Escribí empezar.'
      : 'Para elegir otro archivo:\n1. Escribí cancelar para salir de la configuración actual.\n2. Escribí configuración.\n3. Elegí la opción 3.',
  emptySheets: (flow: SpreadsheetRecoveryFlow) =>
    composeMessage({
      explanation: 'El archivo no tiene hojas disponibles.',
      action: spreadsheetRecoveryCopies.chooseAnotherFile(flow),
    }),
  readFailure: (error: unknown, flow: SpreadsheetRecoveryFlow, retryCommand = 'reintentar') =>
    error instanceof SpreadsheetError && error.retryable
      ? composeMessage({
          explanation: 'No pude consultar la planilla por un problema temporal.',
          action: `En unos segundos, enviá ${retryCommand} para volver a intentar.`,
          exit: CANCEL_EXIT_HINT,
        })
      : composeMessage({
          explanation: 'No pude leer las hojas o su estructura.',
          action: `Revisá el archivo en Google Sheets. ${spreadsheetRecoveryCopies.chooseAnotherFile(flow)}`,
        }),
};

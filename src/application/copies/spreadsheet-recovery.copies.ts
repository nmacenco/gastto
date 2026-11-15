import { SpreadsheetError } from '../../domain/errors/SpreadsheetError';

export type SpreadsheetRecoveryFlow = 'onboarding' | 'settings';

export const spreadsheetRecoveryCopies = {
  unsupportedFormat: () =>
    'Ese archivo no es una planilla nativa de Google. Abrilo en Google Sheets y guardalo como una planilla de Google; después pegá el enlace del archivo convertido o elegí otra planilla compatible. Escribí cancelar para salir.',
  chooseAnotherFile: (flow: SpreadsheetRecoveryFlow) =>
    flow === 'onboarding'
      ? 'Escribí cancelar para salir y después empezar para elegir otro archivo.'
      : 'Escribí cancelar para salir, después configuración y elegí la opción 3 para seleccionar otro archivo.',
  emptySheets: (flow: SpreadsheetRecoveryFlow) =>
    `El archivo no tiene hojas disponibles. ${spreadsheetRecoveryCopies.chooseAnotherFile(flow)}`,
  readFailure: (error: unknown, flow: SpreadsheetRecoveryFlow, retryCommand = 'reintentar') =>
    error instanceof SpreadsheetError && error.retryable
      ? `No pude consultar la planilla por un problema temporal. En unos segundos, enviá ${retryCommand} para volver a intentar. Escribí cancelar para salir.`
      : `No pude leer las hojas o su estructura. Revisá el archivo en Google Sheets. ${spreadsheetRecoveryCopies.chooseAnotherFile(flow)}`,
};

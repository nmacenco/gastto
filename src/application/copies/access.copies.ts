import { CANCEL_EXIT_HINT, composeMessage } from './compose-message';
export const accessCopies = {
  welcome: () =>
    composeMessage({
      explanation:
        '¡Hola! Soy Gastto. Te ayudo a registrar gastos por chat en tu planilla de Google.',
      action:
        'Cuando tengas acceso, podés escribirme algo como «Almuerzo 12 euros»; te mostraré el gasto para que lo confirmes antes de guardarlo.\n\nEscribí «configuración» para ver o cambiar la planilla, la hoja, las categorías, los medios de pago y tu cuenta de Google.',
    }),
  askEmail: () =>
    composeMessage({
      explanation: 'Para empezar, escribí el email de la cuenta de Google que querés usar.',
      action: 'Te avisaré por este chat cuando se apruebe tu solicitud.',
    }),
  invalidEmail: () =>
    composeMessage({
      explanation: 'El email que ingresaste no tiene un formato válido.',
      action: 'Revisalo y volvé a escribirlo.',
    }),
  requestSaveFailed: () =>
    composeMessage({
      explanation: 'No pudimos guardar tu solicitud.',
      action: 'Volvé a enviar el email para intentarlo de nuevo.',
    }),
  invalidReplacementEmail: () =>
    composeMessage({
      explanation: 'El email que ingresaste no tiene un formato válido.',
      action: 'Revisalo y volvé a escribirlo.',
      exit: CANCEL_EXIT_HINT,
    }),
  replacementSameEmail: () =>
    composeMessage({
      explanation: 'Ese ya es tu email actual.',
      action: 'Escribí otro email.',
      exit: CANCEL_EXIT_HINT,
    }),
  replacementSaveFailed: () =>
    composeMessage({
      explanation: 'No pudimos guardar el cambio de email.',
      action: 'Volvé a enviarlo para intentarlo de nuevo.',
      exit: CANCEL_EXIT_HINT,
    }),
  pending: () => 'Recibimos tu solicitud. Te avisaremos por Telegram cuando esté autorizada.',
  pendingAgain: () =>
    'Tu solicitud sigue pendiente. Te avisaremos por Telegram cuando esté autorizada.',
  approved: () =>
    composeMessage({
      explanation: 'Tu cuenta ya está autorizada.',
      action: 'Escribí continuar para conectar Google.',
    }),
  approvedNotice: () =>
    composeMessage({
      explanation: 'Tu acceso fue aprobado.',
      action: 'Escribí continuar para conectar Google.',
    }),
  replacementApprovedNotice: () =>
    composeMessage({
      explanation: 'El nuevo email fue aprobado.',
      action:
        '1. Abrí configuración.\n2. Elegí 7.\n3. Escribí continuar para conectar la nueva cuenta.',
    }),
  replacementPrompt: () =>
    composeMessage({
      explanation:
        'Tu cuenta y planilla actuales seguirán funcionando hasta que completes la nueva conexión.',
      action: 'Escribí el nuevo email de Google.',
    }),
  replacementReady: () =>
    composeMessage({
      explanation: 'El nuevo email está aprobado.',
      action: 'Escribí continuar para conectar Google.',
      exit: CANCEL_EXIT_HINT,
    }),
  replacementPending: () =>
    composeMessage({
      explanation: 'El cambio de email está pendiente.',
      action: 'Si querés corregirlo, escribí el nuevo email en configuración.',
    }),
  continue: () => 'Escribí continuar para conectar Google.',
  pendingOAuth: () =>
    composeMessage({
      explanation: 'La autorización de Google sigue pendiente.',
      action: 'Escribí continuar para recibir un enlace nuevo.',
      exit: CANCEL_EXIT_HINT,
    }),
  activeFlowNeedsExit: () =>
    composeMessage({
      explanation: 'Hay un flujo en curso. Tu borrador no se descartará automáticamente.',
      action: '1. Escribí cancelar para salir.\n2. Escribí continuar para conectar Google.',
    }),
  oauthUnavailable: () =>
    composeMessage({
      explanation: 'La conexión con Google no está disponible en este momento.',
      action: 'Intentá más tarde.',
    }),
};

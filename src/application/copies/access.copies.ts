export const accessCopies = {
  welcome: () =>
    '¡Hola! Soy Gastto. Te ayudo a registrar gastos por chat en tu planilla de Google. Cuando tengas acceso, podés escribirme algo como «Almuerzo 12 euros»; te mostraré el gasto para que lo confirmes antes de guardarlo. Escribí «configuración» para ver o cambiar la planilla, la hoja, las categorías, los medios de pago y tu cuenta de Google.',
  askEmail: () =>
    'Para empezar, escribí el email de la cuenta de Google que querés usar. Te avisaré por este chat cuando se apruebe tu solicitud.',
  invalidEmail: () =>
    'El email que ingresaste no tiene un formato válido. Revisalo y volvé a escribirlo.',
  pending: () => 'Recibimos tu solicitud. Te avisaremos por Telegram cuando esté autorizada.',
  pendingAgain: () =>
    'Tu solicitud sigue pendiente. Te avisaremos por Telegram cuando esté autorizada.',
  approved: () => 'Tu cuenta ya está autorizada. Escribí continuar para conectar Google.',
  approvedNotice: () => 'Tu acceso fue aprobado. Escribí continuar para conectar Google.',
  replacementApprovedNotice: () =>
    'El nuevo email fue aprobado. Abrí configuración, elegí 7 y escribí continuar para conectar la nueva cuenta.',
  replacementPrompt: () =>
    'Escribí el nuevo email de Google. Tu cuenta y planilla actuales seguirán funcionando hasta que completes la nueva conexión.',
  replacementReady: () =>
    'El nuevo email está aprobado. Escribí continuar para conectar Google o cancelar para salir.',
  replacementPending: () =>
    'El cambio de email está pendiente. Si querés corregirlo, escribí el nuevo email en configuración.',
  continue: () => 'Escribí continuar para conectar Google.',
  pendingOAuth: () =>
    'La autorización de Google sigue pendiente. Escribí continuar para recibir un enlace nuevo o cancelar para salir.',
  activeFlowNeedsExit: () =>
    'Hay un flujo en curso. Escribí cancelar para salir y luego continuar para conectar Google. Tu borrador no se descartará automáticamente.',
  oauthUnavailable: () =>
    'La conexión con Google no está disponible en este momento. Intentá más tarde.',
};

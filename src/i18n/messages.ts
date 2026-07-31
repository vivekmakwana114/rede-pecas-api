
interface PaymentMethodCopy {
  name: string;
  instructions: (orderNumber: string, amount: string) => string;
}

interface Messages {
  common: {
    notUnderstood: () => string;
    alreadyAnswered: () => string;
  };
  onboarding: {
    welcome: () => string;
    welcomeBack: (name: string) => string;
    resumeRegistration: () => string;
    askNameOnly: () => string;
    askVehicleIdBody: (name: string) => string;
    askVehicleIdButtons: [string, string, string];
    resumeVehicleIdBody: (name: string) => string;
    onboardingComplete: (name: string, vehicleSummary: string) => string;
  };
  manual: {
    askModel: (make: string) => string;
    askYear: (make: string, model: string) => string;
    invalidYear: () => string;
    askEngineNumber: (make: string, model: string, year: string) => string;
    collectionComplete: (summary: string) => string;
    askMakePrompt: () => string;
    engineLabel: (engineNumber: string) => string;
  };
  vin: {
    askVinPrompt: () => string;
    identifying: () => string;
    decodeFailed: () => string;
    decodeFailedButtons: [string, string];
    restartChoiceBody: () => string;
    invalidLength: (length: number) => string;
    modelUnknownNote: () => string;
    confirmBody: (description: string) => string;
    confirmButtons: [string, string];
    alreadyRegistered: (description: string) => string;
    alreadyRegisteredButtons: [string, string];
  };
  document: {
    askPhotoPrompt: () => string;
    received: () => string;
    downloadFailed: () => string;
    processingError: () => string;
    notRecognized: () => string;
    invalid: () => string;
    missingEssentialData: () => string;
    confirmBody: (description: string) => string;
    licensePlateLabel: (plate: string) => string;
    chassisLabel: (vin: string) => string;
    retryButtons: [string, string];
  };
  vehicleConfirm: {
    confirmedAskPart: (make: string, model: string, year: string, greetingName?: string) => string;
    addVehicleButton: () => string;
    addVehicleBody: () => string;
    chooseVehiclePrompt: (vehicles: { make: string; model: string; year: string }[], greetingName?: string) => string;
    vehicleChoiceNotFound: () => string;
  };
  agent: {
    checkingStock: () => string;
    noStockFound: () => string;
    noStockFoundButtons: [string, string];
    // Used (instead of noStockFound) when nothing at all matched the
    // search — not even an out-of-stock listing — so there's no real
    // product to attach a waitlist request to. No question, no promise.
    noStockFoundNoWaitlist: () => string;
    optionNotFound: () => string;
    serviceUnavailable: () => string;
    waitlistConfirmed: (productName: string) => string;
    waitlistDeclined: () => string;
    restockNotification: (name: string, productName: string, vehicleSummary: string | null, price: string, supplier: string) => string;
    restockNotificationButtons: [string, string];
    proformaSentChoosePayment: () => string;
    transferToHuman: () => string;
    searchListBody: (count: number, part: string, name: string) => string;
    searchListBodyForVehicle: (count: number, part: string, make: string, model: string, year: string, name: string) => string;
    searchListButton: () => string;
    productSelected: (productName: string, price: string) => string;
    serviceListBody: (count: number) => string;
    serviceListButton: () => string;
    serviceSkipOption: () => string;
    serviceAdded: (serviceName: string, newTotal: string) => string;
    serviceDeclined: () => string;
    confirmingAvailability: () => string;
    stockConfirmedIntro: (productName: string, customerName: string) => string;
    stockConfirmationCourtesy: () => string;
    stockUnavailable: (productName: string, reference: string) => string;
    stockUnavailableButtons: [string, string];
    basketRequestSummary: (productNames: string[], name: string) => string;
    basketSummaryBody: (items: { description: string; price: string }[], name: string, total: string) => string;
    basketPartialAvailability: (availableNames: string[], unavailableNames: string[]) => string;
    basketNoneAvailableYet: (unavailableNames: string[]) => string;
    basketAllUnavailable: () => string;
    basketDeclinedNotice: (declinedNames: string[]) => string;
    // Search-time (pre-order) equivalents — sent once, after every queued
    // part in a multi-item search came back with no in-stock match, instead
    // of a repeated per-item "not in stock" message. Distinct from
    // basketNoneAvailableYet/basketAllUnavailable above, which cover the
    // unrelated post-order admin-rejects-stock flow.
    basketSearchAllUnavailableWaitlistOffer: () => string;
    basketSearchAllUnavailableNoWaitlist: () => string;
    basketWaitlistConfirmed: () => string;
    basketSearchPartialNotice: (missingNames: string[]) => string;
    alternativesListBody: (productName: string, count: number) => string;
    alternativeSkipOption: () => string;
    noAlternativesFound: (productName: string) => string;
    askPartTypeBody: (count: number) => string;
    askPartTypeButton: () => string;
    partTypeRows: { id: string; title: string; description: string }[];
    partTypeNotUnderstood: () => string;
  };
  order: {
    rejected: (orderNumber: string) => string;
    statusRequestAck: () => string;
    statusNotFound: () => string;
  };
  /**
   * Individual/company + NIF + address capture, asked once per order right
   * after the order bucket is confirmed, before stock is checked — replaces
   * the old onboarding NIF/address registration-time prompts.
   */
  orderProfile: {
    askCustomerTypeBody: (name: string) => string;
    askCustomerTypeButtons: [string, string];
    askCompanyNifBody: () => string;
    askCompanyNifInvalid: () => string;
    askCompanyAddressBody: (name: string) => string;
    askIndividualAddressBody: (name: string) => string;
    askIndividualNifBody: () => string;
    askIndividualNifButtons: [string, string];
    askIndividualNifNumberBody: () => string;
    addressSaved: () => string;
    nifSaved: () => string;
    allSet: () => string;
    savedProfileSummary: (name: string, address: string, customerType: 'individual' | 'company', nif: string | null) => string;
    savedProfileUseButton: () => string;
    savedProfileEditButton: () => string;
    savedProfileNotUnderstood: () => string;
  };
  payment: {
    methods: {
      bankTransfer: PaymentMethodCopy;
      bankDeposit: PaymentMethodCopy;
      multicaixaExpress: PaymentMethodCopy;
      mobilePOS: PaymentMethodCopy;
    };
    askMethodBody: (orderNumber: string, amount: string) => string;
    askMethodButtons: [string, string, string];
    askBankSubtypeBody: () => string;
    askBankSubtypeButtons: [string, string];
    proofReceivedCustomer: (customerName: string) => string;
    proofInvalid: () => string;
    supplierDeliveryNotice: (productName: string, reference: string, quantity: number, orderNumber: string) => string;
  };
  pdf: {
    proforma: {
      companyName: string;
      tagline: string;
      phone: string;
      email: string;
      title: string;
      numberLabel: (orderNumber: string) => string;
      dateLabel: (date: string) => string;
      validityLabel: (date: string) => string;
      clientHeader: string;
      whatsappLabel: (phone: string) => string;
      clientDataNote: string;
      tableDescription: string;
      tableReference: string;
      tableQty: string;
      tableUnitPrice: string;
      tableTotal: string;
      supplierLabel: (supplier: string) => string;
      totalDue: string;
      servicesHeader: () => string;
      servicesTotal: () => string;
      paymentInstructionsHeader: string;
      bankLine: string;
      multicaixaLine: string;
      referenceLine: (orderNumber: string) => string;
      afterPaymentLine: string;
      termsNote: string;
      footer: string;
    };
    sendMessage: {
      documentCaption: (orderNumber: string) => string;
    };
    finalInvoice: {
      notification: (customerName: string) => string;
      documentCaption: (orderNumber: string) => string;
      orderStatusButtonLabel: () => string;
    };
    invoice: {
      headerTitle: string;
      tagline: string;
      nifLine: string;
      title: string;
      numberLabel: (num: string) => string;
      dateLabel: (date: string) => string;
      clientHeader: string;
      nameLine: string;
      whatsappLabel: (phone: string) => string;
      tableDescription: string;
      tableReference: string;
      tableQty: string;
      tableUnitPrice: string;
      tableTotal: string;
      defaultProductName: string;
      totalPaid: string;
      servicesHeader: () => string;
      servicesTotal: () => string;
      agtStamp: string;
    };
  };
  validation: {
    invalidName: () => string;
    invalidAddress: () => string;
    invalidNif: () => string;
    invalidMake: () => string;
    invalidModel: () => string;
    invalidEngineNumber: () => string;
  };
  adminAuth: {
    resetCode: (code: string) => string;
  };
  admin: {
    stockConfirmationNeeded: (
      orderNumber: string,
      productName: string,
      reference: string,
      supplier: string,
      amount: string,
      customerName: string,
      customerPhone: string
    ) => string;
    confirmButtonLabel: () => string;
    unavailableButtonLabel: () => string;
    reminderBody: (customerName: string, productName: string, orderNumber: string) => string;
    confirmedAck: (orderNumber: string) => string;
    unavailableAck: (orderNumber: string) => string;
    itemRecordedWaitingOnOthers: (orderNumber: string) => string;
    itemRecordedAlternativeSearch: (orderNumber: string) => string;
    itemRecordedAllUnavailable: (orderNumber: string) => string;
    alreadyHandled: (orderNumber: string) => string;
    useButtonsPrompt: () => string;
    approvePaymentButtonLabel: () => string;
    rejectPaymentButtonLabel: () => string;
    paymentApprovedAck: (orderNumber: string) => string;
    paymentRejectedAck: (orderNumber: string) => string;
    inPersonPaymentRequested: (
      orderNumber: string,
      methodName: string,
      amount: string,
      customerName: string,
      customerPhone: string,
      address: string
    ) => string;
    paymentProofReceived: (
      orderNumber: string,
      methodName: string,
      amount: string,
      customerName: string,
      customerPhone: string
    ) => string;
    orderStatusRequested: (
      orderNumber: string,
      placedDate: string,
      status: string,
      partsSummary: string,
      amountPaid: string,
      customerName: string,
      customerPhone: string,
      address: string
    ) => string;
  };
}

const pt: Messages = {
  /**
   * Generic fallback replies used across button/choice flows when the
   * customer's response doesn't match an expected option, or repeats one
   * already handled.
   */
  common: {
    notUnderstood: () =>
      `🤔 Não percebi essa resposta. Escolhe uma das opções abaixo:`,
    alreadyAnswered: () =>
      `🤔 Essa já foi respondida! Vê a última mensagem para continuares.`,
  },
  /**
   * Customer profile registration flow — welcome/greeting, name/NIF/address
   * collection prompts, and the hand-off into vehicle identification once
   * the profile is complete.
   */
  onboarding: {
    welcome: () =>
      `Olá! Bem-vindo à Rede Peças, o teu marketplace automóvel angolano!\n\n` +
      `Eu sou o Xico Peças, o teu assistente.\n\n` +
      `Nos nossos fornecedores vou encontrar as melhores opções para ti — rápido.\n\n` +
      `Peças  •  Lubrificantes  •  Acessórios  •  Serviços\n\n` +
      `Vais poupar tempo, combustível, saldo e stress.\n\n` +
      `Vamos começar! Como te chamas?`,
    welcomeBack: (name) =>
      `👋 Olá de novo, *${name}*! Bem-vindo de volta à *Rede Peças*. 😊`,
    resumeRegistration: () =>
      `👋 Vamos continuar o teu registo!`,
    askNameOnly: () => `*Como te chamas?* 👇`,
    askVehicleIdBody: (name) =>
      `✅ *Perfil criado com sucesso, ${name}!*\n\n` +
      `Da próxima vez que nos contactares já te reconheço. 😊\n\n` +
      `Agora preciso identificar o teu veículo. Escolhe uma opção 👇`,
    askVehicleIdButtons: ['🔢 Tenho o VIN', '📄 Enviar foto', '✍️ Manual'],
    resumeVehicleIdBody: (name) =>
      `👋 Bem-vindo de volta, *${name}*!\n\n` +
      `Ainda preciso identificar o teu veículo. Escolhe uma opção 👇`,
    onboardingComplete: (name, vehicleSummary) =>
      `✅ Ficaste registado na *Rede Peças*, ${name}! 🎉\n\n` +
      `${vehicleSummary}\n\n` +
      `Como posso ajudar-te hoje? Diz-me que peça precisas e vou já procurar no nosso stock. 👇`,
  },
  /**
   * Manual vehicle-entry wizard — the make/model/year/engine-number step
   * machine used when VIN decode and document photo both fail or aren't
   * available.
   */
  manual: {
    askModel: (make) =>
      `✅ *${make}*\n\nAgora diz-me o *modelo* do veículo.\n\n` +
      `Exemplo: _Hilux, L200, Actros, Sprinter, Ranger..._`,
    askYear: (make, model) =>
      `✅ *${make} ${model}*\n\nQual é o *ano* do veículo?\n\n` +
      `Exemplo: _2015, 2018, 2020..._`,
    invalidYear: () =>
      `⚠️ Ano inválido. Indica um ano entre *1980* e *${new Date().getFullYear()}*.\n\nExemplo: _2018_`,
    askEngineNumber: (make, model, year) =>
      `✅ *${make} ${model} ${year}*\n\n` +
      `Qual é o *número do motor*? _(opcional)_\n\n` +
      `Este número é importante para peças de motor, revisões e manutenção.\n\n` +
      `Se não souberes, responde *"não sei"* e continuamos. 👇`,
    collectionComplete: (summary) =>
      `✅ Perfeito! Registei os dados da tua viatura:\n\n` +
      `${summary}\n\n` +
      `Agora diz-me que peça precisas e eu vou procurar no nosso stock. 👇`,
    askMakePrompt: () =>
      `Sem problema! Vamos preencher os dados manualmente.\n\n` +
      `Qual é a *marca* do veículo?\n\nExemplo: _Toyota, Mercedes, Volvo..._`,
    engineLabel: (engineNumber) => `🔧 Motor: *${engineNumber}*`,
  },
  /**
   * VIN-based vehicle identification — prompt for the chassis number,
   * NHTSA decode failure/retry handling, and confirm/already-registered
   * responses once a vehicle is decoded.
   */
  vin: {
    askVinPrompt: () =>
      `🔢 Perfeito! Envia o número de chassi (VIN) — 17 caracteres, encontras ` +
      `no documento do veículo ou gravado no próprio chassi.`,
    identifying: () => `🔍 A identificar a viatura pelo número de chassi...`,
    decodeFailed: () =>
      `⚠️ Não consegui identificar esse número de chassi.\n\n` +
      `Queres tentar identificar o veículo de outra forma, ou preencher os dados manualmente?`,
    decodeFailedButtons: ['🔄 Tentar novamente', '✍️ Manual'],
    restartChoiceBody: () =>
      `Sem problema! Como preferes identificar o veículo? 👇`,
    invalidLength: (length) =>
      `⚠️ Isso não parece ser um VIN válido — tem ${length} caracteres, mas um VIN tem sempre *17*.\n\n` +
      `Confere o número e envia novamente, ou escolhe outra opção abaixo 👇`,
    modelUnknownNote: () => `modelo não identificado`,
    confirmBody: (description) =>
      `✅ Viatura identificada!\n\n🚗 *${description}*\n\nÉ este o teu carro?`,
    confirmButtons: ['✅ Sim, é este', '❌ Não, é outro'],
    alreadyRegistered: (description) =>
      `Parece que esta viatura já está no teu perfil! 😊\n\n🚗 *${description}*\n\n` +
      `Queres procurar uma peça para este carro, ou adicionar uma viatura diferente?`,
    alreadyRegisteredButtons: ['🔍 Procurar peça', '➕ Carro diferente'],
  },
  /**
   * Vehicle-document photo identification (Claude Vision extraction) —
   * prompts, download/processing errors, and the resulting
   * make/model confirmation.
   */
  document: {
    askPhotoPrompt: () =>
      `📄 Perfeito! Tira uma foto nítida do documento do veículo (livrete/Título) e envia aqui.\n\n` +
      `Garante que o texto está legível e bem iluminado.`,
    received: () => `📄 Recebi a foto. A ler os dados do documento...`,
    downloadFailed: () =>
      `⚠️ Não consegui descarregar a imagem. Por favor tenta enviar novamente, ` +
      `ou responde *"não tenho"* para preencheres os dados manualmente.`,
    processingError: () =>
      `⚠️ Ocorreu um erro ao processar o documento. Por favor tenta novamente, ` +
      `ou responde *"não tenho"* para preencheres os dados manualmente.`,
    notRecognized: () =>
      `Essa imagem não parece ser um documento de viatura (livrete/Título do Veículo).\n\n` +
      `Podes enviar o número de chassi (VIN) por texto, tentar outra foto, ` +
      `ou responder *"não tenho"* para preencheres os dados manualmente.`,
    invalid: () =>
      `Tive dificuldade em ler essa imagem. Acontece! 📸\n\n` +
      `Algumas dicas:\n` +
      `• Garante que o documento está bem iluminado\n` +
      `• Segura a câmara firme e perto\n` +
      `• Evita reflexos ou sombras no texto\n\n` +
      `Tenta novamente, ou toca abaixo para inserires os dados manualmente.`,
    missingEssentialData: () =>
      `⚠️ Consegui ler o documento mas faltam dados essenciais (marca/modelo).\n\n` +
      `Por favor tenta outra foto, ou responde *"não tenho"* para preencheres os dados manualmente.`,
    confirmBody: (description) =>
      `✅ Dados lidos do documento!\n\n🚗 *${description}*\n\nÉ este o teu carro?`,
    licensePlateLabel: (plate) => `Matrícula: ${plate}`,
    chassisLabel: (vin) => `Chassi: ${vin}`,
    retryButtons: ['🔄 Tentar novamente', '✍️ Manual'],
  },
  /**
   * Vehicle confirmation and multi-vehicle selection — the Sim/Não
   * confirm step, the "add another vehicle" flow, and the "which
   * vehicle is this for?" picker for customers with 2+ vehicles on file.
   */
  vehicleConfirm: {
    confirmedAskPart: (make, model, year, greetingName) =>
      greetingName
        ? `Olá de novo, ${greetingName}! 👋 Bom ter-te de volta.\n\n` +
          `Que peça precisas para o teu *${make} ${model} ${year}* hoje?`
        : `Perfeito! 🙌\n\n` +
          `Agora diz-me que peça precisas para o teu *${make} ${model} ${year}*.\n\n` +
          `Exemplo: _"filtro de óleo"_, _"pastilhas de travão"_, _"correia de distribuição"_...`,
    addVehicleButton: () => '➕ Outro carro',
    addVehicleBody: () =>
      `Claro! Vamos adicionar outro veículo ao teu perfil. 🚗\n\n` +
      `Como preferes identificá-lo?`,
    chooseVehiclePrompt: (vehicles, greetingName) =>
      (greetingName ? `Olá de novo, ${greetingName}! 👋 Bom ter-te de volta.\n\n` : '') +
      `Para qual dos teus veículos é isto? 👇\n\n` +
      vehicles.map((v, i) => `${i + 1}️⃣ ${v.make} ${v.model} ${v.year}`).join('\n') +
      `\n\nResponde com o número. 👇`,
    vehicleChoiceNotFound: () =>
      `Não percebi. Responde só com o número do veículo. 👆`,
  },
  /**
   * Product search and stock/order lifecycle messages — search results,
   * waitlist/restock notifications, related-service upsell, and
   * supplier stock-confirmation outcomes.
   */
  agent: {
    checkingStock: () => `Um momento, estou a verificar o nosso stock para ti...`,
    noStockFound: () =>
      `Infelizmente não encontrei essa peça em stock agora. 😔\n\n` +
      `Posso registar-te na lista de espera e avisar-te assim que estiver disponível.\n\n` +
      `Queres que eu faça isso?`,
    noStockFoundButtons: ['✅ Sim, avisa-me', '❌ Não, obrigado'],
    noStockFoundNoWaitlist: () =>
      `Infelizmente não encontrei essa peça, nem nada parecido, no nosso catálogo neste momento. 😔`,
    optionNotFound: () =>
      `Não consegui identificar a opção escolhida. Por favor responde com o número (ex: 1, 2 ou 3).`,
    serviceUnavailable: () =>
      `⚠️ Estamos com uma instabilidade temporária na nossa plataforma. Por favor tenta novamente daqui a alguns minutos. 🙏`,
    waitlistConfirmed: (productName) =>
      `✅ Perfeito! Vou avisar-te assim que *${productName}* estiver disponível.`,
    waitlistDeclined: () => `Sem problema! 👍`,
    restockNotification: (name, productName, vehicleSummary, price, supplier) =>
      `📦 Boas notícias, ${name}! 🎉\n\n` +
      `A peça que estavas à espera já está disponível em stock:\n\n` +
      `🔧 *${productName}*${vehicleSummary ? ` — ${vehicleSummary}` : ''}\n` +
      `💰 ${price} · ${supplier}\n\n` +
      `Queres fazer o pedido agora?`,
    restockNotificationButtons: ['✅ Pedir agora', '❌ Agora não'],
    productSelected: (productName, price) =>
      `Escolheste *${productName}* — ${price}.`,
    serviceListBody: (count) =>
      `Este produto tem ${count} serviço(s) relacionado(s) disponíveis. Escolhe um abaixo para adicionar, ou continua só com o produto 👇`,
    serviceListButton: () => 'Ver serviços',
    serviceSkipOption: () => '❌ Não, obrigado',
    serviceAdded: (serviceName, newTotal) =>
      `✅ *${serviceName}* adicionado ao teu pedido. Novo total: *${newTotal}*.`,
    serviceDeclined: () => `Sem problema! 👍`,
    confirmingAvailability: () =>
      `Óptima escolha! 👍\n\n` +
      `Deixa-me só confirmar a disponibilidade com o fornecedor antes de avançarmos.\n\n` +
      `Isto costuma demorar alguns minutos — já volto! ⏳`,
    stockConfirmedIntro: (productName, customerName) =>
      `Boas notícias, ${customerName}! ✅\n\n` +
      `O fornecedor confirmou que *${productName}* está disponível e pronto para ti.\n\n` +
      `A tua factura proforma segue abaixo. 👇`,
    stockConfirmationCourtesy: () =>
      `Desculpa a demora! 🙏\n\n` +
      `Ainda estamos a confirmar a disponibilidade com o fornecedor.\n` +
      `A nossa equipa vai responder-te dentro de alguns minutos.\n\n` +
      `Obrigado pela paciência! 😊`,
    stockUnavailable: (productName, reference) =>
      `Desculpa. 😔\n\n` +
      `O fornecedor acabou de confirmar que *${productName}* (Ref: ${reference}) já não está disponível.\n\n` +
      `Não foi cobrado nenhum pagamento — não há nada com que te preocupares. 👍\n\n` +
      `Queres que eu procure uma alternativa?`,
    stockUnavailableButtons: ['✅ Alternativas', '❌ Lista de espera'],
    basketRequestSummary: (productNames, name) =>
      `Boa, ${name}! Percebi que precisas de:\n\n` +
      productNames.map((p, idx) => `${idx + 1}. ${p}`).join('\n') +
      `\n\nVamos começar pelo primeiro. 👇`,
    basketSummaryBody: (items, name, total) =>
      `Aqui está o que selecionaste, ${name}: 🛒\n\n` +
      items.map((i, idx) => `${idx + 1}. ${i.description} — ${i.price}`).join('\n') +
      `\n\n*Total: ${total}*`,
    basketPartialAvailability: (availableNames, unavailableNames) =>
      `Boas notícias — ${availableNames.join(', ')} ${availableNames.length > 1 ? 'estão' : 'está'} disponíve${availableNames.length > 1 ? 'is' : 'l'}! ✅\n\n` +
      `⚠️ Infelizmente ${unavailableNames.join(', ')} ${unavailableNames.length > 1 ? 'não estão' : 'não está'} disponíve${unavailableNames.length > 1 ? 'is' : 'l'} no momento. Vou procurar alternativas para ti.`,
    basketNoneAvailableYet: (unavailableNames) =>
      `⚠️ Infelizmente ${unavailableNames.join(', ')} ${unavailableNames.length > 1 ? 'não estão' : 'não está'} disponíve${unavailableNames.length > 1 ? 'is' : 'l'} no momento. Vou procurar alternativas para ti.`,
    basketAllUnavailable: () =>
      `Desculpa. 😔\n\nO fornecedor confirmou que nenhum dos itens deste pedido está disponível no momento.\n\nNão foi cobrado nenhum pagamento — não há nada com que te preocupares. 👍`,
    basketDeclinedNotice: (declinedNames) =>
      `Sem problema — segui em frente sem ${declinedNames.join(', ')}. 👍`,
    basketSearchAllUnavailableWaitlistOffer: () =>
      `Procurei por todo o lado mas não encontrei essas peças em stock neste momento. 😔\n\n` +
      `Posso registar-te na lista de espera e avisar-te assim que estiverem disponíveis.\n\n` +
      `Queres que eu faça isso?`,
    basketSearchAllUnavailableNoWaitlist: () =>
      `Procurei por todo o lado mas não encontrei nenhuma dessas peças — nem nada parecido — no nosso catálogo neste momento. 😔`,
    basketWaitlistConfirmed: () =>
      `Perfeito, ficaste registado! 🎉 Aviso-te assim que alguma dessas peças voltar a estar disponível.`,
    basketSearchPartialNotice: (missingNames) =>
      `_Já agora — não encontrei ${missingNames.join(', ')}, por isso ${missingNames.length > 1 ? 'não ficaram' : 'não ficou'} no teu pedido abaixo._`,
    alternativesListBody: (productName, count) =>
      `Encontrei ${count} alternativa${count > 1 ? 's' : ''} para *${productName}*. Qual preferes? 👇`,
    alternativeSkipOption: () => `Nenhuma, seguir sem este item`,
    noAlternativesFound: (productName) =>
      `Desculpa, não encontrei nenhuma alternativa para *${productName}* no momento — vou deixá-lo de fora do teu pedido.`,
    proformaSentChoosePayment: () =>
      `Proforma enviada! Por favor escolhe um dos métodos de pagamento abaixo. 👇`,
    transferToHuman: () =>
      `Entendido! Vou transferir-te para um dos nossos atendentes. Um momento por favor 🙏`,
    searchListBody: (count, part, name) =>
      `Boas notícias, ${name}! 🙌 Encontrei ${count} opção(ões) de *${part}*. Escolhe uma abaixo 👇`,
    searchListBodyForVehicle: (count, part, make, model, year, name) =>
      `Boas notícias, ${name}! 🙌 Encontrei ${count} opção(ões) de *${part}* para o teu *${make} ${model} ${year}*. Escolhe uma abaixo 👇`,
    searchListButton: () => 'Ver opções',
    askPartTypeBody: (count) =>
      `Antes de procurar — que tipo de peça${count > 1 ? 's' : ''} preferes?` +
      (count > 1 ? `\n\n_Aplica-se a${count > 1 ? 's' : ''} ${count} peças do teu pedido._` : ''),
    askPartTypeButton: () => 'Escolher tipo de peça',
    partTypeRows: [
      { id: 'oem', title: 'OEM', description: 'Peça original do fabricante' },
      { id: 'aftermarket', title: 'Aftermarket', description: 'Peça compatível, outras marcas' },
      { id: 'new', title: 'Nova', description: 'Nova, nunca usada' },
      { id: 'second_hand', title: 'Usada', description: 'Usada, testada, preço mais baixo' },
    ],
    partTypeNotUnderstood: () => 'Por favor toca no botão acima e escolhe um dos quatro tipos. 👇',
  },
  /**
   * Order-level customer notices, currently just the payment-rejection
   * message sent when a submitted proof couldn't be confirmed.
   */
  order: {
    rejected: (orderNumber) =>
      `Infelizmente não conseguimos confirmar o teu pagamento para o pedido ${orderNumber}. 😔\n\n` +
      `Isto pode acontecer se o comprovativo estava pouco nítido ou a referência de pagamento estava em falta.\n\n` +
      `Se achas que isto é um erro, responde aqui e um dos nossos colaboradores vai ajudar-te a resolver isso já. 👇`,
    statusRequestAck: () =>
      `Obrigado! 🙏\n\nA nossa equipa de suporte vai contactar-te em breve com a informação mais recente sobre o teu pedido.\n\nGeralmente respondemos em poucos minutos durante o horário de funcionamento (Seg–Sáb, 8h–18h).`,
    statusNotFound: () =>
      `Ainda não encontrei nenhum pedido pago associado ao teu número. Se achas que isto é um erro, responde aqui e um dos nossos colaboradores vai ajudar-te. 👇`,
  },
  orderProfile: {
    askCustomerTypeBody: (name) =>
      `Boa, ${name}! Só mais uma coisa antes de verificar a disponibilidade.\n\n` +
      `Compras como *particular* ou para uma *empresa*?`,
    askCustomerTypeButtons: ['👤 Particular', '🏢 Empresa'],
    askCompanyNifBody: () =>
      `Perfeito. Para facturas de empresa preciso do teu *NIF* — é obrigatório por lei para a factura.\n\n` +
      `Escreve o teu número de NIF abaixo. 👇`,
    askCompanyNifInvalid: () =>
      `Isso não parece um NIF válido. 🤔\n\n` +
      `O NIF é obrigatório para facturas de empresa — verifica o número e escreve novamente abaixo.`,
    askCompanyAddressBody: (name) =>
      `NIF guardado ✅\n\n` +
      `E qual é o *endereço de entrega*, ${name}?\n` +
      `Exemplo: _Bairro Morro Bento, Rua da Samba, Nº 12, Luanda_`,
    askIndividualAddressBody: (name) =>
      `Entendido! Qual é o teu *endereço de entrega* preferido, ${name}?\n` +
      `Exemplo: _Bairro Morro Bento, Rua da Samba, Nº 12, Luanda_`,
    askIndividualNifBody: () =>
      `Endereço guardado ✅\n\n` +
      `Tens *NIF* (número de contribuinte) para a factura?\n` +
      `_É opcional para particulares._`,
    askIndividualNifButtons: ['✅ Sim, tenho NIF', '❌ Não, obrigado'],
    askIndividualNifNumberBody: () =>
      `Óptimo! Escreve o teu *número de NIF* abaixo. 👇`,
    addressSaved: () => `Endereço guardado ✅`,
    nifSaved: () => `NIF guardado ✅`,
    allSet: () =>
      `Perfeito, está tudo pronto! ✅\n\nVou confirmar a disponibilidade com os fornecedores agora... ⏳`,
    savedProfileSummary: (name, address, customerType, nif) =>
      `Entregar no teu endereço habitual, ${name}?\n\n` +
      `📍 ${address}\n` +
      (customerType === 'company' ? `🏢 Empresa${nif ? ` · NIF ${nif}` : ''}` : `👤 Particular${nif ? ` · NIF ${nif}` : ''}`),
    savedProfileUseButton: () => '✅ Sim, usar este',
    savedProfileEditButton: () => '✏️ Actualizar dados',
    savedProfileNotUnderstood: () => 'Por favor toca num dos botões acima. 👇',
  },
  /**
   * Payment flow — per-method instructions (bank transfer/deposit,
   * Multicaixa Express, mobile POS), method-selection prompts, proof
   * receipt/invalid handling, and the supplier delivery notice.
   */
  payment: {
    methods: {
      bankTransfer: {
        name: 'Transferência Bancária',
        instructions: (orderNumber, amount) =>
          `🏦 *Transferência Bancária*\n\n` +
          `Banco: BFA / BAI / BIC (à tua escolha)\n` +
          `IBAN: AO06 0040 0000 XXXX XXXX XXXX X\n` +
          `Titular: Rede Peças, Lda\n` +
          `Valor: *${amount}*\n` +
          `Referência: *${orderNumber}* _(obrigatório)_\n\n` +
          `Após a transferência, envia aqui o comprovativo (foto ou PDF) e nós tratamos do resto. 📸`,
      },
      bankDeposit: {
        name: 'Depósito Bancário',
        instructions: (orderNumber, amount) =>
          `🏧 *Depósito Bancário*\n\n` +
          `Banco: BFA / BAI / BIC (à tua escolha)\n` +
          `Nº Conta: 000000000000\n` +
          `Titular: Rede Peças, Lda\n` +
          `Valor: *${amount}*\n` +
          `Referência: *${orderNumber}* _(escreve no talão)_\n\n` +
          `Após o depósito, envia aqui a foto do talão. 📸`,
      },
      multicaixaExpress: {
        name: 'Multicaixa Express',
        instructions: (orderNumber, amount) =>
          `📱 *Multicaixa Express*\n\n` +
          `Número: *+244 900 000 000*\n` +
          `Valor: *${amount}*\n` +
          `Referência: *${orderNumber}* _(coloca na descrição)_\n\n` +
          `Após o pagamento, envia aqui o screenshot da confirmação. 📸`,
      },
      mobilePOS: {
        name: 'TPA Móvel (Terminal de Pagamento)',
        instructions: (orderNumber, amount) =>
          `💳 *TPA Móvel*\n\n` +
          `Um agente da Rede Peças irá até ti com o terminal de pagamento.\n\n` +
          `Valor a pagar: *${amount}*\n` +
          `Pedido: *${orderNumber}*\n\n` +
          `A nossa equipa entrará em contacto para combinar a visita. 🚗`,
      },
    },
    askMethodBody: (orderNumber, amount) =>
      `💰 *Como preferes pagar?*\n\n` +
      `Pedido: *${orderNumber}*\n` +
      `Valor: *${amount}*\n\n` +
      `Escolhe uma opção:\n\n` +
      `_Se escolheres Transferência/Depósito ou Multicaixa Express, usa o Número do Pedido como referência._`,
    askMethodButtons: ['🏦 Banco', '📱 Multicaixa', '💳 Mobile POS (TPA)'],
    askBankSubtypeBody: () => 'Preferes transferência ou depósito bancário?',
    askBankSubtypeButtons: ['🏦 Transferência', '🏧 Depósito'],
    proofReceivedCustomer: (customerName) =>
      `Recebido, obrigado ${customerName}! 🙏\n\n` +
      `Vamos verificar o teu pagamento e emitir a factura oficial em breve.\n\n` +
      `Isto costuma demorar menos de 30 minutos em horário de expediente (Seg–Sáb, 8h–18h).\n` +
      `Avisamos assim que estiver pronto! ⏳`,
    proofInvalid: () =>
      `⚠️ Não conseguimos confirmar este comprovativo de pagamento.\n\n` +
      `Por favor faz upload de um comprovativo de pagamento válido novamente — foto ou PDF, ` +
      `garantindo que mostra claramente o valor, a data e a referência do pagamento. 📸`,
    supplierDeliveryNotice: (productName, reference, quantity, orderNumber) =>
      `📦 *NOVO PEDIDO CONFIRMADO — REDE PEÇAS*\n\n` +
      `Por favor prepare o seguinte artigo para entrega:\n\n` +
      `🔧 Peça: *${productName}*\n` +
      `📋 Referência: ${reference}\n` +
      `🔢 Quantidade: ${quantity}\n` +
      `📋 Nº Pedido: *${orderNumber}*\n\n` +
      `A equipa da Rede Peças entrará em contacto para coordenar a recolha.\n` +
      `Obrigado pela parceria! 🙏`,
  },
  /**
   * Static and templated text for the generated PDFs (proforma and final
   * invoice) plus the WhatsApp captions/notifications sent alongside them.
   */
  pdf: {
    proforma: {
      companyName: 'REDE PEÇAS',
      tagline: 'Marketplace Automotivo de Angola',
      phone: 'Tel: +244 900 000 000',
      email: 'Email: info@redepecas.ao',
      title: 'FACTURA PROFORMA',
      numberLabel: (orderNumber) => `Nº: ${orderNumber}`,
      dateLabel: (date) => `Data: ${date}`,
      validityLabel: (date) => `Validade: ${date}`,
      clientHeader: 'CLIENTE',
      whatsappLabel: (phone) => `WhatsApp: ${phone}`,
      clientDataNote: '(Dados completos a fornecer no momento do pagamento)',
      tableDescription: 'Descrição',
      tableReference: 'Referência',
      tableQty: 'Qtd',
      tableUnitPrice: 'Preço Unit.',
      tableTotal: 'Total',
      supplierLabel: (supplier) => `Fornecedor: ${supplier}`,
      totalDue: 'TOTAL A PAGAR:',
      servicesHeader: () => 'Serviços',
      servicesTotal: () => 'Total dos serviços',
      paymentInstructionsHeader: 'INSTRUÇÕES DE PAGAMENTO',
      bankLine: '• Transferência bancária: IBAN AO06 0040 0000 XXXX XXXX XXXX X',
      multicaixaLine: '• Multicaixa Express: +244 900 000 000',
      referenceLine: (orderNumber) => `• Referência obrigatória na transferência: ${orderNumber}`,
      afterPaymentLine: '• Após pagamento, envie comprovativo para este WhatsApp',
      termsNote:
        'Esta proforma tem validade de 48 horas. O stock é reservado apenas após confirmação do pagamento. ' +
        'A Rede Peças actua como intermediário entre o cliente e o fornecedor.',
      footer: 'Rede Peças — Marketplace Automotivo de Angola  |  NIF: 5XXXXXXXXX  |  info@redepecas.ao',
    },
    sendMessage: {
      documentCaption: (orderNumber) => `Factura Proforma Nº ${orderNumber} — Rede Peças`,
    },
    finalInvoice: {
      notification: (customerName) =>
        `O teu pagamento foi confirmado, ${customerName}! ✅\n\n` +
        `A tua factura oficial segue em anexo — guarda-a para os teus registos.\n\n` +
        `Obrigado por escolheres a Rede Peças.\n` +
        `Esperamos ver-te em breve! 🙏 🚗`,
      documentCaption: (orderNumber) => `Factura Comercial Nº ${orderNumber} — Rede Peças`,
      orderStatusButtonLabel: () => '📦 Estado do pedido',
    },
    invoice: {
      headerTitle: 'REDE PEÇAS - FACTURA',
      tagline: 'Marketplace Automotivo de Angola',
      nifLine: 'NIF: 5001234567 (Certificado AGT)',
      title: 'FACTURA COMERCIAL',
      numberLabel: (num) => `Factura Nº: ${num}`,
      dateLabel: (date) => `Data Emissão: ${date}`,
      clientHeader: 'CLIENTE',
      nameLine: 'Nome: Cliente Rede Peças',
      whatsappLabel: (phone) => `WhatsApp: ${phone}`,
      tableDescription: 'Descrição',
      tableReference: 'Referência',
      tableQty: 'Qtd',
      tableUnitPrice: 'Preço Unit.',
      tableTotal: 'Total',
      defaultProductName: 'Peça Automóvel',
      totalPaid: 'TOTAL PAGO:',
      servicesHeader: () => 'Serviços',
      servicesTotal: () => 'Total dos serviços',
      agtStamp: 'Processado por computador. Emitido de acordo com as regras de facturação da AGT Angola.',
    },
  },
  /**
   * Plausibility-validation acceptance/rejection messages for free-text
   * registration and vehicle fields — styled like manual.invalidYear (⚠️ + reason + example).
   */
  validation: {
    invalidName: () =>
      `⚠️ Isso não parece um nome válido. Por favor indica o teu nome completo.\n\nExemplo: _João Manuel Silva_`,
    invalidAddress: () =>
      `⚠️ Isso não parece um endereço válido. Indica a rua, bairro e município/cidade.\n\n` +
      `Exemplo: _Rua Amílcar Cabral, Bairro Maianga, Luanda_`,
    invalidNif: () =>
      `⚠️ Esse número de NIF não parece válido. Confere e envia novamente.\n\nExemplo: _005123456LA042_`,
    invalidMake: () =>
      `⚠️ Isso não parece uma marca de veículo válida. Por favor indica a marca.\n\nExemplo: _Toyota, Mercedes, Volvo..._`,
    invalidModel: () =>
      `⚠️ Isso não parece um modelo de veículo válido. Por favor indica o modelo.\n\nExemplo: _Hilux, L200, Actros..._`,
    invalidEngineNumber: () =>
      `⚠️ Esse número de motor não parece válido. Confere e envia novamente, ou responde *"não sei"* para continuar.`,
  },
  /**
   * Admin panel password-reset code, delivered to the admin's own
   * WhatsApp number.
   */
  adminAuth: {
    resetCode: (code) =>
      `🔐 Código de recuperação de senha do painel Rede Peças: *${code}*\n\n` +
      `Válido por 10 minutos. Se não pediste isto, ignora esta mensagem.`,
  },
  /**
   * Admin-facing WhatsApp push notifications and their reply
   * acknowledgments — stock confirmation, in-person payment requests,
   * and payment-proof approval/rejection.
   */
  admin: {
    stockConfirmationNeeded: (orderNumber, productName, reference, supplier, amount, customerName, customerPhone) =>
      `🔔 *CONFIRMAÇÃO DE STOCK NECESSÁRIA*\n\n` +
      `Pedido: *${orderNumber}* (AINDA NÃO PAGO)\n` +
      `Peça: ${productName} · Ref: ${reference}\n` +
      `Fornecedor: ${supplier}\n` +
      `Valor: ${amount}\n` +
      `Cliente: ${customerName} · ${customerPhone}\n\n` +
      `⚠️ Por favor confirma com o fornecedor que este artigo está fisicamente disponível antes do cliente pagar.\n\n` +
      `📲 Consulta a plataforma admin da Rede Peças.`,
    confirmButtonLabel: () => '✅ Confirmado',
    unavailableButtonLabel: () => '⚠️ Indisponível',
    reminderBody: (customerName, productName, orderNumber) =>
      `⏰ *LEMBRETE — Cliente à espera*\n\n` +
      `${customerName} está à espera há 15 minutos pela confirmação de stock de:\n\n` +
      `${productName} · ${orderNumber}\n\n` +
      `Por favor confirma ou recusa o mais rápido possível na plataforma admin da Rede Peças.`,
    confirmedAck: (orderNumber) => `✅ Confirmado! Factura proforma enviada ao cliente do pedido *${orderNumber}*.`,
    unavailableAck: (orderNumber) => `⚠️ Pedido *${orderNumber}* marcado como indisponível. Cliente foi notificado.`,
    itemRecordedWaitingOnOthers: (orderNumber) =>
      `✅ Registado para o pedido *${orderNumber}*. Ainda a aguardar a tua confirmação sobre os outros artigos deste pedido — nada foi enviado ao cliente ainda.`,
    itemRecordedAlternativeSearch: (orderNumber) =>
      `✅ Registado para o pedido *${orderNumber}*. O cliente está agora a escolher uma alternativa para o(s) artigo(s) indisponível(eis) — a proforma só será enviada depois disso.`,
    itemRecordedAllUnavailable: (orderNumber) =>
      `⚠️ Todos os artigos do pedido *${orderNumber}* ficaram indisponíveis. Cliente foi notificado — nenhuma proforma foi enviada.`,
    alreadyHandled: (orderNumber) => `O pedido *${orderNumber}* já foi tratado — nada a fazer.`,
    useButtonsPrompt: () => `Por favor usa os botões na mensagem de confirmação de stock. 👆`,
    approvePaymentButtonLabel: () => '✅ Aprovar',
    rejectPaymentButtonLabel: () => '❌ Rejeitar',
    paymentApprovedAck: (orderNumber) => `✅ Aprovado! Fatura enviada ao cliente do pedido *${orderNumber}*.`,
    paymentRejectedAck: (orderNumber) => `❌ Pedido *${orderNumber}* rejeitado. Cliente foi notificado.`,
    inPersonPaymentRequested: (orderNumber, methodName, amount, customerName, customerPhone, address) =>
      `💳 *PAGAMENTO PRESENCIAL SOLICITADO*\n\n` +
      `Pedido: *${orderNumber}*\n` +
      `Método: ${methodName}\n` +
      `Valor: ${amount}\n` +
      `Cliente: ${customerName} · ${customerPhone}\n` +
      `Endereço: ${address}\n\n` +
      `Leva o terminal até ao cliente,\n` +
      `Confirma o pagamento na plataforma admin da Rede Peças assim que terminares.`,
    paymentProofReceived: (orderNumber, methodName, amount, customerName, customerPhone) =>
      `🧾 *COMPROVATIVO DE PAGAMENTO RECEBIDO*\n\n` +
      `Pedido: *${orderNumber}*\n` +
      `Método: ${methodName}\n` +
      `Valor: ${amount}\n` +
      `Cliente: ${customerName} · ${customerPhone}\n\n` +
      `Revê o comprovativo em anexo e depois:\n` +
      `✅ Aprovar e Emitir Fatura\n` +
      `❌ Rejeitar — Pagamento Inválido`,
    orderStatusRequested: (orderNumber, placedDate, status, partsSummary, amountPaid, customerName, customerPhone, address) =>
      `📦 *PEDIDO DE ESTADO DO PEDIDO*\n\n` +
      `Por favor contacta este cliente — quer uma actualização sobre o pedido.\n\n` +
      `Pedido: *${orderNumber}*\n` +
      `Efectuado: ${placedDate}\n` +
      `Estado: ${status}\n\n` +
      `Peças:\n${partsSummary}\n\n` +
      `Valor pago: ${amountPaid}\n` +
      `Cliente: ${customerName} · ${customerPhone}\n` +
      `Endereço: ${address}`,
  },
};

const en: Messages = {
  /**
   * Generic fallback replies used across button/choice flows when the
   * customer's response doesn't match an expected option, or repeats one
   * already handled.
   */
  common: {
    notUnderstood: () =>
      `🤔 I didn't quite catch that. Please choose one of the options below:`,
    alreadyAnswered: () =>
      `🤔 Already answered that one! Check my latest message to continue.`,
  },
  /**
   * Customer profile registration flow — welcome/greeting, name/NIF/address
   * collection prompts, and the hand-off into vehicle identification once
   * the profile is complete.
   */
  onboarding: {
    welcome: () =>
      `Hi! Welcome to Rede Peças, your Angolan automotive marketplace!\n\n` +
      `I'm Xico Peças, your assistant.\n\n` +
      `In our suppliers I will find you the best options — fast.\n\n` +
      `Parts  •  Lubricants  •  Accessories  •  Services\n\n` +
      `You'll save time, fuel, money and stress.\n\n` +
      `Let's get started! What's your name?`,
    welcomeBack: (name) =>
      `👋 Hey again, *${name}*! Welcome back to *Rede Peças*. 😊`,
    resumeRegistration: () =>
      `👋 Let's continue your registration!`,
    askNameOnly: () => `*What's your name?* 👇`,
    askVehicleIdBody: (name) =>
      `✅ *You're all set, ${name}!*\n\n` +
      `Next time you message us, I'll already know who you are. 😊\n\n` +
      `Now let's find your vehicle. How would you like to identify it?`,
    askVehicleIdButtons: ['🔢 I have the VIN', '📄 Send a photo', '✍️ Manual entry'],
    resumeVehicleIdBody: (name) =>
      `👋 Welcome back, *${name}*!\n\n` +
      `I still need to identify your vehicle. Pick an option.`,
    onboardingComplete: (name, vehicleSummary) =>
      `You're officially on Rede Peças, ${name}! 🎉\n\n` +
      `${vehicleSummary}\n\n` +
      `What part do you need today?\n\n` +
      `Just tell me naturally — I'll handle the rest. 👇`,
  },
  /**
   * Manual vehicle-entry wizard — the make/model/year/engine-number step
   * machine used when VIN decode and document photo both fail or aren't
   * available.
   */
  manual: {
    askModel: (make) =>
      `✅ *${make}*\n\nNow tell me the *model* of the vehicle.\n\n` +
      `Example: _Hilux, L200, Actros, Sprinter, Ranger..._`,
    askYear: (make, model) =>
      `✅ *${make} ${model}*\n\nWhat *year* is the vehicle?\n\n` +
      `Example: _2015, 2018, 2020..._`,
    invalidYear: () =>
      `⚠️ Invalid year. Please enter a year between *1980* and *${new Date().getFullYear()}*.\n\nExample: _2018_`,
    askEngineNumber: (make, model, year) =>
      `✅ *${make} ${model} ${year}*\n\n` +
      `What's the *engine number*? _(optional)_\n\n` +
      `This number matters for engine parts, servicing, and maintenance.\n\n` +
      `If you don't know it, reply *"don't know"* and we'll continue. 👇`,
    collectionComplete: (summary) =>
      `✅ Great! I've saved your vehicle's details:\n\n` +
      `${summary}\n\n` +
      `Now tell me which part you need and I'll search our stock. 👇`,
    askMakePrompt: () =>
      `No problem! Let's fill in the details manually.\n\n` +
      `What's the *make* of the vehicle?\n\nExample: _Toyota, Mercedes, Volvo..._`,
    engineLabel: (engineNumber) => `🔧 Engine: *${engineNumber}*`,
  },
  /**
   * VIN-based vehicle identification — prompt for the chassis number,
   * NHTSA decode failure/retry handling, and confirm/already-registered
   * responses once a vehicle is decoded.
   */
  vin: {
    askVinPrompt: () =>
      `🔢 Great! Send me the chassis number (VIN) — 17 characters, found on the ` +
      `vehicle document or stamped on the chassis itself.`,
    identifying: () => `Give me just a second... 🔍`,
    decodeFailed: () =>
      `⚠️ Hmm, I wasn't able to identify that chassis number — \n` +
      `it might be a European or Japanese import not in the US database.\n\n` +
      `Want to try identifying your vehicle another way, or fill in the details manually?`,
    decodeFailedButtons: ['🔄 Try again', '✍️ Manual entry'],
    restartChoiceBody: () =>
      `No problem! How would you like to identify your vehicle? 👇`,
    invalidLength: (length) =>
      `⚠️ That doesn't look like a valid VIN — it has ${length} characters, but a VIN is always *17*.\n\n` +
      `Double-check the number and resend it, or choose another option below 👇`,
    modelUnknownNote: () => `model not identified`,
    confirmBody: (description) =>
      `Found it! Here's what came up:\n\n🚗 *${description}*\n\nIs this your car?`,
    confirmButtons: ['✅ Yes, that\'s mine', '❌ No, different car'],
    alreadyRegistered: (description) =>
      `It looks like this vehicle is already in your profile! 😊\n\n🚗 *${description}*\n\n` +
      `Would you like to search for a part for this car, or add a different vehicle?`,
    alreadyRegisteredButtons: ['🔍 Find a part', '➕ Different car'],
  },
  /**
   * Vehicle-document photo identification (Claude Vision extraction) —
   * prompts, download/processing errors, and the resulting
   * make/model confirmation.
   */
  document: {
    askPhotoPrompt: () =>
      `Perfect! Take a clear photo of your vehicle registration document (livrete or Vehicle Certificate) and send it here. 📄\n\n` +
      `Make sure the text is readable and well lit.`,
    received: () => `Got it, reading the document... 📖`,
    downloadFailed: () =>
      `⚠️ I couldn't download the image. Please try sending it again, ` +
      `or reply *"I don't have it"* to fill in the details manually.`,
    processingError: () =>
      `⚠️ Something went wrong processing the document. Please try again, ` +
      `or reply *"I don't have it"* to fill in the details manually.`,
    notRecognized: () =>
      `That image doesn't look like a vehicle document (registration/title).\n\n` +
      `You can send the chassis number (VIN) as text, try another photo, ` +
      `or reply *"I don't have it"* to fill in the details manually.`,
    invalid: () =>
      `I had trouble reading that image. It happens! 📸\n\n` +
      `A few tips:\n` +
      `• Make sure the document is well lit\n` +
      `• Hold the camera steady and close\n` +
      `• Avoid reflections or shadows on the text\n\n` +
      `Try again, or tap below to enter details manually.`,
    missingEssentialData: () =>
      `⚠️ I read the document but essential data is missing (make/model).\n\n` +
      `Please try another photo, or reply *"I don't have it"* to fill in the details manually.`,
    confirmBody: (description) =>
      `Here's what I found in the document:\n\n🚗 *${description}*\n\nIs this your car?`,
    licensePlateLabel: (plate) => `Plate: ${plate}`,
    chassisLabel: (vin) => `Chassis: ${vin}`,
    retryButtons: ['🔄 Try again', '✍️ Manual entry'],
  },
  /**
   * Vehicle confirmation and multi-vehicle selection — the Yes/No
   * confirm step, the "add another vehicle" flow, and the "which
   * vehicle is this for?" picker for customers with 2+ vehicles on file.
   */
  vehicleConfirm: {
    confirmedAskPart: (make, model, year, greetingName) =>
      greetingName
        ? `Hey ${greetingName}! 👋 Good to have you back.\n\n` +
          `What part do you need for your *${make} ${model} ${year}* today?`
        : `Perfect! 🙌\n\n` +
          `Now tell me which part you need for your *${make} ${model} ${year}*.\n\n` +
          `Example: _"oil filter"_, _"brake pads"_, _"timing belt"_...`,
    addVehicleButton: () => '➕ Add vehicle',
    addVehicleBody: () =>
      `Sure! Let's add another vehicle to your profile. 🚗\n\n` +
      `How would you like to identify it?`,
    chooseVehiclePrompt: (vehicles, greetingName) =>
      (greetingName ? `Hey ${greetingName}! 👋 Good to have you back.\n\n` : '') +
      `Which of your vehicles is this for? 👇\n\n` +
      vehicles.map((v, i) => `${i + 1}️⃣ ${v.make} ${v.model} ${v.year}`).join('\n') +
      `\n\nReply with the number. 👇`,
    vehicleChoiceNotFound: () =>
      `I didn't get that. Reply with just the vehicle's number. 👆`,
  },
  /**
   * Product search and stock/order lifecycle messages — search results,
   * waitlist/restock notifications, related-service upsell, and
   * supplier stock-confirmation outcomes.
   */
  agent: {
    checkingStock: () => `On it! Checking our suppliers' stock for you... ⏳`,
    noStockFound: () =>
      `I searched everywhere but couldn't find that part in stock right now. 😔\n\n` +
      `I can add you to the waiting list and message you the moment it becomes available.\n\n` +
      `Want me to do that?`,
    noStockFoundButtons: ['✅ Yes, notify me', '❌ No, thanks'],
    noStockFoundNoWaitlist: () =>
      `I searched everywhere but couldn't find that part, or anything similar, in our catalog right now. 😔`,
    optionNotFound: () =>
      `I couldn't identify which option you chose. Please reply with the number (e.g. 1, 2, or 3).`,
    serviceUnavailable: () =>
      `⚠️ We're experiencing temporary instability on our platform. Please try again in a few minutes. 🙏`,
    waitlistConfirmed: (productName) =>
      `✅ Perfect! I'll let you know as soon as *${productName}* is available.`,
    waitlistDeclined: () => `No problem! 👍`,
    restockNotification: (name, productName, vehicleSummary, price, supplier) =>
      `📦 Great news, ${name}! 🎉\n\n` +
      `The part you were waiting for is back in stock:\n\n` +
      `🔧 *${productName}*${vehicleSummary ? ` — ${vehicleSummary}` : ''}\n` +
      `💰 ${price} · ${supplier}\n\n` +
      `Want to order it now?`,
    restockNotificationButtons: ['✅ Order now', '❌ Not right now'],
    productSelected: (productName, price) =>
      `You picked *${productName}* — ${price}.`,
    serviceListBody: (count) =>
      `This product has ${count} related service(s) available. Pick one below to add it, or continue with just the product 👇`,
    serviceListButton: () => 'View services',
    serviceSkipOption: () => '❌ No, thanks',
    serviceAdded: (serviceName, newTotal) =>
      `✅ *${serviceName}* added to your order. New total: *${newTotal}*.`,
    serviceDeclined: () => `No problem! 👍`,
    confirmingAvailability: () =>
      `Great choice! 👍\n\n` +
      `Let me just confirm availability with the supplier before we proceed.\n\n` +
      `This usually takes a few minutes — I'll be right back! ⏳`,
    stockConfirmedIntro: (productName, customerName) =>
      `Great news, ${customerName}! ✅\n\n` +
      `The supplier has confirmed *${productName}* is available and ready for you.\n\n` +
      `Your proforma invoice is attached below. 👇`,
    stockConfirmationCourtesy: () =>
      `Sorry for the short wait! 🙏\n\n` +
      `We're still confirming availability with the supplier.\n` +
      `Our team will get back to you within the next few minutes.\n\n` +
      `Thank you for your patience! 😊`,
    stockUnavailable: (productName, reference) =>
      `I'm sorry. 😔\n\n` +
      `The supplier just confirmed that *${productName}* (Ref: ${reference}) is no longer available.\n\n` +
      `No payment was taken — so there's nothing to worry about. 👍\n\n` +
      `Would you like me to search for an alternative?`,
    stockUnavailableButtons: ['✅ Alternatives', '❌ Join waitlist'],
    basketRequestSummary: (productNames, name) =>
      `Got it, ${name}! Here's what you've asked for:\n\n` +
      productNames.map((p, idx) => `${idx + 1}. ${p}`).join('\n') +
      `\n\nLet's start with the first one. 👇`,
    basketSummaryBody: (items, name, total) =>
      `Here's what you've selected, ${name}: 🛒\n\n` +
      items.map((i, idx) => `${idx + 1}. ${i.description} — ${i.price}`).join('\n') +
      `\n\n*Total: ${total}*`,
    basketPartialAvailability: (availableNames, unavailableNames) =>
      `Good news — ${availableNames.join(', ')} ${availableNames.length > 1 ? 'are' : 'is'} available! ✅\n\n` +
      `⚠️ Unfortunately ${unavailableNames.join(', ')} ${unavailableNames.length > 1 ? "aren't" : "isn't"} available right now. Let me find some alternatives for you.`,
    basketNoneAvailableYet: (unavailableNames) =>
      `⚠️ Unfortunately ${unavailableNames.join(', ')} ${unavailableNames.length > 1 ? "aren't" : "isn't"} available right now. Let me find some alternatives for you.`,
    basketAllUnavailable: () =>
      `I'm sorry. 😔\n\nThe supplier confirmed that none of the items on this order are available right now.\n\nNo payment was taken — so there's nothing to worry about. 👍`,
    basketDeclinedNotice: (declinedNames) =>
      `No problem — I've moved forward without ${declinedNames.join(', ')}. 👍`,
    basketSearchAllUnavailableWaitlistOffer: () =>
      `I searched everywhere but couldn't find those parts in stock right now. 😔\n\n` +
      `I can add you to the waiting list and message you the moment they become available.\n\n` +
      `Want me to do that?`,
    basketSearchAllUnavailableNoWaitlist: () =>
      `I searched everywhere but couldn't find any of those parts — not even similar ones — in our catalog right now. 😔`,
    basketWaitlistConfirmed: () =>
      `Perfect, you're all set! 🎉 I'll message you the moment any of those come back in stock.`,
    basketSearchPartialNotice: (missingNames) =>
      `_Quick note — I couldn't find ${missingNames.join(', ')}, so ${missingNames.length > 1 ? "they're" : "it's"} not included in your order below._`,
    alternativesListBody: (productName, count) =>
      `Found ${count} alternative${count > 1 ? 's' : ''} for *${productName}*. Which one works for you? 👇`,
    alternativeSkipOption: () => `None of these, skip this item`,
    noAlternativesFound: (productName) =>
      `Sorry, I couldn't find any alternatives for *${productName}* right now — I'll leave it out of your order.`,
    proformaSentChoosePayment: () =>
      `Proforma sent! Please choose one of the payment methods below. 👇`,
    transferToHuman: () =>
      `Got it! I'll transfer you to one of our staff. One moment please 🙏`,
    searchListBody: (count, part, name) =>
      `Good news, ${name}! 🙌 I found ${count} option(s) for *${part}*. Which one works best for you? 👇`,
    searchListBodyForVehicle: (count, part, make, model, year, name) =>
      `Good news, ${name}! 🙌 I found ${count} option(s) for *${part}* for your *${make} ${model} ${year}*. Which one works best for you? 👇`,
    searchListButton: () => 'View options',
    askPartTypeBody: (count) =>
      `Before I search — what type of part${count > 1 ? 's' : ''} would you like?` +
      (count > 1 ? `\n\n_This applies to all ${count} parts in your list._` : ''),
    askPartTypeButton: () => 'Choose part type',
    partTypeRows: [
      { id: 'oem', title: 'OEM', description: 'Original manufacturer part' },
      { id: 'aftermarket', title: 'Aftermarket', description: 'Compatible part, other brands' },
      { id: 'new', title: 'New', description: 'Brand new, unused' },
      { id: 'second_hand', title: 'Second Hand', description: 'Used, tested, lower price' },
    ],
    partTypeNotUnderstood: () => 'Please tap the button above and choose one of the four types. 👇',
  },
  /**
   * Order-level customer notices, currently just the payment-rejection
   * message sent when a submitted proof couldn't be confirmed.
   */
  order: {
    rejected: (orderNumber) =>
      `Unfortunately we weren't able to confirm your payment for order ${orderNumber}. 😔\n\n` +
      `This can happen if the proof was unclear or the payment reference was missing.\n\n` +
      `If you think this is a mistake, just reply here and one of our team members will help you sort it out right away. 👇`,
    statusRequestAck: () =>
      `Thanks! 🙏\n\nOur support team will contact you shortly with the latest update on your order.\n\nThey're usually back within a few minutes during business hours (Mon–Sat, 8h–18h).`,
    statusNotFound: () =>
      `I couldn't find a paid order on file for your number yet. If you think this is a mistake, just reply here and one of our team members will help you out. 👇`,
  },
  orderProfile: {
    askCustomerTypeBody: (name) =>
      `Great, ${name}! One quick thing before I check availability.\n\n` +
      `Are you buying as an *individual* or for a *company*?`,
    askCustomerTypeButtons: ['👤 Individual', '🏢 Company'],
    askCompanyNifBody: () =>
      `Perfect. For company invoices I'll need your *NIF* (tax ID) — it's required by law for the invoice.\n\n` +
      `Type your NIF number below. 👇`,
    askCompanyNifInvalid: () =>
      `That doesn't look like a valid NIF. 🤔\n\n` +
      `A NIF is required for company invoices — please check the number and type it again below.`,
    askCompanyAddressBody: (name) =>
      `NIF saved ✅\n\n` +
      `And what's the *delivery address*, ${name}?\n` +
      `Example: _Bairro Morro Bento, Rua da Samba, Nº 12, Luanda_`,
    askIndividualAddressBody: (name) =>
      `Got it! What's your preferred *delivery address*, ${name}?\n` +
      `Example: _Bairro Morro Bento, Rua da Samba, Nº 12, Luanda_`,
    askIndividualNifBody: () =>
      `Address saved ✅\n\n` +
      `Do you have a *NIF* (tax ID) for the invoice?\n` +
      `_It's optional for individuals._`,
    askIndividualNifButtons: ['✅ Yes, I have a NIF', '❌ No, thanks'],
    askIndividualNifNumberBody: () =>
      `Great! Type your *NIF number* below. 👇`,
    addressSaved: () => `Address saved ✅`,
    nifSaved: () => `NIF saved ✅`,
    allSet: () =>
      `Perfect, you're all set! ✅\n\nLet me confirm availability with the suppliers now... ⏳`,
    savedProfileSummary: (name, address, customerType, nif) =>
      `Delivering to your saved address, ${name}?\n\n` +
      `📍 ${address}\n` +
      (customerType === 'company' ? `🏢 Company${nif ? ` · NIF ${nif}` : ''}` : `👤 Individual${nif ? ` · NIF ${nif}` : ''}`),
    savedProfileUseButton: () => '✅ Yes, use this',
    savedProfileEditButton: () => '✏️ Update details',
    savedProfileNotUnderstood: () => 'Please tap one of the buttons above. 👇',
  },
  /**
   * Payment flow — per-method instructions (bank transfer/deposit,
   * Multicaixa Express, mobile POS), method-selection prompts, proof
   * receipt/invalid handling, and the supplier delivery notice.
   */
  payment: {
    methods: {
      bankTransfer: {
        name: 'Bank Transfer',
        instructions: (orderNumber, amount) =>
          `🏦 *Bank Transfer*\n\n` +
          `Bank: BFA / BAI / BIC (your choice)\n` +
          `IBAN: AO06 0040 0000 XXXX XXXX XXXX X\n` +
          `Account holder: Rede Peças, Lda\n` +
          `Amount: *${amount}*\n` +
          `Reference: *${orderNumber}* _(required)_\n\n` +
          `After transferring, send the proof here (photo or PDF) and we'll take it from there. 📸`,
      },
      bankDeposit: {
        name: 'Bank Deposit',
        instructions: (orderNumber, amount) =>
          `🏧 *Bank Deposit*\n\n` +
          `Bank: BFA / BAI / BIC (your choice)\n` +
          `Account No.: 000000000000\n` +
          `Account holder: Rede Peças, Lda\n` +
          `Amount: *${amount}*\n` +
          `Reference: *${orderNumber}* _(write on the receipt)_\n\n` +
          `After the deposit, send a photo of the receipt here. 📸`,
      },
      multicaixaExpress: {
        name: 'Multicaixa Express',
        instructions: (orderNumber, amount) =>
          `📱 *Multicaixa Express*\n\n` +
          `Number: *+244 900 000 000*\n` +
          `Amount: *${amount}*\n` +
          `Reference: *${orderNumber}* _(put it in the description)_\n\n` +
          `After paying, send the confirmation screenshot here. 📸`,
      },
      mobilePOS: {
        name: 'Mobile POS Terminal',
        instructions: (orderNumber, amount) =>
          `💳 *Mobile POS*\n\n` +
          `A Rede Peças agent will come to you with the payment terminal.\n\n` +
          `Amount due: *${amount}*\n` +
          `Order: *${orderNumber}*\n\n` +
          `Our team will contact you to arrange the visit. 🚗`,
      },
    },
    askMethodBody: (orderNumber, amount) =>
      `💰 *How would you like to pay?*\n\n` +
      `Order: *${orderNumber}*\n` +
      `Amount: *${amount}*\n\n` +
      `Choose an option:\n\n` +
      `_If you choose Transfer/Deposit or Multicaixa Express, please use the Order Number as reference._`,
    askMethodButtons: ['🏦 Bank', '📱 Multicaixa', '💳 Mobile POS (TPA)'],
    askBankSubtypeBody: () => 'Would you prefer a bank transfer or a bank deposit?',
    askBankSubtypeButtons: ['🏦 Bank Transfer', '🏧 Bank Deposit'],
    proofReceivedCustomer: (customerName) =>
      `Got it, thank you ${customerName}! 🙏\n\n` +
      `We'll verify your payment and issue the official invoice shortly.\n\n` +
      `This usually takes under 30 minutes during business hours (Mon–Sat, 8h–18h).\n` +
      `We'll message you as soon as it's done! ⏳`,
    proofInvalid: () =>
      `⚠️ We weren't able to confirm this payment proof.\n\n` +
      `Please upload a valid payment proof again — photo or PDF, making sure it clearly shows ` +
      `the amount, date, and payment reference. 📸`,
    supplierDeliveryNotice: (productName, reference, quantity, orderNumber) =>
      `📦 *NEW ORDER CONFIRMED — REDE PEÇAS*\n\n` +
      `Please prepare the following item for delivery:\n\n` +
      `🔧 Part: *${productName}*\n` +
      `📋 Reference: ${reference}\n` +
      `🔢 Quantity: ${quantity}\n` +
      `📋 Order No.: *${orderNumber}*\n\n` +
      `The Rede Peças team will contact you to arrange pickup.\n` +
      `Thanks for the partnership! 🙏`,
  },
  /**
   * Static and templated text for the generated PDFs (proforma and final
   * invoice) plus the WhatsApp captions/notifications sent alongside them.
   */
  pdf: {
    proforma: {
      companyName: 'REDE PEÇAS',
      tagline: "Angola's Auto Parts Marketplace",
      phone: 'Tel: +244 900 000 000',
      email: 'Email: info@redepecas.ao',
      title: 'PROFORMA INVOICE',
      numberLabel: (orderNumber) => `No.: ${orderNumber}`,
      dateLabel: (date) => `Date: ${date}`,
      validityLabel: (date) => `Valid until: ${date}`,
      clientHeader: 'CLIENT',
      whatsappLabel: (phone) => `WhatsApp: ${phone}`,
      clientDataNote: '(Full details to be provided at time of payment)',
      tableDescription: 'Description',
      tableReference: 'Reference',
      tableQty: 'Qty',
      tableUnitPrice: 'Unit Price',
      tableTotal: 'Total',
      supplierLabel: (supplier) => `Supplier: ${supplier}`,
      totalDue: 'TOTAL DUE:',
      servicesHeader: () => 'Services',
      servicesTotal: () => 'Services total',
      paymentInstructionsHeader: 'PAYMENT INSTRUCTIONS',
      bankLine: '• Bank transfer: IBAN AO06 0040 0000 XXXX XXXX XXXX X',
      multicaixaLine: '• Multicaixa Express: +244 900 000 000',
      referenceLine: (orderNumber) => `• Reference required on the transfer: ${orderNumber}`,
      afterPaymentLine: '• After payment, send proof to this WhatsApp',
      termsNote:
        'This proforma is valid for 48 hours. Stock is only reserved after payment is confirmed. ' +
        'Rede Peças acts as an intermediary between the customer and the supplier.',
      footer: "Rede Peças — Angola's Auto Parts Marketplace  |  NIF: 5XXXXXXXXX  |  info@redepecas.ao",
    },
    sendMessage: {
      documentCaption: (orderNumber) => `Proforma Invoice No. ${orderNumber} — Rede Peças`,
    },
    finalInvoice: {
      notification: (customerName) =>
        `Your payment has been confirmed, ${customerName}! ✅\n\n` +
        `Your official invoice is attached — keep it for your records.\n\n` +
        `Thank you for choosing Rede Peças.\n` +
        `We hope to see you again soon! 🙏 🚗`,
      documentCaption: (orderNumber) => `Commercial Invoice No. ${orderNumber} — Rede Peças`,
      orderStatusButtonLabel: () => '📦 Order status',
    },
    invoice: {
      headerTitle: 'REDE PEÇAS - INVOICE',
      tagline: "Angola's Auto Parts Marketplace",
      nifLine: 'NIF: 5001234567 (AGT Certified)',
      title: 'COMMERCIAL INVOICE',
      numberLabel: (num) => `Invoice No.: ${num}`,
      dateLabel: (date) => `Issue Date: ${date}`,
      clientHeader: 'CLIENT',
      nameLine: 'Name: Rede Peças Customer',
      whatsappLabel: (phone) => `WhatsApp: ${phone}`,
      tableDescription: 'Description',
      tableReference: 'Reference',
      tableQty: 'Qty',
      tableUnitPrice: 'Unit Price',
      tableTotal: 'Total',
      defaultProductName: 'Auto Part',
      totalPaid: 'TOTAL PAID:',
      servicesHeader: () => 'Services',
      servicesTotal: () => 'Services total',
      agtStamp: 'Computer-processed. Issued in accordance with AGT Angola billing rules.',
    },
  },
  /**
   * Plausibility-validation acceptance/rejection messages for free-text
   * registration and vehicle fields — styled like manual.invalidYear (⚠️ + reason + example).
   */
  validation: {
    invalidName: () =>
      `⚠️ That doesn't look like a valid name. Please enter your full name.\n\nExample: _John Michael Smith_`,
    invalidAddress: () =>
      `⚠️ That doesn't look like a valid address. Please include the street, neighborhood, and city/municipality.\n\n` +
      `Example: _Rua Amílcar Cabral, Bairro Maianga, Luanda_`,
    invalidNif: () =>
      `⚠️ That NIF number doesn't look valid. Please check it and send it again.\n\nExample: _005123456LA042_`,
    invalidMake: () =>
      `⚠️ That doesn't look like a valid vehicle make. Please enter the make.\n\nExample: _Toyota, Mercedes, Volvo..._`,
    invalidModel: () =>
      `⚠️ That doesn't look like a valid vehicle model. Please enter the model.\n\nExample: _Hilux, L200, Actros..._`,
    invalidEngineNumber: () =>
      `⚠️ That engine number doesn't look valid. Please check it and send it again, or reply *"don't know"* to continue.`,
  },
  /**
   * Admin panel password-reset code, delivered to the admin's own
   * WhatsApp number.
   */
  adminAuth: {
    resetCode: (code) =>
      `🔐 Rede Peças admin panel password reset code: *${code}*\n\n` +
      `Valid for 10 minutes. If you didn't request this, ignore this message.`,
  },
  /**
   * Admin-facing WhatsApp push notifications and their reply
   * acknowledgments — stock confirmation, in-person payment requests,
   * and payment-proof approval/rejection.
   */
  admin: {
    stockConfirmationNeeded: (orderNumber, productName, reference, supplier, amount, customerName, customerPhone) =>
      `🔔 *STOCK CONFIRMATION NEEDED*\n\n` +
      `Order: *${orderNumber}* (NOT YET PAID)\n` +
      `Part: ${productName} · Ref: ${reference}\n` +
      `Supplier: ${supplier}\n` +
      `Amount: ${amount}\n` +
      `Customer: ${customerName} · ${customerPhone}\n\n` +
      `⚠️ Please confirm with the supplier that this item is physically available before the customer pays.\n\n` +
      `📲 Check the Rede Peças admin platform.`,
    confirmButtonLabel: () => '✅ Confirmed',
    unavailableButtonLabel: () => '⚠️ Unavailable',
    reminderBody: (customerName, productName, orderNumber) =>
      `⏰ *REMINDER — Customer is waiting*\n\n` +
      `${customerName} has been waiting 15 minutes for stock confirmation on:\n\n` +
      `${productName} · ${orderNumber}\n\n` +
      `Please confirm or decline ASAP on the Rede Peças admin platform.`,
    confirmedAck: (orderNumber) => `✅ Confirmed! Proforma sent to the customer for order *${orderNumber}*.`,
    unavailableAck: (orderNumber) => `⚠️ Order *${orderNumber}* marked unavailable. Customer has been notified.`,
    itemRecordedWaitingOnOthers: (orderNumber) =>
      `✅ Recorded for order *${orderNumber}*. Still waiting on your call on the other item(s) in this order — nothing has been sent to the customer yet.`,
    itemRecordedAlternativeSearch: (orderNumber) =>
      `✅ Recorded for order *${orderNumber}*. The customer is now picking an alternative for the unavailable item(s) — the proforma will only go out after that.`,
    itemRecordedAllUnavailable: (orderNumber) =>
      `⚠️ Every item on order *${orderNumber}* turned out unavailable. Customer has been notified — no proforma was sent.`,
    alreadyHandled: (orderNumber) => `Order *${orderNumber}* was already handled — nothing to do.`,
    useButtonsPrompt: () => `Please use the buttons on the stock-confirmation message. 👆`,
    approvePaymentButtonLabel: () => '✅ Approve',
    rejectPaymentButtonLabel: () => '❌ Reject',
    paymentApprovedAck: (orderNumber) => `✅ Approved! Invoice sent to the customer for order *${orderNumber}*.`,
    paymentRejectedAck: (orderNumber) => `❌ Order *${orderNumber}* rejected. Customer has been notified.`,
    inPersonPaymentRequested: (orderNumber, methodName, amount, customerName, customerPhone, address) =>
      `💳 *IN-PERSON PAYMENT REQUESTED*\n\n` +
      `Order: *${orderNumber}*\n` +
      `Method: ${methodName}\n` +
      `Amount: ${amount}\n` +
      `Customer: ${customerName} · ${customerPhone}\n` +
      `Address: ${address}\n\n` +
      `Take the terminal to the customer,\n` +
      `Confirm payment on the Rede Peças admin platform when done.`,
    paymentProofReceived: (orderNumber, methodName, amount, customerName, customerPhone) =>
      `🧾 *PAYMENT PROOF RECEIVED*\n\n` +
      `Order: *${orderNumber}*\n` +
      `Method: ${methodName}\n` +
      `Amount: ${amount}\n` +
      `Customer: ${customerName} · ${customerPhone}\n\n` +
      `Review the attached proof, then:\n` +
      `✅ Approve & Issue Invoice\n` +
      `❌ Reject — Invalid Payment`,
    orderStatusRequested: (orderNumber, placedDate, status, partsSummary, amountPaid, customerName, customerPhone, address) =>
      `📦 *ORDER STATUS REQUEST*\n\n` +
      `Please contact this customer — they want an update on their order.\n\n` +
      `Order: *${orderNumber}*\n` +
      `Placed: ${placedDate}\n` +
      `Status: ${status}\n\n` +
      `Parts:\n${partsSummary}\n\n` +
      `Amount paid: ${amountPaid}\n` +
      `Customer: ${customerName} · ${customerPhone}\n` +
      `Address: ${address}`,
  },
};

/**
 * Fixed, locale-independent message set used for paths that are
 * deliberately not customer-locale-aware (admin panel/admin-push
 * messages and the supplier delivery notice).
 */
export const t: Messages = en;

export const DEFAULT_LOCALE: 'pt' | 'en' = 'pt';

/**
 * Resolves the message set for a given customer-facing locale, falling
 * back to Portuguese for any value other than 'en'.
 */
export function getMessages(locale: 'pt' | 'en'): Messages {
  return locale === 'en' ? en : pt;
}

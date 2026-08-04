export const GREETING_PATTERN_EN = /^(hi|hello|hey+|yo|good\s*(morning|afternoon|evening|day))\b/i;
export const GREETING_PATTERN_PT = /^(oi|ol[aá]|e\s*a[ií]|bom\s*dia|boa\s*tarde|boa\s*noite|tudo\s*bem|como\s*est[aá]s?)\b/i;
export const GREETING_PATTERN = new RegExp(`(${GREETING_PATTERN_EN.source})|(${GREETING_PATTERN_PT.source})`, 'i');

/**
 * Checks whether the text opens with a recognizable English or Portuguese
 * greeting word, returning the matched locale or null if neither matches.
 */
export function detectGreetingLocale(text: string): 'en' | 'pt' | null {
  const trimmed = text.trim();
  if (GREETING_PATTERN_EN.test(trimmed)) return 'en';
  if (GREETING_PATTERN_PT.test(trimmed)) return 'pt';
  return null;
}

export const PT_SIGNAL_WORDS = new Set([
  'oi', 'ola', 'olá', 'bom', 'boa', 'dia', 'tarde', 'noite', 'sim', 'nao', 'não',
  'obrigado', 'obrigada', 'favor', 'preciso', 'precisava', 'quero', 'queria', 'gostaria',
  'para', 'meu', 'minha', 'meus', 'minhas', 'carro', 'carros', 'peca', 'peça', 'pecas', 'peças',
  'ainda', 'hoje', 'amanha', 'amanhã', 'entao', 'então', 'voce', 'você', 'tenho', 'esta', 'está',
  'estou', 'sou', 'com', 'sem', 'onde', 'quando', 'porque', 'como', 'isso', 'muito', 'pode',
  'poderia', 'vou', 'fazer', 'comprar', 'preco', 'preço', 'pagar', 'endereco', 'endereço', 'morada',
  'rua', 'bairro', 'numero', 'número', 'tudo', 'bem', 'uma', 'um', 'tambem', 'também', 'mais',
  'menos', 'agora', 'depois', 'ja', 'já', 'aqui', 'ali', 'nome', 'telefone', 'veiculo', 'veículo',
  'motor', 'oleo', 'óleo', 'filtro', 'pastilha', 'pastilhas', 'travao', 'travão', 'correia',
  'amortecedor', 'ajuda', 'ajudar', 'quanto', 'custa', 'obrigadinho', 'certo', 'claro', 'desculpa',
  'desculpe', 'vamos', 'essa', 'esse', 'aquele', 'aquela',
]);

export const EN_SIGNAL_WORDS = new Set([
  'hi', 'hello', 'hey', 'good', 'morning', 'afternoon', 'evening', 'yes', 'please', 'thanks',
  'thank', 'you', 'need', 'needed', 'want', 'wanted', 'would', 'like', 'for', 'my', 'car', 'cars',
  'part', 'parts', 'still', 'today', 'tomorrow', 'then', 'have', 'has', 'with', 'without', 'where',
  'when', 'because', 'how', 'this', 'that', 'very', 'can', 'could', 'will', 'buy', 'price', 'pay',
  'address', 'street', 'name', 'phone', 'vehicle', 'engine', 'oil', 'filter', 'brake', 'pads',
  'belt', 'shock', 'absorber', 'now', 'later', 'here', 'there', 'also', 'more', 'less', 'help',
  'sure', 'sorry', 'okay', 'yeah', 'yep', 'nope', 'much', 'cost', 'many', 'order', 'send', 'photo',
  'picture', 'document',
]);

/**
 * Detects the likely locale of a customer message: first via a leading
 * greeting match, then by scoring the message's words against PT/EN signal
 * word lists, returning null when the text is empty or the scores tie.
 */
export function detectMessageLocale(text: string): 'en' | 'pt' | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const greeting = detectGreetingLocale(trimmed);
  if (greeting) return greeting;

  const words = trimmed.toLowerCase().match(/\p{L}+/gu) || [];
  if (!words.length) return null;

  let ptScore = 0;
  let enScore = 0;
  for (const word of words) {
    if (PT_SIGNAL_WORDS.has(word)) ptScore++;
    if (EN_SIGNAL_WORDS.has(word)) enScore++;
  }

  if (ptScore === enScore) return null;
  return ptScore > enScore ? 'pt' : 'en';
}

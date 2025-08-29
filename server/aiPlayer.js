const { determineRoundWinner } = require("./gameLogic.js");

/**
 * AI bira kartu ovisno o tome igra li prvi (aiIsFirst) ili odgovara na protivničku kartu.
 * @param {Object} params
 * @param {Array} params.hand - AI-ova ruka
 * @param {Object|null} params.opponentCard - Protivnička karta (ako AI odgovara)
 * @param {string} params.trumpSuit - Adut
 * @param {boolean} [params.aiIsFirst=false] - Je li AI prvi na potezu
 * @returns {Object} - Odabrana karta
 */
function chooseAiCard({ hand, opponentCard, trumpSuit, aiIsFirst = false }) {
  console.log("[AI] chooseAiCard called with:", {
    hand,
    opponentCard,
    trumpSuit,
    aiIsFirst,
  });

  // ✅ AI igra prvi
  if (!opponentCard) {
    console.log("[AI] AI plays first - choosing trump or weakest card");

    const trumps = hand.filter((c) => c.suit === trumpSuit);
    if (trumps.length) {
      // Ako ima adut → baci najslabiji adut
      const chosen = trumps.reduce((w, c) => (c.strength < w.strength ? c : w));
      console.log("[AI] AI chose trump card:", chosen);
      return chosen;
    }

    // Inače baci najslabiju kartu
    const chosen = hand.reduce((w, c) => (c.strength < w.strength ? c : w));
    console.log("[AI] AI chose weakest card:", chosen);
    return chosen;
  }

  // ✅ AI odgovara na protivničku kartu
  console.log("[AI] AI responds to opponent card - looking for winning cards");

  const winning = hand.filter((c) => {
    let winner;

    if (aiIsFirst) {
      // AI igra prvi → AI je card1, protivnik card2
      winner = determineRoundWinner(c, opponentCard, trumpSuit, 1);
      console.log(
        `[AI] Testiram kartu ${c.name} ${c.suit} → pobjednik:`,
        winner
      );
      return winner === 1; // AI pobjeđuje ako je prvi
    } else {
      // Protivnik igra prvi → on je card1, AI je card2
      winner = determineRoundWinner(opponentCard, c, trumpSuit, 1);
      console.log(
        `[AI] Testiram kartu ${c.name} ${c.suit} → pobjednik:`,
        winner
      );
      return winner === 2; // AI pobjeđuje ako je drugi
    }
  });

  if (winning.length) {
    // Ako može pobijediti, odaberi najslabiju pobjedničku kartu
    const chosen = winning.reduce((w, c) => (c.strength < w.strength ? c : w));
    console.log("[AI] AI chose winning card:", chosen);
    return chosen;
  }

  // Ako ne može pobijediti, baci kartu s najmanje bodova
  const chosen = hand.reduce((w, c) => (c.points < w.points ? c : w));
  console.log("[AI] AI chose lowest points card:", chosen);
  return chosen;
}

module.exports = { chooseAiCard };

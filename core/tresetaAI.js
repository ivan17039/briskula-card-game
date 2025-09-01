import { determineRoundWinner, getCardStrength } from "./gameLogicTreseta.js";

/**
 * AI za Trešeta bira kartu ovisno o tome igra li prvi (aiIsFirst) ili odgovara na protivničku kartu.
 * API i debug stil su usklađeni s core/briskulaAI.js
 * @param {Object} params
 * @param {Array} params.hand - AI-ova ruka (niz karata)
 * @param {Object|null} params.opponentCard - Protivnička karta (ako AI odgovara)
 * @param {boolean} [params.aiIsFirst=false] - Je li AI prvi na potezu
 * @returns {Object} - Odabrana karta iz ruke
 */
function chooseAiCard({ hand, opponentCard = null, aiIsFirst = false }) {
  console.log("[Treseta AI] chooseAiCard called with:", {
    hand,
    opponentCard,
    aiIsFirst,
  });

  // Helper: dobije jačinu karte koristeći shared helper
  const strengthOf = (card) => getCardStrength(card);

  // AI igra prvi (nema protivničke karte)
  if (!opponentCard) {
    console.log(
      "[Treseta AI] AI plays first - choosing weakest card to conserve strength"
    );

    // Baci najslabiju kartu (najmanja jačina)
    const chosen = hand.reduce((w, c) =>
      strengthOf(c) < strengthOf(w) ? c : w
    );
    console.log("[Treseta AI] AI chose weakest card:", chosen);
    return chosen;
  }

  // AI odgovara na protivničku kartu
  console.log(
    "[Treseta AI] AI responds to opponent card - looking for winning cards"
  );

  // Note: follow-suit enforcement should be handled by the caller (Game.jsx)
  // This AI function receives an already-filtered hand if follow-suit is required
  let playableHand = hand;

  const winning = playableHand.filter((c) => {
    let winner;

    if (aiIsFirst) {
      // AI je prvi -> testiramo kao (AIcard, opponentCard)
      winner = determineRoundWinner(c, opponentCard, 1);
      console.log(
        `[Treseta AI] Testing card ${c.name} ${c.suit} -> winner:`,
        winner
      );
      return winner === 1; // AI pobjeđuje ako je prvi
    } else {
      // Protivnik igra prvi -> testiramo kao (opponentCard, AIcard)
      winner = determineRoundWinner(opponentCard, c, 1);
      console.log(
        `[Treseta AI] Testing card ${c.name} ${c.suit} -> winner:`,
        winner
      );
      return winner === 2; // AI pobjeđuje ako je drugi
    }
  });

  if (winning.length) {
    // Ako može pobijediti, odaberi najslabiju pobjedničku kartu (da se štedi jača)
    const chosen = winning.reduce((w, c) =>
      strengthOf(c) < strengthOf(w) ? c : w
    );
    console.log("[Treseta AI] AI chose winning card:", chosen);
    return chosen;
  }

  // Ako ne može pobijediti, baci najslabiju kartu iz dostupne ruke
  const chosen = playableHand.reduce((w, c) =>
    strengthOf(c) < strengthOf(w) ? c : w
  );
  console.log("[Treseta AI] AI chose lowest strength card:", chosen);
  return chosen;
}

export { chooseAiCard };

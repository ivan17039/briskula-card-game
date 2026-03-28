import { determineRoundWinner, getCardStrength } from "./gameLogicTreseta.js";
import { checkAkuze } from "./tresetaCommon.js";

function normalizeDifficulty() {
  return "hard";
}

function getRoundPhase(roundNumber = 1) {
  if (roundNumber <= 3) return "early";
  if (roundNumber >= 8) return "late";
  return "mid";
}

function chooseWeakestByStrength(cards, strengthOf) {
  return cards.reduce((w, c) => (strengthOf(c) < strengthOf(w) ? c : w));
}

function chooseCheapestWinningCard(cards, strengthOf) {
  return cards.reduce((best, card) => {
    const currentCost = card.points * 12 + strengthOf(card);
    const bestCost = best.points * 12 + strengthOf(best);
    return currentCost < bestCost ? card : best;
  });
}

function chooseStrongestByStrength(cards, strengthOf) {
  return cards.reduce((s, c) => (strengthOf(c) > strengthOf(s) ? c : s));
}

/**
 * AI za Trešeta bira kartu ovisno o tome igra li prvi (aiIsFirst) ili odgovara na protivničku kartu.
 * API i debug stil su usklađeni s core/briskulaAI.js
 * @param {Object} params
 * @param {Array} params.hand - AI-ova ruka (niz karata)
 * @param {Object|null} params.opponentCard - Protivnička karta (ako AI odgovara)
 * @param {boolean} [params.aiIsFirst=false] - Je li AI prvi na potezu
 * @returns {Object} - Odabrana karta iz ruke
 */
function chooseAiCard({
  hand,
  opponentCard = null,
  aiIsFirst = false,
  difficulty: rawDifficulty = "easy",
  roundNumber = 1,
  myPoints = 0,
  opponentPoints = 0,
}) {
  const difficulty = normalizeDifficulty(rawDifficulty);

  const phase = getRoundPhase(roundNumber);
  const isBehind = myPoints < opponentPoints;

  // Helper: dobije jačinu karte koristeći shared helper
  const strengthOf = (card) => getCardStrength(card);

  // AI igra prvi (nema protivničke karte)
  if (!opponentCard) {
    if (difficulty === "easy") {
      // Baci najslabiju kartu (najmanja jačina)
      return chooseWeakestByStrength(hand, strengthOf);
    }

    // Medium/Hard: when behind later in the hand, pressure with strongest safe card.
    if ((phase === "late" || difficulty === "hard") && isBehind) {
      const nonPointCards = hand.filter((c) => c.points === 0);
      if (nonPointCards.length > 0) {
        return chooseStrongestByStrength(nonPointCards, strengthOf);
      }
      return chooseStrongestByStrength(hand, strengthOf);
    }

    return chooseWeakestByStrength(hand, strengthOf);
  }

  // AI odgovara na protivničku kartu

  // Note: follow-suit enforcement should be handled by the caller (Game.jsx)
  // This AI function receives an already-filtered hand if follow-suit is required
  let playableHand = hand;

  const winning = playableHand.filter((c) => {
    let winner;

    if (aiIsFirst) {
      // AI je prvi -> testiramo kao (AIcard, opponentCard)
      winner = determineRoundWinner(c, opponentCard, 1);
      return winner === 1; // AI pobjeđuje ako je prvi
    } else {
      // Protivnik igra prvi -> testiramo kao (opponentCard, AIcard)
      winner = determineRoundWinner(opponentCard, c, 1);
      return winner === 2; // AI pobjeđuje ako je drugi
    }
  });

  if (winning.length) {
    if (difficulty === "easy") {
      // Ako može pobijediti, odaberi najslabiju pobjedničku kartu (da se štedi jača)
      return chooseWeakestByStrength(winning, strengthOf);
    }

    const trickValue = opponentCard.points || 0;
    const shouldContest =
      phase === "late" ||
      (difficulty === "hard" ? trickValue >= 0.33 : trickValue >= 0.66) ||
      (isBehind && trickValue > 0);

    if (shouldContest) {
      return chooseCheapestWinningCard(winning, strengthOf);
    }
  }

  // Ako ne može pobijediti (ili čuva kartu), baci najslabiju kartu iz dostupne ruke
  return chooseWeakestByStrength(playableHand, strengthOf);
}

/**
 * AI detektira svoje akuže na početku partije i vraća samo najjaču opciju
 * @param {Array} hand - AI-ova početna ruka (10 karata)
 * @returns {Array} - Niz s jednim najjačim akužom
 */
function checkAiAkuze(hand) {
  const availableAkuze = checkAkuze(hand);

  if (availableAkuze.length === 0) {
    return [];
  }

  // Hijerarhija akuža (od najjačeg do najslabijeg)
  const akuzeHierarchy = [
    "Četiri asa", // 4 boda - najjače
    "Četiri dvice", // 4 boda
    "Četiri trice", // 4 boda
    "Napolitana", // 3 boda - jača od trojki
    "Tri asa", // 3 boda
    "Tri dvice", // 3 boda
    "Tri trice", // 3 boda - najslabije
  ];

  // Pronađi najjaču opciju prema hijerarhiji
  let bestAkuz = null;
  let bestRank = akuzeHierarchy.length; // Počni s najgorim rangom

  for (const akuz of availableAkuze) {
    const rank = akuzeHierarchy.indexOf(akuz.description);
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank;
      bestAkuz = akuz;
    }
  }

  if (bestAkuz) {
    return [bestAkuz]; // Vrati samo najjaču opciju
  }

  return [];
}

export { chooseAiCard, checkAiAkuze };

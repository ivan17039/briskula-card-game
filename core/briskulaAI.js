import { determineRoundWinner } from "./gameLogicBriskula.js";

const POINTS_TO_WIN = 61;
const HONOR_VALUES = [1, 3, 13, 12, 11];
const ALL_VALUES = [1, 2, 3, 4, 5, 6, 7, 11, 12, 13];

function normalizeDifficulty() {
  return "hard";
}

function getRoundPhase(roundNumber = 1, remainingDeckCount = 0) {
  if (remainingDeckCount <= 4 || roundNumber >= 12) return "late";
  if (roundNumber <= 5) return "early";
  return "mid";
}

function chooseCheapestWinningCard(winningCards, trumpSuit) {
  return winningCards.reduce((best, card) => {
    const currentCost =
      card.points * 15 + card.strength + (card.suit === trumpSuit ? 6 : 0);
    const bestCost =
      best.points * 15 + best.strength + (best.suit === trumpSuit ? 6 : 0);
    return currentCost < bestCost ? card : best;
  });
}

function isBigScoringCard(card) {
  return (card?.points || 0) >= 10;
}

function isFaceValueCard(card) {
  const points = card?.points || 0;
  return points >= 2 && points <= 4;
}

function getStrategicDiscardPenalty(
  card,
  trumpSuit,
  {
    preserveTrump,
    preserveHigh,
    trickValue = 0,
    phase = "mid",
    scorePressure = false,
  },
) {
  // Base penalty: prefer to discard low-point cards over high-point
  // This means: 0-point cards get low penalty (like to discard), high-point get high penalty (prefer to keep)
  let penalty = card.points * 24 + card.strength * 2;

  // However, if NOT preserving high cards (discarding phase), FLIP the priority:
  // Prefer to throw high-point cards (aces, 3s) so they don't haunt you later
  if (!preserveHigh && card.points >= 3) {
    penalty -= card.points * 8; // Strong negative penalty to prefer discarding high-point
  }
  if (preserveTrump && card.suit === trumpSuit) {
    penalty += 45;
  }

  if (preserveHigh && card.points >= 10) {
    penalty += 90;
  } else if (preserveHigh && card.points >= 4) {
    penalty += 30;
  }

  // Extra protection: do not waste valuable cards on cheap tricks.
  if (trickValue <= 2 && card.suit === trumpSuit) {
    penalty += 70;
  }

  if (trickValue <= 2 && card.points >= 10) {
    penalty += 120;
  }

  if (phase !== "late" && card.points >= 10) {
    penalty += 40;
  }

  if (scorePressure && card.points === 0) {
    penalty -= 8;
  }

  return penalty;
}

function chooseStrategicDiscard(hand, trumpSuit, options) {
  return hand.reduce((best, card) => {
    const currentPenalty = getStrategicDiscardPenalty(card, trumpSuit, options);
    const bestPenalty = getStrategicDiscardPenalty(best, trumpSuit, options);
    return currentPenalty < bestPenalty ? card : best;
  });
}

function chooseOpeningLeadCard(
  hand,
  trumpSuit,
  { phase, isBehind, scorePressure },
) {
  const nonTrumpCards = hand.filter((card) => card.suit !== trumpSuit);
  if (!nonTrumpCards.length) return null;

  const nonTrumpFaces = nonTrumpCards.filter(isFaceValueCard);
  const safeNonTrump = nonTrumpCards.filter((card) => !isBigScoringCard(card));

  // When not under pressure and not late game: prefer safe low-point cards instead of faces
  if (!isBehind && phase !== "late" && safeNonTrump.length) {
    return safeNonTrump.reduce((best, card) => {
      const currentCost = card.points * 10 + card.strength;
      const bestCost = best.points * 10 + best.strength;
      return currentCost < bestCost ? card : best;
    });
  }

  // Early/mid pressure: lead non-trump face cards to pressure opponent
  if (phase !== "late" && !isBehind && nonTrumpFaces.length && scorePressure) {
    return nonTrumpFaces.reduce((best, card) =>
      card.strength < best.strength ? card : best,
    );
  }

  // Fallback: if many high cards, just throw the lowest point non-trump
  return nonTrumpCards.reduce((best, card) => {
    return card.points < best.points
      ? card
      : card.points === best.points && card.strength < best.strength
        ? card
        : best;
  });
}

function getPointsNeeded(points = 0) {
  return Math.max(0, POINTS_TO_WIN - points);
}

function buildKnownValuesBySuit(cards = []) {
  return cards.reduce((acc, card) => {
    if (!card || card.suit == null || card.value == null) return acc;

    if (!acc.has(card.suit)) {
      acc.set(card.suit, new Set());
    }

    acc.get(card.suit).add(card.value);
    return acc;
  }, new Map());
}

function countUnseenHonorsInSuit(suit, knownValuesBySuit) {
  if (!suit) return HONOR_VALUES.length;
  const seen = knownValuesBySuit.get(suit) || new Set();
  return HONOR_VALUES.reduce(
    (count, value) => (seen.has(value) ? count : count + 1),
    0,
  );
}

function countUnseenCardsInSuit(suit, knownValuesBySuit) {
  if (!suit) return ALL_VALUES.length;
  const seen = knownValuesBySuit.get(suit) || new Set();
  return ALL_VALUES.reduce(
    (count, value) => (seen.has(value) ? count : count + 1),
    0,
  );
}

function countUnseenStrongerCardsInSuit(card, knownValuesBySuit) {
  if (!card?.suit) return 0;

  const seen = knownValuesBySuit.get(card.suit) || new Set();
  return ALL_VALUES.reduce((count, value) => {
    if (seen.has(value)) return count;

    // Reconstruct Briskula strength from known value order.
    const strengthMap = {
      1: 10,
      3: 9,
      13: 8,
      12: 7,
      11: 6,
      7: 5,
      6: 4,
      5: 3,
      4: 2,
      2: 1,
    };

    return strengthMap[value] > card.strength ? count + 1 : count;
  }, 0);
}

function chooseMasterPointLead(
  hand,
  trumpSuit,
  knownValuesBySuit,
  { phase, isBehind, scorePressure, remainingDeckCount },
) {
  const nonTrumpPointCards = hand.filter(
    (card) => card.suit !== trumpSuit && card.points >= 3,
  );

  if (!nonTrumpPointCards.length) return null;

  const masterCandidates = nonTrumpPointCards.filter(
    (card) => countUnseenStrongerCardsInSuit(card, knownValuesBySuit) === 0,
  );

  if (!masterCandidates.length) return null;

  const trumpsInHand = hand.filter((card) => card.suit === trumpSuit).length;
  const unseenTrump = countUnseenCardsInSuit(trumpSuit, knownValuesBySuit);
  const hasBigMaster = masterCandidates.some((card) => card.points >= 10);
  const safeNonTrumpFaceExists = hand.some(
    (card) =>
      card.suit !== trumpSuit &&
      card.points >= 2 &&
      card.points <= 4 &&
      card.points < 10,
  );

  // If we are not under pressure and still not in the very last deck turns,
  // probe with a safe non-trump face (e.g., 11/12/13) before exposing As/3.
  if (
    hasBigMaster &&
    safeNonTrumpFaceExists &&
    !isBehind &&
    !scorePressure &&
    remainingDeckCount > 4
  ) {
    return null;
  }

  // Cash out master points in late/pressure states, and also in mid-game when
  // trump risk is high and a big non-trump master (As/3) could be sniped.
  const highTrumpRisk = trumpsInHand <= 1 && unseenTrump >= 4;
  const midDeckExposure = phase !== "early" && remainingDeckCount <= 12;

  if (
    !(
      phase === "late" ||
      isBehind ||
      scorePressure ||
      (hasBigMaster && highTrumpRisk && midDeckExposure)
    )
  ) {
    return null;
  }

  return masterCandidates.reduce((best, card) => {
    if (card.points !== best.points)
      return card.points > best.points ? card : best;
    return card.strength > best.strength ? card : best;
  });
}

function shouldForceTrumpLead(
  trumps,
  { phase, isBehind, scorePressure, opponentPointsNeeded },
) {
  if (!trumps.length) return false;

  if (phase === "late" && (isBehind || scorePressure) && trumps.length >= 2) {
    return true;
  }

  // If opponent is close to 61 and we hold many trumps, pull control early.
  if (opponentPointsNeeded <= 15 && trumps.length >= 3) {
    return true;
  }

  return false;
}

function chooseLateTrumpControlLead(
  hand,
  trumpSuit,
  knownValuesBySuit,
  { remainingDeckCount, phase, isBehind, scorePressure },
) {
  // Late-mid/late risk control: protect vulnerable non-trump As/3 by leading a medium trump.
  if (remainingDeckCount > 10) return null;
  if (phase === "early") return null;

  const trumps = hand.filter((card) => card.suit === trumpSuit);
  if (trumps.length < 2) return null;

  const mediumTrumps = trumps.filter((card) => isFaceValueCard(card));
  if (!mediumTrumps.length) return null;

  const hasStrongTrumpAnchor = trumps.some(
    (card) => card.points >= 10 || card.strength >= 9,
  );
  if (!hasStrongTrumpAnchor) return null;

  const vulnerableNonTrumpBombs = hand.filter(
    (card) => card.suit !== trumpSuit && card.points >= 10,
  );
  if (!vulnerableNonTrumpBombs.length) return null;

  // If trump is almost exhausted and we are not under score pressure, allow gamble lines.
  const unseenTrump = countUnseenCardsInSuit(trumpSuit, knownValuesBySuit);
  if (unseenTrump <= 2 && !scorePressure && !isBehind) return null;

  return mediumTrumps.reduce((best, card) => {
    const currentCost = card.points * 10 + card.strength;
    const bestCost = best.points * 10 + best.strength;
    return currentCost < bestCost ? card : best;
  });
}

function chooseProbingCard(hand, trumpSuit) {
  // Probing: prefer low-strength, non-trump, non-point cards as safe discards
  // Prioritize very weak cards (2) first, then medium (3-5)
  const weakNonTrump = hand.filter(
    (card) =>
      card.suit !== trumpSuit && card.points === 0 && card.strength <= 2,
  );
  if (weakNonTrump.length) {
    return weakNonTrump.reduce((best, card) =>
      card.strength < best.strength ? card : best,
    );
  }

  const mediumNonTrump = hand.filter(
    (card) => card.suit !== trumpSuit && card.points === 0,
  );
  if (mediumNonTrump.length) {
    return mediumNonTrump.reduce((best, card) =>
      card.strength < best.strength ? card : best,
    );
  }

  return null;
}

/**
 * AI bira kartu ovisno o tome igra li prvi (aiIsFirst) ili odgovara na protivničku kartu.
 * @param {Object} params
 * @param {Array} params.hand - AI-ova ruka
 * @param {Object|null} params.opponentCard - Protivnička karta (ako AI odgovara)
 * @param {string} params.trumpSuit - Adut
 * @param {boolean} [params.aiIsFirst=false] - Je li AI prvi na potezu
 * @returns {Object} - Odabrana karta
 */
function chooseAiCard({
  hand,
  opponentCard,
  trumpSuit,
  aiIsFirst = false,
  difficulty: rawDifficulty = "easy",
  roundNumber = 1,
  remainingDeckCount = 0,
  myPoints = 0,
  opponentPoints = 0,
  cardsPlayed = [],
}) {
  const difficulty = normalizeDifficulty(rawDifficulty);

  const phase = getRoundPhase(roundNumber, remainingDeckCount);
  const isBehind = myPoints < opponentPoints;
  const myPointsNeeded = getPointsNeeded(myPoints);
  const opponentPointsNeeded = getPointsNeeded(opponentPoints);
  const scorePressure = myPointsNeeded <= 10 || opponentPointsNeeded <= 10;
  const knownValuesBySuit = buildKnownValuesBySuit([
    ...cardsPlayed,
    ...hand,
    opponentCard,
  ]);

  // ✅ AI igra prvi
  if (!opponentCard) {
    const trumps = hand.filter((c) => c.suit === trumpSuit);

    const masterPointLead = chooseMasterPointLead(
      hand,
      trumpSuit,
      knownValuesBySuit,
      {
        phase,
        isBehind,
        scorePressure,
        remainingDeckCount,
      },
    );
    if (masterPointLead) return masterPointLead;

    const lateTrumpControlLead = chooseLateTrumpControlLead(
      hand,
      trumpSuit,
      knownValuesBySuit,
      {
        remainingDeckCount,
        phase,
        isBehind,
        scorePressure,
      },
    );
    if (lateTrumpControlLead) return lateTrumpControlLead;

    const openingLead = chooseOpeningLeadCard(hand, trumpSuit, {
      phase,
      isBehind,
      scorePressure,
    });
    if (openingLead) return openingLead;

    // Beast mode: force trump when pressure is real and holding trump control.
    const shouldLeadTrump = shouldForceTrumpLead(trumps, {
      phase,
      isBehind,
      scorePressure,
      opponentPointsNeeded,
    });

    if (shouldLeadTrump) {
      return trumps.reduce((w, c) => (c.strength < w.strength ? c : w));
    }

    // Probe with non-trump lishe/medium cards to preserve control cards.
    const probingCard = chooseProbingCard(hand, trumpSuit);
    if (probingCard) return probingCard;

    return chooseStrategicDiscard(hand, trumpSuit, {
      preserveTrump: phase !== "late",
      preserveHigh: true,
      trickValue: 0,
      phase,
      scorePressure,
    });
  }

  // ✅ AI odgovara na protivničku kartu
  const winning = hand.filter((c) => {
    let winner;

    if (aiIsFirst) {
      // AI igra prvi → AI je card1, protivnik card2
      winner = determineRoundWinner(c, opponentCard, trumpSuit, 1);
      return winner === 1; // AI pobjeđuje ako je prvi
    } else {
      // Protivnik igra prvi → on je card1, AI je card2
      winner = determineRoundWinner(opponentCard, c, trumpSuit, 1);
      return winner === 2; // AI pobjeđuje ako je drugi
    }
  });

  const losing = hand.filter(
    (card) => !winning.some((winningCard) => winningCard.id === card.id),
  );

  if (winning.length) {
    const trickValue = opponentCard.points || 0;
    const leadSuit = opponentCard?.suit;
    const sameSuitWinning = winning.filter((c) => c.suit === leadSuit);
    const nonTrumpWinning = winning.filter((c) => c.suit !== trumpSuit);
    const trumpWinning = winning.filter((c) => c.suit === trumpSuit);
    const unseenHonorsInLeadSuit = countUnseenHonorsInSuit(
      opponentCard?.suit,
      knownValuesBySuit,
    );
    const contestThreshold =
      difficulty === "hard" ? (isBehind ? 2 : 4) : isBehind ? 3 : 8;
    const shouldContest =
      phase === "late" ||
      scorePressure ||
      trickValue >= contestThreshold ||
      trickValue >= 10;
    const mustContest =
      trickValue >= 10 || opponentPointsNeeded <= 8 || myPointsNeeded <= 8;

    // In hard mode, secure medium-value tricks when we can win without spending trump.
    const shouldContestNonTrump =
      phase === "late" ||
      scorePressure ||
      isBehind ||
      trickValue >= 2 ||
      (trickValue >= 1 && sameSuitWinning.length > 0);

    if (mustContest && sameSuitWinning.length) {
      return chooseCheapestWinningCard(sameSuitWinning, trumpSuit);
    }

    if (mustContest && nonTrumpWinning.length) {
      return chooseCheapestWinningCard(nonTrumpWinning, trumpSuit);
    }

    if (shouldContestNonTrump && sameSuitWinning.length) {
      return chooseCheapestWinningCard(sameSuitWinning, trumpSuit);
    }

    if (shouldContestNonTrump && nonTrumpWinning.length) {
      return chooseCheapestWinningCard(nonTrumpWinning, trumpSuit);
    }

    const avoidTrumpOnCheapTrick =
      phase !== "late" &&
      !isBehind &&
      trickValue <= 2 &&
      unseenHonorsInLeadSuit > 0 &&
      countUnseenCardsInSuit(leadSuit, knownValuesBySuit) > 0;

    if (nonTrumpWinning.length && shouldContest) {
      return chooseCheapestWinningCard(nonTrumpWinning, trumpSuit);
    }

    if (
      trumpWinning.length &&
      (mustContest || shouldContest) &&
      !avoidTrumpOnCheapTrick
    ) {
      return chooseCheapestWinningCard(trumpWinning, trumpSuit);
    }

    if (shouldContest) {
      return chooseCheapestWinningCard(winning, trumpSuit);
    }

    const leadIsTrump = leadSuit === trumpSuit;
    const onlyTrumpWinners = leadIsTrump && sameSuitWinning.length > 0;
    const cheapestTrumpWinner = onlyTrumpWinners
      ? chooseCheapestWinningCard(sameSuitWinning, trumpSuit)
      : null;
    const hasSafeLowDiscard = losing.some((card) => card.points === 0);

    // Strategic duck: on a cheap trump-led trick, avoid burning a valuable trump
    // winner (e.g. 11/12/13/A/3 trump) when we can safely throw junk.
    if (
      !mustContest &&
      !shouldContest &&
      !isBehind &&
      !scorePressure &&
      trickValue <= 1 &&
      onlyTrumpWinners &&
      cheapestTrumpWinner &&
      cheapestTrumpWinner.points >= 2 &&
      hasSafeLowDiscard
    ) {
      return chooseStrategicDiscard(losing, trumpSuit, {
        preserveTrump: true,
        preserveHigh: true,
        trickValue,
        phase,
        scorePressure,
      });
    }

    // No contest required: only win with same suit to show control, otherwise DISCARD
    // This prevents AI from wasting high cards on cheap tricks.
    if (sameSuitWinning.length) {
      return chooseCheapestWinningCard(sameSuitWinning, trumpSuit);
    }

    // Safeguard: if skipping contest would force us to dump a big card
    // (e.g. non-trump As/3), spend a cheap trump winner instead.
    const hasHighRiskDiscard = losing.some((card) => card.points >= 10);
    const hasCheapTrumpWinner = trumpWinning.some((card) => card.points === 0);
    if (hasHighRiskDiscard && hasCheapTrumpWinner) {
      return chooseCheapestWinningCard(trumpWinning, trumpSuit);
    }

    // If no same-suit option and not contesting, fall through to discard logic.
    // Don't waste trump or high cards on cheap tricks when the user leads nothing valuable.
  }

  if (phase !== "late" && !isBehind) {
    // Keep trump/high honors hidden while the opponent is not threatening.
    const probingCard = chooseProbingCard(hand, trumpSuit);
    if (probingCard) return probingCard;
  }

  const discardPool = losing.length ? losing : hand;

  return chooseStrategicDiscard(discardPool, trumpSuit, {
    preserveTrump: phase !== "late",
    preserveHigh: true,
    trickValue: opponentCard?.points || 0,
    phase,
    scorePressure,
  });
}

export { chooseAiCard };

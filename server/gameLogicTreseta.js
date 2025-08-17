// gameLogicTreseta.js - Logika za Trešeta 1v1

const {
  createDeck,
  shuffleDeck,
  getCardStrength,
  getCardStrengthName,
  isValidMove,
  getPlayableCards,
} = require("./tresetaCommon");

/**
 * Dijeli karte za Trešeta (1v1 ili 2v2)
 * 1v1: Svaki igrač dobije 10 karata, 20 ostaje u špilu
 * 2v2: Svaki igrač dobije 10 karata, 0 ostaje u špilu
 * Trešeta nema trump kartu - prva bačena karta određuje boju runde
 */
function dealCards(deck, is2v2 = false) {
  if (is2v2) {
    // 2v2: 4 igrača x 10 karata = 40 karata (cijeli špil)
    const player1Hand = deck.slice(0, 10);
    const player2Hand = deck.slice(10, 20);
    const player3Hand = deck.slice(20, 30);
    const player4Hand = deck.slice(30, 40);

    return {
      player1Hand,
      player2Hand,
      player3Hand,
      player4Hand,
      remainingDeck: [], // Nema preostalih karata u 2v2
      // Trešeta nema trump kartu
    };
  } else {
    // 1v1: Svaki igrač dobije 10 karata, 20 ostaje u špilu
    const player1Hand = deck.slice(0, 10);
    const player2Hand = deck.slice(10, 20);
    const remainingDeck = deck.slice(20);

    return {
      player1Hand,
      player2Hand,
      remainingDeck,
      // Trešeta nema trump kartu
    };
  }
}

/**
 * Određuje pobjednika runde u Trešeta
 * @param {Object} card1 - Prva karta (prva odigrana)
 * @param {Object} card2 - Druga karta
 * @param {number} firstPlayer - Broj igrača koji je igrao prvi (1 ili 2)
 * @returns {number} - Broj pobjedničkog igrača (1 ili 2)
 */
function determineRoundWinner(card1, card2, firstPlayer) {
  // Prva karta određuje boju runde
  const leadingSuit = card1.suit;

  console.log(`🎯 Trešeta Round Analysis:`, {
    card1: `${card1.name} ${card1.suit} (${getCardStrengthName(card1)})`,
    card2: `${card2.name} ${card2.suit} (${getCardStrengthName(card2)})`,
    leadingSuit: leadingSuit,
    firstPlayer: firstPlayer,
  });

  // Ako su obje karte iste boje, pobjeđuje jača
  if (card1.suit === card2.suit) {
    const card1Strength = getCardStrength(card1);
    const card2Strength = getCardStrength(card2);

    let winner;
    if (card1Strength > card2Strength) {
      // card1 je jača, pobjeđuje igrač koji ju je igrao (firstPlayer)
      winner = firstPlayer;
    } else {
      // card2 je jača, pobjeđuje igrač koji ju je igrao (drugi igrač)
      winner = firstPlayer === 1 ? 2 : 1;
    }

    console.log(
      `✅ Same suit winner: Player ${winner} (${card1Strength} vs ${card2Strength})`
    );
    return winner;
  }

  // Ako druga karta nije iste boje, automatski pobjeđuje prva (mora se odgovarati)
  console.log(`✅ Different suit - first player wins: Player ${firstPlayer}`);
  return firstPlayer;
}

/**
 * Računa bodove u Trešeta sustavu
 * As = 1 bod, 3 bele (trica/duja/kralj/konj/fanat) = 1 bod, zadnja runda = 1 bod
 * Ukupno: 10 bodova + 1 bod za zadnju = 11 bodova
 */
function calculatePoints(cards, ultimaWinner = null, playerNumber = null) {
  let points = 0;
  let bele = 0; // Brojimo bele karte

  cards.forEach((card) => {
    if (card.value === 1) {
      // As = 1 bod
      points += 1;
    } else if (card.value === 3 || card.value === 2) {
      // Trica ili Duja = bela
      bele += 1;
    } else if (card.value === 13 || card.value === 12 || card.value === 11) {
      // Kralj, Konj, Fanat = bela
      bele += 1;
    }
    // Ostale karte (4-7) = lišo, ne donose bodove
  });

  // 3 bele = 1 bod
  points += Math.floor(bele / 3);

  // Dodaj bod za zadnju rundu ako je ovaj igrač pobjedio zadnju
  if (ultimaWinner === playerNumber) {
    points += 1;
  }

  return {
    points: points,
    bele: bele % 3, // Preostale bele (manje od 3)
    totalPossible: 11, // Ukupno mogućih bodova u igri
  };
}

/**
 * Računa akuže (kombinacije) iz ruke
 */
function calculateAkuze(hand) {
  let akuzePoints = 0;
  const akuzeDetails = [];

  // Grupiranje karata po vrijednostima
  const cardsByValue = {};
  const cardsBySuit = {};

  hand.forEach((card) => {
    if (!cardsByValue[card.value]) cardsByValue[card.value] = [];
    if (!cardsBySuit[card.suit]) cardsBySuit[card.suit] = [];

    cardsByValue[card.value].push(card);
    cardsBySuit[card.suit].push(card);
  });

  // Provjeri napolitane (As, Duja, Trica iste boje)
  Object.keys(cardsBySuit).forEach((suit) => {
    const suitCards = cardsBySuit[suit];
    const hasAs = suitCards.some((c) => c.value === 1);
    const hasDuja = suitCards.some((c) => c.value === 2);
    const hasTrica = suitCards.some((c) => c.value === 3);

    if (hasAs && hasDuja && hasTrica) {
      akuzePoints += 3;
      akuzeDetails.push(`Napolitana ${suit}: 3 boda`);
    }
  });

  // Provjeri 3 ili 4 iste vrijednosti (Asevi, Duje, Trice)
  [1, 2, 3].forEach((value) => {
    const cards = cardsByValue[value] || [];
    if (cards.length >= 3) {
      const points = cards.length; // 3 karte = 3 boda, 4 karte = 4 boda
      akuzePoints += points;
      const valueName = value === 1 ? "Asevi" : value === 2 ? "Duje" : "Trice";
      akuzeDetails.push(`${cards.length} ${valueName}: ${points} bodova`);
    }
  });

  return {
    points: akuzePoints,
    details: akuzeDetails,
  };
}

/**
 * Provjera kraja igre za Trešeta
 */
function checkGameEnd(
  player1Points,
  player2Points,
  player1Akuze,
  player2Akuze,
  remainingDeck,
  player1Hand,
  player2Hand
) {
  const totalP1 = player1Points.points + player1Akuze.points;
  const totalP2 = player2Points.points + player2Akuze.points;

  // Cilj: 31 bod bez akuže ili 41 bod s akužom
  const hasAkuze = player1Akuze.points > 0 || player2Akuze.points > 0;
  const targetScore = hasAkuze ? 41 : 31;

  // Provjeri jesu li odigrane sve karte
  const allCardsPlayed =
    remainingDeck.length === 0 &&
    player1Hand.length === 0 &&
    player2Hand.length === 0;

  if (allCardsPlayed) {
    // Dodaj ultima bod (zadnja ruka = +1 bod)
    // U 1v1 implementaciji, ultima ide onome tko je uzeo zadnju ruku
    // To će se odrediti u server logici

    if (totalP1 > totalP2) {
      return {
        isGameOver: true,
        winner: 1,
        reason: `Pobjeda ${totalP1} - ${totalP2}`,
      };
    } else if (totalP2 > totalP1) {
      return {
        isGameOver: true,
        winner: 2,
        reason: `Pobjeda ${totalP2} - ${totalP1}`,
      };
    } else {
      return {
        isGameOver: true,
        winner: null,
        reason: `Neriješeno ${totalP1} - ${totalP2}`,
      };
    }
  }

  // Provjeri je li netko dosegao target score
  if (totalP1 >= targetScore) {
    return {
      isGameOver: true,
      winner: 1,
      reason: `Pobjeda ${totalP1} - ${totalP2} (dosegnut cilj)`,
    };
  }

  if (totalP2 >= targetScore) {
    return {
      isGameOver: true,
      winner: 2,
      reason: `Pobjeda ${totalP2} - ${totalP1} (dosegnut cilj)`,
    };
  }

  return { isGameOver: false };
}

module.exports = {
  createDeck,
  shuffleDeck,
  dealCards,
  determineRoundWinner,
  calculatePoints,
  calculateAkuze,
  checkGameEnd,
  getCardStrength,
  isValidMove,
  getPlayableCards,
};

// gameLogicTreseta2v2.js - Logika za Trešeta 2v2

const {
  createDeck,
  shuffleDeck,
  getCardStrength,
  getCardStrengthName,
  isValidMove,
  getPlayableCards,
} = require("./tresetaCommon");

/**
 * Dijeli karte za Trešeta 2v2
 * Svaki od 4 igrača dobije 10 karata (40 karata ukupno)
 * Nema preostalih karata - cijeli špil se dijeli
 */
function dealCards2v2(deck) {
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
  };
}

/**
 * Kreira početno stanje igre za Trešeta 2v2
 */
function createGameState2v2() {
  const deck = shuffleDeck(createDeck());
  const dealResult = dealCards2v2(deck);

  // Za početak igre (kad nema odigranih karata), sve karte su playable
  const emptyPlayedCards = [];

  return {
    ...dealResult,
    currentPlayer: 1,
    roundStartPlayer: 1, // Tko je počeo trenutnu rundu
    playedCards: [],
    team1Cards: [], // Tim 1 (igrač 1 i 3)
    team2Cards: [], // Tim 2 (igrač 2 i 4)
    trump: null, // Trešeta nema trump
    trumpSuit: null,
    // Trešeta specifično
    ultimaWinner: null,
    team1Akuze: [],
    team2Akuze: [],
    // Playable cards za svaki igrač (na početku sve karte su playable)
    player1PlayableCards: getPlayableCards(
      dealResult.player1Hand,
      emptyPlayedCards
    ),
    player2PlayableCards: getPlayableCards(
      dealResult.player2Hand,
      emptyPlayedCards
    ),
    player3PlayableCards: getPlayableCards(
      dealResult.player3Hand,
      emptyPlayedCards
    ),
    player4PlayableCards: getPlayableCards(
      dealResult.player4Hand,
      emptyPlayedCards
    ),
  };
}

/**
 * Određuje pobjednika runde u Trešeta 2v2
 * @param {Array} playedCards - Array objekata {card, playerNumber} u redoslijedu igranja
 * @param {number} firstPlayer - Broj igrača koji je igrao prvi
 * @returns {number} - Broj pobjedničkog igrača
 */
function determineRoundWinner(playedCards, firstPlayer) {
  if (playedCards.length !== 4) {
    console.error("❌ Trešeta: Treba biti točno 4 karte");
    return firstPlayer;
  }

  // Prva odigrana karta određuje boju runde
  const leadCard = playedCards[0].card;
  const leadingSuit = leadCard.suit;

  console.log(`🎯 Trešeta 2v2 Round Analysis:`, {
    cards: playedCards.map(
      (pc) =>
        `Player${pc.playerNumber}: ${pc.card.name} ${
          pc.card.suit
        } (${getCardStrengthName(pc.card)})`
    ),
    leadingSuit: leadingSuit,
    firstPlayer: firstPlayer,
  });

  let strongestCard = leadCard;
  let winningPlayer = playedCards[0].playerNumber;
  let strongestStrength = getCardStrength(leadCard);

  // Provjeri sve ostale karte - samo one iste boje mogu pobijediti
  for (let i = 1; i < playedCards.length; i++) {
    const currentCard = playedCards[i].card;
    const currentPlayer = playedCards[i].playerNumber;

    // Samo karte iste boje kao prva mogu pobijediti
    if (currentCard.suit === leadingSuit) {
      const strength = getCardStrength(currentCard);
      if (strength > strongestStrength) {
        strongestCard = currentCard;
        winningPlayer = currentPlayer;
        strongestStrength = strength;
      }
    }
  }

  console.log(
    `✅ Winner: Player ${winningPlayer} with ${strongestCard.name} ${strongestCard.suit}`
  );
  return winningPlayer;
}

/**
 * Računa bodove u Trešeta sustavu za tim
 */
function calculateTeamPoints(cards, ultimaWinner = null, teamNumber = null) {
  let points = 0;
  let bele = 0;

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
  });

  // 3 bele = 1 bod
  points += Math.floor(bele / 3);

  // Dodaj bod za zadnju rundu ako je ovaj tim pobjedio zadnju
  if (ultimaWinner === teamNumber) {
    points += 1;
  }

  return {
    points: points,
    bele: bele % 3,
    totalPossible: 11,
  };
}

/**
 * Sljedeći igrač u 2v2 (1 -> 2 -> 3 -> 4 -> 1)
 */
function getNextPlayer2v2(currentPlayer) {
  return currentPlayer === 4 ? 1 : currentPlayer + 1;
}

/**
 * Određuje koji tim je pobijedio rundu
 */
function getWinningTeam(winningPlayer) {
  // Tim 1: igrači 1 i 3
  // Tim 2: igrači 2 i 4
  return winningPlayer === 1 || winningPlayer === 3 ? 1 : 2;
}

module.exports = {
  createDeck,
  shuffleDeck,
  dealCards2v2,
  createGameState2v2,
  getCardStrength,
  getCardStrengthName,
  determineRoundWinner,
  calculateTeamPoints,
  isValidMove,
  getPlayableCards,
  getNextPlayer2v2,
  getWinningTeam,
};

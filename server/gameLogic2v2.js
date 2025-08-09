// gameLogic2v2.js - Ispravljena 2v2 logika za Briskulu

const {
  createDeck,
  shuffleDeck,
  calculatePoints,
  checkGameEnd,
} = require("./gameLogic");

/**
 * Deals cards for 2v2 game (4 cards each player)
 */
function dealCards2v2(deck) {
  const player1Hand = [];
  const player2Hand = [];
  const player3Hand = [];
  const player4Hand = [];

  // Deal 4 cards to each player (16 cards total)
  for (let i = 0; i < 16; i++) {
    const playerIndex = i % 4;
    switch (playerIndex) {
      case 0:
        player1Hand.push(deck[i]);
        break;
      case 1:
        player2Hand.push(deck[i]);
        break;
      case 2:
        player3Hand.push(deck[i]);
        break;
      case 3:
        player4Hand.push(deck[i]);
        break;
    }
  }

  // Trump card is the 17th card
  const trump = deck[16];
  const trumpSuit = trump.suit; // KLJUČNO: Sačuvaj trumpSuit nezavisno od trump karte
  const remainingDeck = deck.slice(17);

  return {
    player1Hand,
    player2Hand,
    player3Hand,
    player4Hand,
    trump,
    trumpSuit, // Dodaj trumpSuit kao zaseban property
    remainingDeck,
    discardPile: [],
  };
}

/**
 * Gets the team number for a player (1&3 = team 1, 2&4 = team 2)
 */
function getPlayerTeam(playerNumber) {
  return playerNumber === 1 || playerNumber === 3 ? 1 : 2;
}

/**
 * Gets the next player in 2v2 rotation (1→2→3→4→1)
 * Ensures players from same team never play consecutively
 */
function getNextPlayer2v2(currentPlayer) {
  return currentPlayer === 4 ? 1 : currentPlayer + 1;
}

/**
 * Determines winner of 4-card round using proper Briskula rules
 */
function determineRoundWinner2v2(playedCards, firstPlayer, trumpSuit) {
  console.log("🥊 Determining 2v2 round winner:", {
    cards: playedCards.map(
      (c) => `P${c.playerNumber}: ${c.card.name} ${c.card.suit}`
    ),
    firstPlayer,
    trumpSuit: trumpSuit,
  });

  // Get the suit of the first played card (determines the "lead suit")
  const leadSuit = playedCards[0].card.suit;

  console.log(`🎯 Lead suit: ${leadSuit}, Trump suit: ${trumpSuit}`);

  let winningCard = playedCards[0];

  for (let i = 1; i < playedCards.length; i++) {
    const currentCard = playedCards[i];

    // Trump cards always win over non-trump cards
    if (trumpSuit) {
      // If current card is trump and winning card is not trump
      if (
        currentCard.card.suit === trumpSuit &&
        winningCard.card.suit !== trumpSuit
      ) {
        winningCard = currentCard;
        console.log(
          `🏆 ${currentCard.card.name} ${currentCard.card.suit} beats non-trump with trump`
        );
        continue;
      }

      // If winning card is trump and current card is not trump
      if (
        winningCard.card.suit === trumpSuit &&
        currentCard.card.suit !== trumpSuit
      ) {
        console.log(
          `🏆 Trump ${winningCard.card.name} ${winningCard.card.suit} beats non-trump`
        );
        continue;
      }

      // If both are trump cards, compare strength
      if (
        currentCard.card.suit === trumpSuit &&
        winningCard.card.suit === trumpSuit
      ) {
        if (currentCard.card.strength > winningCard.card.strength) {
          winningCard = currentCard;
          console.log(
            `🏆 Stronger trump: ${currentCard.card.name} beats ${winningCard.card.name}`
          );
        }
        continue;
      }
    }

    // If neither is trump, only cards of lead suit can win
    if (
      currentCard.card.suit === leadSuit &&
      winningCard.card.suit === leadSuit
    ) {
      if (currentCard.card.strength > winningCard.card.strength) {
        winningCard = currentCard;
        console.log(
          `🏆 Stronger lead suit: ${currentCard.card.name} beats ${winningCard.card.name}`
        );
      }
    } else if (
      currentCard.card.suit === leadSuit &&
      winningCard.card.suit !== leadSuit
    ) {
      // Current card follows suit, winning card doesn't
      winningCard = currentCard;
      console.log(
        `🏆 ${currentCard.card.name} follows lead suit, beats off-suit`
      );
    }
    // If current card doesn't follow suit and winning card does, winning card stays
  }

  console.log(
    `🏆 Round winner: Player ${winningCard.playerNumber} with ${winningCard.card.name} ${winningCard.card.suit}`
  );
  return winningCard.playerNumber;
}

/**
 * Creates initial game state for 2v2
 */
function createGameState2v2() {
  const deck = createDeck();
  const shuffledDeck = shuffleDeck(deck);
  const dealt = dealCards2v2(shuffledDeck);

  return {
    player1Hand: dealt.player1Hand,
    player2Hand: dealt.player2Hand,
    player3Hand: dealt.player3Hand,
    player4Hand: dealt.player4Hand,
    team1Cards: [], // Cards won by team 1 (players 1 & 3)
    team2Cards: [], // Cards won by team 2 (players 2 & 4)
    trump: dealt.trump,
    trumpSuit: dealt.trump.suit, // Sačuvaj trump boju permanentno
    remainingDeck: dealt.remainingDeck,
    currentPlayer: 1, // Start with player 1
    playedCards: [], // Cards played in current round
    gamePhase: "playing",
    winner: null,
    roundNumber: 1,
  };
}

/**
 * Check if 2v2 game is finished
 */
function checkGameEnd2v2(team1Points, team2Points, remainingDeck, allHands) {
  // Check if all cards are played
  const totalCardsLeft =
    remainingDeck.length + allHands.reduce((sum, hand) => sum + hand.length, 0);

  if (totalCardsLeft === 0) {
    if (team1Points > team2Points) {
      return { isGameOver: true, winner: 1, reason: "Više bodova" };
    } else if (team2Points > team1Points) {
      return { isGameOver: true, winner: 2, reason: "Više bodova" };
    } else {
      return { isGameOver: true, winner: null, reason: "Neriješeno (60-60)" };
    }
  }

  // Check for early win (61+ points)
  if (team1Points >= 61) {
    return { isGameOver: true, winner: 1, reason: "61+ bodova" };
  }
  if (team2Points >= 61) {
    return { isGameOver: true, winner: 2, reason: "61+ bodova" };
  }

  return { isGameOver: false, winner: null, reason: null };
}

module.exports = {
  dealCards2v2,
  determineRoundWinner2v2,
  getPlayerTeam,
  getNextPlayer2v2,
  checkGameEnd2v2,
  createGameState2v2,
  calculatePoints,
};

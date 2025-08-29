// gameLogic.js - Backend verzija game logike (CommonJS) - UPDATED

export const SUITS = {
  KUPE: "kupe", // Srca/Čaše
  BATE: "bate", // Štapovi/Toljage
  SPADE: "spade", // Mačevi/Listovi
  DINARE: "dinare", // Novčići/Zlatnici
};

export const VALUES = [1, 2, 3, 4, 5, 6, 7, 11, 12, 13];

export const CARD_NAMES = {
  1: "As",
  2: "Dva",
  3: "Trica",
  4: "Četiri",
  5: "Pet",
  6: "Šest",
  7: "Sedam",
  11: "Fant",
  12: "Konj",
  13: "Kralj",
};

export const CARD_POINTS = {
  1: 11, // As - 11 bodova
  3: 10, // Trica - 10 bodova
  13: 4, // Kralj - 4 boda
  12: 3, // Konj - 3 boda
  11: 2, // Fant - 2 boda
  2: 0, // Ostale karte - 0 bodova
  4: 0,
  5: 0,
  6: 0,
  7: 0,
};

export const CARD_STRENGTH = {
  1: 10, // As - najjača karta
  3: 9, // Trica - druga najjača
  13: 8, // Kralj - 4 boda
  12: 7, // Konj - 3 boda
  11: 6, // Fant - 2 boda
  7: 5, // Sedam
  6: 4, // Šest
  5: 3, // Pet
  4: 2, // Četiri
  2: 1, // Dva - najslabija
};

export function createDeck() {
  const deck = [];
  Object.values(SUITS).forEach((suit) => {
    VALUES.forEach((value) => {
      deck.push({
        suit: suit,
        value: value,
        points: CARD_POINTS[value],
        strength: CARD_STRENGTH[value],
        name: CARD_NAMES[value],
        id: `${suit}_${value}`,
      });
    });
  });
  return deck;
}

export function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(deck) {
  const player1Hand = [];
  const player2Hand = [];

  for (let i = 0; i < 6; i++) {
    if (i % 2 === 0) {
      player1Hand.push(deck[i]);
    } else {
      player2Hand.push(deck[i]);
    }
  }

  const trump = deck[6];
  const trumpSuit = trump.suit;
  const remainingDeck = deck.slice(7);

  return {
    player1Hand,
    player2Hand,
    trump,
    trumpSuit,
    remainingDeck,
    discardPile: [],
  };
}

export function determineRoundWinner(card1, card2, trumpSuit, firstPlayer) {
  console.log("🥊 Određujem pobjednika runde:", {
    card1: `${card1.name} ${card1.suit} (jačina: ${card1.strength})`,
    card2: `${card2.name} ${card2.suit} (jačina: ${card2.strength})`,
    trumpSuit: trumpSuit,
    firstPlayer: firstPlayer,
  });

  // Provjeri da li su obje karte adut
  if (trumpSuit && card1.suit === trumpSuit && card2.suit === trumpSuit) {
    const winner =
      card1.strength > card2.strength ? firstPlayer : firstPlayer === 1 ? 2 : 1;
    console.log("🏆 Obje karte su adut - pobjednik:", winner);
    return winner;
  }

  // Provjeri da li je prva karta adut
  if (trumpSuit && card1.suit === trumpSuit) {
    console.log("🏆 Karta 1 je adut - pobjednik:", firstPlayer);
    return firstPlayer;
  }

  // Provjeri da li je druga karta adut
  if (trumpSuit && card2.suit === trumpSuit) {
    const secondPlayer = firstPlayer === 1 ? 2 : 1;
    console.log("🏆 Karta 2 je adut - pobjednik:", secondPlayer);
    return secondPlayer;
  }

  // Ako su obje karte iste boje (nisu adut)
  if (card1.suit === card2.suit) {
    if (card1.strength > card2.strength) {
      console.log("🏆 Ista boja, card1 jača - pobjednik:", firstPlayer);
      return firstPlayer;
    } else {
      const secondPlayer = firstPlayer === 1 ? 2 : 1;
      console.log("🏆 Ista boja, card2 jača - pobjednik:", secondPlayer);
      return secondPlayer;
    }
  }
  console.log("🏆 Različite boje - pobjednik je prvi igrač:", firstPlayer);
  return firstPlayer;
}

export function calculatePoints(cards) {
  return cards.reduce((total, card) => total + card.points, 0);
}

export function checkGameEnd(
  player1Points,
  player2Points,
  remainingDeck,
  player1Hand,
  player2Hand,
  lastTrickWinner = null
) {
  const totalCardsLeft =
    remainingDeck.length + player1Hand.length + player2Hand.length;

  if (totalCardsLeft === 0) {
    if (player1Points > player2Points) {
      return { isGameOver: true, winner: 1, reason: "Više bodova" };
    } else if (player2Points > player1Points) {
      return { isGameOver: true, winner: 2, reason: "Više bodova" };
    } else {
      if (lastTrickWinner) {
        return {
          isGameOver: true,
          winner: lastTrickWinner,
          reason: "Zadnja štika",
        };
      } else {
        return { isGameOver: true, winner: null, reason: "Neriješeno (60-60)" };
      }
    }
  }

  return { isGameOver: false, winner: null, reason: null };
}

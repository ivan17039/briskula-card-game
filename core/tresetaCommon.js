// tresetaCommon.js - Zajedničke funkcije za Trešeta 1v1 i 2v2

/**
 * Kreira špil karata za Trešeta (40 karata: 1-7, 11-13)
 */
function createDeck() {
  const suits = ["Kupe", "Bati", "Spadi", "Dinari"];
  const ranks = [
    { name: "As", value: 1 },
    { name: "2", value: 2 },
    { name: "3", value: 3 },
    { name: "4", value: 4 },
    { name: "5", value: 5 },
    { name: "6", value: 6 },
    { name: "7", value: 7 },
    { name: "Fant", value: 11 },
    { name: "Konj", value: 12 },
    { name: "Kralj", value: 13 },
  ];

  const deck = [];
  let id = 1;

  suits.forEach((suit) => {
    ranks.forEach((rank) => {
      deck.push({
        id: id++,
        name: rank.name,
        value: rank.value,
        suit: suit,
        image: getCardImage(rank.name, suit),
      });
    });
  });

  return deck;
}

/**
 * Vraća putanju do slike karte
 */
function getCardImage(name, suit) {
  const suitMap = {
    Kupe: "Kupe",
    Bati: "Bati",
    Spadi: "Spadi",
    Dinari: "Dinari",
  };

  const nameMap = {
    As: "As",
    2: "2",
    3: "3",
    4: "4",
    5: "5",
    6: "6",
    7: "7",
    Fant: "Fanat",
    Konj: "Konj",
    Kralj: "Kralj",
  };

  const mappedSuit = suitMap[suit];
  const mappedName = nameMap[name];

  return `/cards_img/${mappedSuit}/${mappedName}${mappedSuit}.jpg`;
}

/**
 * Miješa špil karata
 */
function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Hijerarhija karata u Trešeta: Trica > Duja > As > Kralj > Konj > Fanat > 7 > 6 > 5 > 4
 */
function getCardStrength(card) {
  const strengthMap = {
    3: { strength: 10, name: "Trica (najjača bela)" },
    2: { strength: 9, name: "Duja (druga najjača)" },
    1: { strength: 8, name: "As/Punat (treći najjači)" },
    13: { strength: 7, name: "Kralj (bela)" },
    12: { strength: 6, name: "Konj (bela)" },
    11: { strength: 5, name: "Fanat (bela)" },
    7: { strength: 4, name: "7 (lišo)" },
    6: { strength: 3, name: "6 (lišo)" },
    5: { strength: 2, name: "5 (lišo)" },
    4: { strength: 1, name: "4 (najslabiji lišo)" },
  };

  const result = strengthMap[card.value];
  return result ? result.strength : 0;
}

/**
 * Vraća naziv jačine karte za debug
 */
function getCardStrengthName(card) {
  const strengthMap = {
    3: { strength: 10, name: "Trica (najjača bela)" },
    2: { strength: 9, name: "Duja (druga najjača)" },
    1: { strength: 8, name: "As/Punat (treći najjači)" },
    13: { strength: 7, name: "Kralj (bela)" },
    12: { strength: 6, name: "Konj (bela)" },
    11: { strength: 5, name: "Fanat (bela)" },
    7: { strength: 4, name: "7 (lišo)" },
    6: { strength: 3, name: "6 (lišo)" },
    5: { strength: 2, name: "5 (lišo)" },
    4: { strength: 1, name: "4 (najslabiji lišo)" },
  };

  const result = strengthMap[card.value];
  return result ? result.name : "nepoznato";
}

/**
 * Provjerava je li potez valjan u Trešeti
 */
function isValidMove(card, hand, playedCards) {
  if (playedCards.length === 0) {
    return {
      isValid: true,
      reason: "Prva karta u krugu - sve karte su valjane",
    };
  }

  const leadCard = playedCards[0];
  const leadSuit = leadCard.suit;

  if (card.suit === leadSuit) {
    return { isValid: true, reason: "Prati boju vodeće karte" };
  }

  const hasSameSuit = hand.some((handCard) => handCard.suit === leadSuit);

  if (hasSameSuit) {
    return {
      isValid: false,
      reason: `Morate odigrati kartu boje ${leadSuit}. Imate je u ruci.`,
    };
  }

  return {
    isValid: true,
    reason: "Nemate kartu odgovarajuće boje - možete odigrati bilo koju",
  };
}

/**
 * Vraća listu karata koje igrač može odigrati u trenutnom krugu
 */
function getPlayableCards(hand, playedCards) {
  if (playedCards.length === 0) {
    return hand.map((card) => card.id);
  }

  const leadSuit = playedCards[0].suit;
  const sameSuitCards = hand.filter((card) => card.suit === leadSuit);

  if (sameSuitCards.length > 0) {
    return sameSuitCards.map((card) => card.id);
  } else {
    return hand.map((card) => card.id);
  }
}

export {
  createDeck,
  getCardImage,
  shuffleDeck,
  getCardStrength,
  getCardStrengthName,
  isValidMove,
  getPlayableCards,
};

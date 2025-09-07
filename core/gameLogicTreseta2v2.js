// gameLogicTreseta2v2.js - Logika za Trešeta 2v2

import {
  createDeck,
  shuffleDeck,
  getCardStrength,
  getCardStrengthName,
  isValidMove,
  getPlayableCards,
} from "./tresetaCommon.js";

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

// Backwards-compatible alias used by server code which expects `dealCards(deck, is2v2)`
function dealCards(deck, is2v2 = true) {
  // Ignore is2v2 flag here; this module is the 2v2 implementation
  return dealCards2v2(deck);
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
    // Ukupni bodovi kroz seriju partija
    totalTeam1Points: 0,
    totalTeam2Points: 0,
    targetScore: 31, // Cilj za konačnu pobjedu
    currentPartija: 1,
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

/**
 * Provjera kraja igre za Trešeta 2v2
 * @param {Object} team1Points - Bodovi tima 1 iz partije
 * @param {Object} team2Points - Bodovi tima 2 iz partije
 * @param {Object} team1Akuze - Akuze tima 1
 * @param {Object} team2Akuze - Akuze tima 2
 * @param {Array} remainingDeck - Preostale karte u špilu
 * @param {Array} player1Hand - Karte igrača 1 u ruci
 * @param {Array} player2Hand - Karte igrača 2 u ruci
 * @param {Array} player3Hand - Karte igrača 3 u ruci
 * @param {Array} player4Hand - Karte igrača 4 u ruci
 * @param {number} totalTeam1Points - Ukupni bodovi tima 1 kroz sve partije
 * @param {number} totalTeam2Points - Ukupni bodovi tima 2 kroz sve partije
 * @param {number} targetScore - Cilj bodova (31 ili 41)
 */
function checkGameEnd(
  team1Points,
  team2Points,
  team1Akuze,
  team2Akuze,
  remainingDeck,
  player1Hand,
  player2Hand,
  player3Hand,
  player4Hand,
  totalTeam1Points = 0,
  totalTeam2Points = 0,
  targetScore = null
) {
  const partidaT1 =
    team1Points.points + team1Akuze.reduce((sum, akuz) => sum + akuz.points, 0);
  const partidaT2 =
    team2Points.points + team2Akuze.reduce((sum, akuz) => sum + akuz.points, 0);

  // Dinamički cilj: 31 bod bez akuže ili 41 bod s akužom (ako nije eksplicitno zadan)
  const hasAkuze = team1Akuze.length > 0 || team2Akuze.length > 0;
  const actualTargetScore = targetScore || (hasAkuze ? 41 : 31);

  // Provjeri jesu li odigrane sve karte (partija je završena)
  const allCardsPlayed =
    remainingDeck.length === 0 &&
    player1Hand.length === 0 &&
    player2Hand.length === 0 &&
    player3Hand.length === 0 &&
    player4Hand.length === 0;

  if (allCardsPlayed) {
    // Partija je završena - dodaj bodove u ukupni rezultat
    const newTotalT1 = totalTeam1Points + partidaT1;
    const newTotalT2 = totalTeam2Points + partidaT2;

    // Provjeri je li postignuto konačno prvo mjesto (31/41 bodova)
    const isFinalGameOver =
      newTotalT1 >= actualTargetScore || newTotalT2 >= actualTargetScore;

    if (isFinalGameOver) {
      // Konačna pobjeda - završi cijelu seriju partija
      if (newTotalT1 > newTotalT2) {
        return {
          isGameOver: true,
          isPartidaOver: true,
          isFinalGameOver: true,
          winner: 1, // Tim 1
          reason: `Konačna pobjeda ${newTotalT1} - ${newTotalT2}`,
          partidaWinner:
            partidaT1 > partidaT2 ? 1 : partidaT1 < partidaT2 ? 2 : null,
          partidaScore: `${partidaT1} - ${partidaT2}`,
          newTotalTeam1Points: newTotalT1,
          newTotalTeam2Points: newTotalT2,
        };
      } else if (newTotalT2 > newTotalT1) {
        return {
          isGameOver: true,
          isPartidaOver: true,
          isFinalGameOver: true,
          winner: 2, // Tim 2
          reason: `Konačna pobjeda ${newTotalT2} - ${newTotalT1}`,
          partidaWinner:
            partidaT1 > partidaT2 ? 1 : partidaT1 < partidaT2 ? 2 : null,
          partidaScore: `${partidaT1} - ${partidaT2}`,
          newTotalTeam1Points: newTotalT1,
          newTotalTeam2Points: newTotalT2,
        };
      } else {
        return {
          isGameOver: true,
          isPartidaOver: true,
          isFinalGameOver: true,
          winner: null,
          reason: `Konačno neriješeno ${newTotalT1} - ${newTotalT2}`,
          partidaWinner:
            partidaT1 > partidaT2 ? 1 : partidaT1 < partidaT2 ? 2 : null,
          partidaScore: `${partidaT1} - ${partidaT2}`,
          newTotalTeam1Points: newTotalT1,
          newTotalTeam2Points: newTotalT2,
        };
      }
    } else {
      // Partija završena, ali serija nastavlja - pripremi za novu partiju
      return {
        isGameOver: true,
        isPartidaOver: true,
        isFinalGameOver: false,
        winner: partidaT1 > partidaT2 ? 1 : partidaT1 < partidaT2 ? 2 : null,
        reason: `Partija završena ${partidaT1} - ${partidaT2}. Ukupno: ${newTotalT1} - ${newTotalT2}`,
        partidaWinner:
          partidaT1 > partidaT2 ? 1 : partidaT1 < partidaT2 ? 2 : null,
        partidaScore: `${partidaT1} - ${partidaT2}`,
        newTotalTeam1Points: newTotalT1,
        newTotalTeam2Points: newTotalT2,
      };
    }
  }

  // Provjeri je li netko dosegao cilj tijekom partije (rijetko, ali moguće s akužama)
  if (partidaT1 >= actualTargetScore) {
    const newTotalT1 = totalTeam1Points + partidaT1;
    const newTotalT2 = totalTeam2Points + partidaT2;

    return {
      isGameOver: true,
      isFinalGameOver: true,
      winner: 1, // Tim 1
      reason: `Konačna pobjeda ${partidaT1} - ${partidaT2} (dosegnut cilj u partiji)`,
      partidaWinner: 1,
      partidaScore: `${partidaT1} - ${partidaT2}`,
      newTotalTeam1Points: newTotalT1,
      newTotalTeam2Points: newTotalT2,
    };
  }

  if (partidaT2 >= actualTargetScore) {
    const newTotalT1 = totalTeam1Points + partidaT1;
    const newTotalT2 = totalTeam2Points + partidaT2;

    return {
      isGameOver: true,
      isFinalGameOver: true,
      winner: 2, // Tim 2
      reason: `Konačna pobjeda ${partidaT2} - ${partidaT1} (dosegnut cilj u partiji)`,
      partidaWinner: 2,
      partidaScore: `${partidaT1} - ${partidaT2}`,
      newTotalTeam1Points: newTotalT1,
      newTotalTeam2Points: newTotalT2,
    };
  }

  return { isGameOver: false, isFinalGameOver: false };
}

export {
  createDeck,
  shuffleDeck,
  dealCards2v2,
  dealCards,
  createGameState2v2,
  getCardStrength,
  getCardStrengthName,
  determineRoundWinner,
  calculateTeamPoints,
  checkGameEnd,
  isValidMove,
  getPlayableCards,
  getNextPlayer2v2,
  getWinningTeam,
};

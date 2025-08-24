"use client";
import "./Card.css";

function Card({
  card,
  isPlayable = false,
  isSelected = false,
  isHidden = false,
  onClick = () => {},
  size = "medium",
}) {
  const getCardImage = () => {
    if (isHidden) {
      return "/cards_img/BackOfCard.webp";
    }
    if (!card || !card.suit || !card.value) return null;

    const suitFolders = {
      Kupe: "Kupe",
      Bati: "Bati",
      Spadi: "Spadi",
      Dinari: "Dinari",
      // Legacy support for old format
      kupe: "Kupe",
      bate: "Bati",
      spade: "Spadi",
      dinare: "Dinari",
    };

    const folder = suitFolders[card.suit];
    let fileName = "";

    if (card.value === 1) fileName = `As${folder}.jpg`;
    else if (card.value >= 2 && card.value <= 7)
      fileName = `${card.value}${folder}.jpg`;
    else if (card.value === 11) fileName = `Fanat${folder}.jpg`;
    else if (card.value === 12) fileName = `Konj${folder}.jpg`;
    else if (card.value === 13) fileName = `Kralj${folder}.jpg`;
    else return null;

    const imagePath = `/cards_img/${folder}/${fileName}`;
    return imagePath;
  };

  const cardImage = getCardImage();

  const cardClasses = [
    "card",
    `card-${size}`,
    isPlayable ? "card-playable" : "",
    isSelected ? "card-selected" : "",
    isHidden ? "card-hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const handleCardClick = (event) => {
    if (isPlayable) {
      onClick(card);
      // Remove hover state AFTER click to avoid interfering with game logic
      setTimeout(() => {
        if (event.currentTarget) {
          event.currentTarget.blur();
        }
      }, 50);
    }
  };

  return (
    <div
      className={cardClasses}
      onClick={handleCardClick}
      title={
        card?.name ? `${card.name} ${card.suit} (${card.points} bodova)` : ""
      }
    >
      {cardImage ? (
        <img
          src={cardImage || "/placeholder.svg"}
          alt={card?.name ? `${card.name} ${card.suit}` : "Card"}
          className="card-image"
          draggable={false}
        />
      ) : (
        <div
          className="card-image"
          style={{
            background: "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: "24px",
            fontWeight: "bold",
          }}
        >
          ?
        </div>
      )}
    </div>
  );
}

export default Card;

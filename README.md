# Briškula & Trešeta Card Games

A real-time multiplayer card game platform built with React.js and Socket.io, featuring **Briškula** and **Trešeta** Italian-origin classics beloved across Mediterranean countries in 1v1 and 2v2 modes. These games spread from Italy and have long been part of everyday play in places like Croatia, Montenegro, Slovenia, Spain, and Portugal. Over time, local house rules developed around dealing, drawing, and table talk, yet the core gameplay remains faithful to the original Italian traditions. The app uses the traditional 40‑card Italian deck and lets you enjoy quick matches, longer series, or tournament play online.

## 🎮 About the Games

### Briskula (Briškula/Briscola)

Traditional Croatian card game with trump-based mechanics:

- **Trump System**: One suit dominates others
- **Point Collection**: Win valuable cards to score points
- **Strategic Play**: Master trump timing and card counting

### Trešeta

Popular Balkan card game with trick-taking mechanics:

- **No Trump**: Pure skill-based card strength
- **Trick Taking**: Win tricks with higher-value cards
- **Point Strategy**: Collect high-value cards (A=11, 3=10)

## 🃏 Game Features

- **Multiple Game Types**: Choose between Briskula or Trešeta
- **Multiple Modes**: 1v1 or 2v2 gameplay
- **Real-time Multiplayer**: Instant gameplay powered by Socket.io
- **Cross Layout**: Cards positioned relative to each player's perspective
- **Mobile-Optimized**: Responsive design with touch-friendly controls
- **Traditional Rules**: Authentic Croatian game mechanics

## 🎲 Game Rules

### Briskula Rules

- **Deck**: 40 cards (As, 2, 3, 4, 5, 6, 7, Fant, Konj, Kralj) in 4 suits
- **Trump Card**: Determines winning suit hierarchy
- **Card Values**: As=11, Trica=10, Kralj=4, Konj=3, Fant=2, others=0
- **Winning**: Trump beats non-trump, higher value wins
- **Objective**: Score 61+ points to win

### Trešeta Rules

- **Deck**: Same 40-card deck, no trump system
- **Card Hierarchy**: Trica > Duja > As > Kralj > Konj > Fant > 7 > 6 > 5 > 4
- **Scoring**: As=1 point, 3 Bele (face cards)=1 point, Ultima (last trick)=1 point (max 11 per game)
- **Follow Suit**: Must follow the led suit when possible
- **Akuze**: Napolitana (As+Duja+Trica same suit)=3, 3 or 4 same rank=3 or 4 points
- **Objective**: Score 31 points across rounds or 41 with Akuze

## 🛠️ Technology Stack

**Frontend**

- React.js with Vite build system
- Responsive CSS with mobile-first approach
- Socket.io client for real-time communication
- Cross-platform card positioning system
- Touch-optimized mobile interface

**Backend**

- Node.js with Express framework
- Socket.io server for multiplayer functionality
- Separate game logic engines for Briskula and Trešeta
- Real-time matchmaking system
- Support for 1v1 and 2v2 game modes

**Deployment**

- Vercel (Frontend hosting)
- Render/Railway (Backend hosting)
- Environment-based configuration

## 🎯 Key Features

- **Dual Game Support**: Both Briskula and Trešeta gameplay
- **Smart Card Layout**: Cards positioned relative to each player
- **Responsive Design**: Optimized for desktop, tablet, and mobile
- **Real-time Communication**: Instant multiplayer experience
- **Game State Management**: Persistent game sessions
- **Mobile Controls**: Touch-friendly card selection
- **Cross-Browser Support**: Works on all modern browsers

## 📱 Game Components

- **Login**: User authentication and guest play
- **GameTypeSelector**: Choose between Briskula and Trešeta
- **GameModeSelector**: Choose between 1v1 and 2v2 modes
- **Matchmaking**: Find players and join game rooms
- **Game**: Main 1v1 game interface with cross layout
- **Game2v2**: Team-based 2v2 interface with player positioning
- **Card System**: Interactive card playing with validation

## 🌐 Live Demo

**Production URL**: [https://briskula-treseta.games](https://briskula-treseta.games)

Experience both Briskula and Trešeta online with players from around the world!

## 💻 Development Notes

This project combines traditional Croatian card game mechanics with modern web technologies. The implementation features:

- **Real-time synchronization** between multiple players
- **Responsive card positioning** that adapts to each player's perspective
- **Game validation logic** ensuring fair play and rule enforcement
- **Mobile-first design** with touch-optimized controls
- **Scalable architecture** supporting both game types seamlessly

---

**Made with ❤️ for All card game enthusiasts worldwide**

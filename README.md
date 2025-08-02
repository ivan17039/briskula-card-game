# Briskula Card Game

A real-time multiplayer Croatian card game built with React.js and Socket.io, featuring both 1v1 and 2v2 game modes with traditional Briskula gameplay.

## 🎮 About Briskula

Briskula (Briškula/Briscola) is a popular traditional card game from the Balkans. This digital version brings the authentic experience online with:

- **1v1 Mode**: Classic head-to-head gameplay
- **2v2 Mode**: Team-based competitive matches
- **Real-time Multiplayer**: Instant gameplay powered by Socket.io
- **Mobile-First Design**: Optimized for all devices
- **Traditional Rules**: Authentic Croatian card game mechanics

## 🃏 Game Rules

- **Deck**: 40 cards (A, 2, 3, 4, 5, 6, 7, J, Q, K) in 4 suits
- **Trump Card**: One card determines the trump suit
- **Objective**: Score the most points by winning valuable cards
- **Card Values**: A=11, 3=10, K=4, Q=3, J=2, others=0
- **Winning**: Player/team with most points after all cards are played

## 🛠️ Technology Stack

**Frontend**

- React.js with Vite build system
- Responsive CSS with mobile-first approach
- Socket.io client for real-time communication

**Backend**

- Node.js with Express framework
- Socket.io server for multiplayer functionality
- Game logic handling for both 1v1 and 2v2 modes

**Deployment**

- Vercel (Frontend hosting)
- Render (Backend hosting)
- Supabase (Database & Authentication)

## 🎯 Features

- **Multiple Game Modes**: Choose between 1v1 or 2v2 gameplay
- **Real-time Multiplayer**: Seamless online experience
- **Responsive Design**: Works perfectly on desktop and mobile
- **User Authentication**: Secure login system
- **Game Rooms**: Join or create custom game sessions
- **Traditional Gameplay**: Authentic Briskula rules and mechanics

## 📱 Game Components

- **Login**: User authentication and profile management
- **GameModeSelector**: Choose between 1v1 and 2v2 modes
- **Matchmaking**: Find players and join game rooms
- **Game**: Main 1v1 game interface
- **Game2v2**: Team-based 2v2 game interface
- **Card System**: Interactive card playing mechanics

## 📁 Project Structure

```
CardGame/
├── src/
│   ├── App.jsx              # Main application component
│   ├── Login.jsx            # User authentication
│   ├── GameModeSelector.jsx # Game mode selection
│   ├── Matchmaking.jsx      # Room joining/creation
│   ├── Game.jsx             # 1v1 game interface
│   ├── Game2v2.jsx          # 2v2 game interface
│   ├── Card.jsx             # Card component
│   ├── SocketContext.jsx    # Socket.io context
│   └── *.css               # Component styles
├── server/
│   ├── server.js           # Express server setup
│   ├── gameLogic.js        # 1v1 game logic
│   └── gameLogic2v2.js     # 2v2 game logic
```

## � Live Demo

Coming soon - currently in development for web deployment

## 👨‍💻 Development

This project was built with modern web technologies to provide a smooth, real-time gaming experience that honors the traditional Croatian Briskula card game while making it accessible to players worldwide.

---

**Made with ❤️ for Briskula enthusiasts**

# 2v2 Briskula Card Game

A real-time multiplayer card game built with React.js and Socket.io, featuring traditional Serbian Briskula gameplay with 2v2 team mechanics.

## 🎮 Game Features

- **2v2 Team Play**: Competitive 4-player card game
- **Real-time Multiplayer**: Powered by Socket.io for instant gameplay
- **Responsive Design**: Optimized for desktop and mobile devices
- **Traditional Briskula Rules**: Authentic Serbian card game experience
- **User Authentication**: Secure login with Supabase integration

## 🚀 Live Demo

- **Frontend**: [https://cardgame-frontend.vercel.app](https://cardgame-frontend.vercel.app)
- **Backend**: Hosted on Render

## 🛠️ Tech Stack

### Frontend

- **React.js** - Modern UI framework
- **Vite** - Fast build tool and dev server
- **CSS3** - Responsive styling with mobile-first approach
- **Socket.io Client** - Real-time communication

### Backend

- **Node.js** - Server runtime
- **Express.js** - Web framework
- **Socket.io** - Real-time bidirectional communication
- **Supabase** - Database and authentication

### Deployment

- **Vercel** - Frontend hosting
- **Render** - Backend hosting
- **Supabase** - Database hosting

## 📱 Game Components

- **GameModeSelector**: Choose between different game modes
- **Matchmaking**: Find and join game rooms
- **Game2v2**: Main 4-player game interface
- **Login**: User authentication system

## 🎯 Installation & Setup

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Supabase account

### Local Development

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/cardgame.git
   cd cardgame
   ```

2. **Install frontend dependencies**

   ```bash
   npm install
   ```

3. **Install backend dependencies**

   ```bash
   cd server
   npm install
   cd ..
   ```

4. **Environment Setup**

   Copy `.env.example` to `.env.local` and configure:

   ```env
   REACT_APP_SERVER_URL=http://localhost:3001
   REACT_APP_SUPABASE_URL=your_supabase_project_url
   REACT_APP_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

5. **Start the development servers**

   Frontend:

   ```bash
   npm run dev
   ```

   Backend (in new terminal):

   ```bash
   cd server
   npm start
   ```

6. **Open your browser**
   ```
   http://localhost:5173
   ```

## 🌐 Deployment

### Vercel (Frontend)

1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on push to main branch

### Render (Backend)

1. Create new Web Service on Render
2. Connect your GitHub repository
3. Set build command: `cd server && npm install`
4. Set start command: `cd server && npm start`

### Supabase (Database)

1. Create new project on Supabase
2. Set up authentication tables
3. Configure RLS policies
4. Get project URL and anon key

## 🎲 Game Rules

Briskula is a traditional Serbian trick-taking card game:

- **Players**: 4 players in 2 teams
- **Cards**: 32-card deck (7, 8, 9, 10, J, Q, K, A)
- **Objective**: Score points by winning tricks
- **Trump**: One suit is designated as trump
- **Winning**: First team to reach target score wins

## 📁 Project Structure

```
CardGame/
├── src/                    # React frontend
│   ├── components/         # React components
│   ├── assets/            # Static assets
│   └── main.jsx           # App entry point
├── server/                # Node.js backend
│   ├── gameLogic.js       # Core game logic
│   ├── gameLogic2v2.js    # 2v2 specific logic
│   └── server.js          # Express server
├── cards_img/             # Card images
├── public/                # Public assets
└── package.json           # Dependencies
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 👨‍💻 Author

Created with ❤️ for traditional card game enthusiasts

---

**Made with React.js & Socket.io**

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

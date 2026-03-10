// Login.jsx - Komponenta za autentikaciju sa Supabase

import React, { useState, useEffect } from "react";
import { track } from "@plausible-analytics/tracker";
import { auth } from "./supabase.js";
import { useSocket } from "./SocketContext";
import "./Login.css";

function Login({ onLogin, pendingJoinCode }) {
  const { user } = useSocket();
  const [loginMode, setLoginMode] = useState("guest"); // 'guest', 'login', ili 'register'
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Check if user is already logged in
  useEffect(() => {
    if (user) {
      // User is already logged in, skip to next screen
      onLogin(user);
      return;
    }

    const checkUser = async () => {
      const { user: supabaseUser } = await auth.getUser();
      if (supabaseUser) {
        onLogin({
          name: supabaseUser.user_metadata?.username || supabaseUser.email,
          email: supabaseUser.email,
          isGuest: false,
          userId: supabaseUser.id,
        });
      }
    };
    checkUser();
  }, [onLogin, user]);

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  // Generate random 5-character guest name
  const generateGuestId = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 5; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      if (loginMode === "guest") {
        // Guest pristup
        const guestName = formData.name.trim() || `Guest_${generateGuestId()}`;
        await onLogin({
          name: guestName,
          isGuest: true,
        });

        // Track guest login
        try {
          track("User Login", {
            props: {
              loginType: "guest",
            },
          });
        } catch (err) {
          console.debug("Analytics tracking error:", err);
        }
      } else if (loginMode === "login") {
        // Supabase login
        const { data, error } = await auth.signIn(
          formData.email,
          formData.password,
        );

        if (error) {
          // Handleuj specifične login greške
          if (
            error.message.includes("Invalid login credentials") ||
            error.message.includes("invalid")
          ) {
            throw new Error("Neispravni podaci za prijavu");
          } else if (error.message.includes("too many")) {
            throw new Error("Previše pokušaja. Pokušajte kasnije.");
          } else {
            throw new Error(error.message || "Greška pri prijavi");
          }
        }

        await onLogin({
          name: data.user.user_metadata?.username || data.user.email,
          email: data.user.email,
          isGuest: false,
          userId: data.user.id,
        });

        // Track registered user login
        try {
          track("User Login", {
            props: {
              loginType: "registered",
            },
          });
        } catch (err) {
          console.debug("Analytics tracking error:", err);
        }
      } else if (loginMode === "register") {
        // Supabase registracija
        if (!formData.name.trim()) {
          throw new Error("Ime je obavezno");
        }

        // Simple email validation
        if (!formData.email.trim()) {
          throw new Error("Email je obavezan");
        }
        if (!formData.email.includes("@") || !formData.email.includes(".")) {
          throw new Error("Unesite važeću email adresu");
        }

        if (formData.password.length < 6) {
          throw new Error("Password mora imati najmanje 6 karaktera");
        }

        const { data, error } = await auth.signUp(
          formData.email.trim(),
          formData.password,
          formData.name.trim(),
        );

        if (error) {
          // Handleuj specifične Supabase greške
          if (
            error.message.includes("already registered") ||
            error.message.includes("already been registered")
          ) {
            throw new Error("Korisnik sa ovim emailom već postoji");
          } else if (error.message.includes("invalid email")) {
            throw new Error("Email adresa nije važeća");
          } else if (error.message.includes("password")) {
            throw new Error("Password nije dovoljno jak");
          } else {
            throw new Error(error.message || "Greška pri registraciji");
          }
        }

        if (data.user) {
          await onLogin({
            name: formData.name.trim(),
            email: formData.email.trim(),
            isGuest: false,
            userId: data.user.id,
          });

          // Track new user registration
          try {
            track("User Registered", {
              props: {
                loginType: "new_account",
              },
            });
          } catch (err) {
            console.debug("Analytics tracking error:", err);
          }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // If user is already logged in, show loading or redirect
  if (user) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="loading-state">
            <h2>Već ste ulogirani</h2>
            <p>Preusmjeravam vas...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>
          <img
            src="/cards_img/kupeICON.png"
            alt="Dinari"
            className="title-suit-icon"
          />
          Briskula Online
        </h1>
        <p className="subtitle">Pridružite se igri protiv drugih igrača!</p>

        {/* Pending join code notification */}
        {pendingJoinCode && (
          <div className="join-code-notification">
            <div className="join-code-icon">🔗</div>
            <div className="join-code-text">
              <strong>Prijavite se kako biste se pridružili igri!</strong>
              <p>
                Vaš prijatelj vas je pozvao da se pridružite igri s kodom:{" "}
                <strong>{pendingJoinCode}</strong>
              </p>
            </div>
          </div>
        )}

        {/* Izbor načina prijave */}
        <div className="login-mode-selector">
          <button
            type="button"
            className={`mode-btn ${loginMode === "guest" ? "active" : ""}`}
            onClick={() => setLoginMode("guest")}
          >
            🎮 Igraj kao gost
          </button>
          <button
            type="button"
            className={`mode-btn ${loginMode === "login" ? "active" : ""}`}
            onClick={() => setLoginMode("login")}
          >
            🔑 Prijavi se
          </button>
          <button
            type="button"
            className={`mode-btn ${loginMode === "register" ? "active" : ""}`}
            onClick={() => setLoginMode("register")}
          >
            👤 Registriraj se
          </button>
        </div>

        {/* Forma */}
        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}

          {/* Ime korisnika - samo za guest i register */}
          {(loginMode === "guest" || loginMode === "register") && (
            <div className="form-group">
              <label htmlFor="name">
                {loginMode === "guest"
                  ? "Nadimak (opcionalno)"
                  : "Ime korisnika"}
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder={
                  loginMode === "guest" ? "Guest_123" : "Unesite ime"
                }
                required={loginMode === "register"}
              />
            </div>
          )}

          {/* Email (za login i registraciju) */}
          {(loginMode === "login" || loginMode === "register") && (
            <div className="form-group">
              <label htmlFor="email">Email adresa</label>
              <input
                type="email"
                id="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="your@email.com"
                required
              />
            </div>
          )}

          {/* Password (za login i registraciju) */}
          {(loginMode === "login" || loginMode === "register") && (
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder="Unesite password"
                required
                minLength={6}
              />
            </div>
          )}

          {/* Gumb za prijavu */}
          <button type="submit" className="login-btn" disabled={isLoading}>
            {isLoading ? (
              <span>⏳ Prijavljivanje...</span>
            ) : loginMode === "guest" ? (
              "🎮 Uđi u igru"
            ) : loginMode === "login" ? (
              "🔑 Prijavi se"
            ) : (
              "👤 Registriraj se"
            )}
          </button>
        </form>

        {/* Info o guest pristupu */}
        {loginMode === "guest" && (
          <div className="guest-info">
            <p>
              <strong>Guest pristup:</strong>
              <br />
              • Možete odmah početi igrati
              <br />• Ime će biti nasumično ako ne unesete svoje
              <br />• Registracijom otključavate ELO i leaderboard
            </p>
          </div>
        )}

        {/* Info o registraciji */}
        {loginMode === "register" && (
          <div className="register-info">
            <p>
              <strong>Registracija omogućuje:</strong>
              <br />
              • Trajno čuvanje statistika
              <br />
              • Sudjelovanje u turnirima
              <br />• Personalizirani profil
              <br />• ELO rangiranje i leaderboard
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;

import React from "react";
import "./Footer.css";

function Footer({ onBugReport, onAbout, onPrivacy }) {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="footer-content">
        <div className="footer-section">
          <h4>Briškula & Trešeta</h4>
          <p>Online kartaške igre</p>
        </div>

        <div className="footer-icons">
          <img
            src="/cards_img/spadiICON.png"
            alt="Spadi"
            className="footer-icon"
          />
          <img
            src="/cards_img/batiICON.png"
            alt="Bati"
            className="footer-icon"
          />
          <img
            src="/cards_img/kupeICON.png"
            alt="Kupe"
            className="footer-icon"
          />
          <img
            src="/cards_img/dinarICON.png"
            alt="Dinari"
            className="footer-icon"
          />
        </div>

        <div className="footer-section">
          <h4>Linkovi</h4>
          <ul className="footer-links">
            <li>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onAbout && onAbout();
                }}
              >
                O igri
              </a>
            </li>
            <li>
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onPrivacy && onPrivacy();
                }}
              >
                Privatnost
              </a>
            </li>
            <li>
              <a
                href="https://github.com/ivan17039/briskula-card-game"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </li>
            <li>
              <button className="footer-link-btn" onClick={onBugReport}>
                Prijavi bug
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div className="footer-bottom">
        <p>&copy; {currentYear} Briskula Online. Sva prava pridržana.</p>
        <p className="footer-version">v1.0.0-beta</p>
      </div>
    </footer>
  );
}

export default Footer;

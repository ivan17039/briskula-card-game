import React from "react";
import "./About.css";

function About({ onBack }) {
  return (
    <div className="about-container">
      <div className="about-card">
        <div className="about-header">
          <button className="about-back-btn" onClick={onBack}>
            ←
          </button>
          <h1>O igri</h1>
        </div>

        <div className="about-content">
          <p>
            Briškula & Trešeta Online je moderna web aplikacija koja omogućuje
            igranje kartaških igara Briškula i Trešeta u stvarnom vremenu,
            protiv prijatelja, AI protivnika ili putem organiziranih turnira.
          </p>

          <h2>Značajke</h2>
          <ul>
            <li>
              ⚡ Igra u stvarnom vremenu - instant multiplayer bez čekanja
            </li>
            <li>🤖 AI protivnici za vježbu i solo igranje</li>
            <li>🏆 Turniri s eliminacijskim bracket sustavom</li>
            <li>📊 Kompetitivno ELO rangiranje i globalna ljestvica</li>
            <li>👥 Privatne sobe za igranje s prijateljima</li>
            <li>📱 Responzivan dizajn - igrajte na bilo kojem uređaju</li>
          </ul>

          <h2>ELO sustav</h2>
          <p>
            Implementacija kompetitivnog ELO rangiranja s razinama (1–10,
            Challenger), ljestvicom i post-match prikazom promjene bodova. Gosti
            su označeni kao Unranked i ne ulaze u ljestvicu.
          </p>

          <h2>Ciljevi</h2>
          <ul>
            <li>Stabilna i glatka igra s opcijama 1v1 i 2v2</li>
            <li>Turnirska struktura s eliminacijskim bracketom</li>
            <li>Profesionalan, responzivan UI i UX</li>
          </ul>

          <h2>Kontakt</h2>
          <p>
            Za prijave problema i prijedloge koristite opciju "Prijavi bug".
          </p>
        </div>
      </div>
    </div>
  );
}

export default About;

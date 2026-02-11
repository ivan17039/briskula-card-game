import React from "react";
import "./AboutModal.css";

function AboutModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>O igri</h2>
          <button className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p>
            Briškula & Trešeta Online je moderna web aplikacija koja omogućuje
            igranje kartaških igara Briškula i Trešeta u stvarnom vremenu,
            protiv prijatelja, AI protivnika ili putem organiziranih turnira.
          </p>

          <h3>Značajke</h3>
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

          <h3>ELO sustav</h3>
          <p>
            Implementacija kompetitivnog ELO rangiranja s razinama (1–10,
            Challenger), ljestvicom i post-match prikazom promjene bodova. Gosti
            su označeni kao Unranked i ne ulaze u ljestvicu.
          </p>

          <h3>Ciljevi</h3>
          <ul>
            <li>Stabilna i glatka igra s opcijama 1v1 i 2v2</li>
            <li>Turnirska struktura s eliminacijskim bracketom</li>
            <li>Profesionalan, responzivan UI i UX</li>
          </ul>

          <h3>Kontakt</h3>
          <p>
            Za prijave problema i prijedloge koristite opciju "Prijavi bug".
          </p>
        </div>
      </div>
    </div>
  );
}

export default AboutModal;

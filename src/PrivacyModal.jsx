import React from "react";
import "./AboutModal.css"; // Reuse the same styling

function PrivacyModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Privatnost</h2>
          <button className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p>
            Vodimo brigu o vašoj privatnosti. Ova aplikacija prikuplja minimalne
            podatke potrebne za funkcionalnost (npr. korisničko ime, email za
            registrirane korisnike, statistika mečeva). Podaci se čuvaju u
            Supabase sustavu.
          </p>

          <h3>Koje podatke prikupljamo?</h3>
          <ul>
            <li>Korisnički račun: email, nadimak (za registrirane)</li>
            <li>Statistika: pobjede/porazi, ELO</li>
            <li>Tehnički podaci: session tokeni, ID soba</li>
          </ul>

          <h3>Kako koristimo podatke?</h3>
          <p>
            Podaci služe za autentikaciju, održavanje sesija, prikaz ljestvice i
            poboljšanje kvalitete igre. Ne dijelimo podatke s trećim stranama.
          </p>

          <h3>Vaša prava</h3>
          <ul>
            <li>Pravo na uvid i brisanje podataka</li>
            <li>Pravo na odjavu i deaktivaciju računa</li>
            <li>Pravo na prijavu problema putem "Prijavi bug" opcije</li>
          </ul>

          <p>
            Za upite vezane uz privatnost i podršku koristite in-app opciju
            "Prijavi bug".
          </p>
        </div>
      </div>
    </div>
  );
}

export default PrivacyModal;

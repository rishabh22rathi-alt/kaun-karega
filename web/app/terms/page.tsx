import React from "react";

export default function TermsPage() {
  return (
    <main style={{ backgroundColor: "#f3f4f6", minHeight: "100vh", padding: "24px" }}>
      <section
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          backgroundColor: "#ffffff",
          padding: "32px",
          borderRadius: "8px",
        }}
      >
        <style>{`
      * {
        color: #111111 !important;
        opacity: 1 !important;
        filter: none !important;
      }
      h1, h2, h3 {
        color: #0f172a !important;
      }
      p, li {
        color: #1f2937 !important;
      }
    `}</style>

        <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "12px" }}>
          Terms of Service - Kaun Karega
        </h1>
        <p>The platform connects users with independent service providers.</p>
        <p>Kaun Karega is not responsible for the quality of services delivered.</p>
        <p>Users must provide accurate and lawful information.</p>
        <p>Any disputes between users and providers are handled independently.</p>
      </section>
    </main>
  );
}

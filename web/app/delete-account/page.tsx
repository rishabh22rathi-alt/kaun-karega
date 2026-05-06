import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Delete Account - Kaun Karega",
  description:
    "Request deletion of your Kaun Karega account and personal data by emailing kaunkarega.in@gmail.com.",
};

export default function DeleteAccount() {
  return (
    <main
      style={{
        backgroundColor: "#ffffff",
        minHeight: "100vh",
        width: "100%",
        padding: "clamp(20px, 4vw, 40px) clamp(16px, 4vw, 32px)",
        color: "#111827",
        fontFamily:
          "var(--font-geist-sans), Arial, Helvetica, sans-serif",
        lineHeight: 1.7,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{`
        .kk-delete * { color: inherit; }
        .kk-delete .kk-brand {
          display: inline-block;
          font-weight: 700;
          color: #1d4ed8;
          letter-spacing: 0.2px;
        }
        .kk-delete h1 {
          font-size: clamp(26px, 4vw, 34px);
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 8px;
          line-height: 1.25;
        }
        .kk-delete h2 {
          font-size: clamp(18px, 2.6vw, 22px);
          font-weight: 600;
          color: #0f172a;
          margin: 28px 0 10px;
          line-height: 1.3;
        }
        .kk-delete p {
          color: #1f2937;
          margin: 0 0 12px;
          font-size: clamp(15px, 1.8vw, 16px);
        }
        .kk-delete ol, .kk-delete ul {
          color: #1f2937;
          padding-left: 22px;
          margin: 0 0 12px;
          font-size: clamp(15px, 1.8vw, 16px);
        }
        .kk-delete li { margin: 6px 0; }
        .kk-delete strong { color: #0f172a; }
        .kk-delete a {
          color: #1d4ed8;
          text-decoration: underline;
          word-break: break-word;
        }
        .kk-delete a:hover { color: #1e40af; }
        .kk-delete .kk-card {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: clamp(14px, 2.4vw, 18px) clamp(16px, 2.8vw, 22px);
          margin: 16px 0 24px;
        }
        .kk-delete .kk-meta {
          color: #4b5563;
          font-size: 14px;
          margin-bottom: 20px;
        }
        .kk-delete .kk-note {
          color: #475569;
          font-size: 14px;
        }
        @media (prefers-color-scheme: dark) {
          .kk-delete-shell {
            background-color: #ffffff !important;
            color: #111827 !important;
          }
        }
      `}</style>

      <article
        className="kk-delete kk-delete-shell"
        style={{ maxWidth: "820px", margin: "0 auto" }}
      >
        <p className="kk-meta">
          <span className="kk-brand">Kaun Karega</span>
        </p>

        <h1>Delete Your Account</h1>
        <p>
          You can request deletion of your <strong>Kaun Karega</strong> account
          and personal data at any time. We process every verified request and
          confirm once your data has been removed from our active systems.
        </p>

        <div className="kk-card">
          <p style={{ margin: 0 }}>
            <strong>Email us at: </strong>
            <a href="mailto:kaunkarega.in@gmail.com?subject=Account%20Deletion%20Request%20-%20Kaun%20Karega">
              kaunkarega.in@gmail.com
            </a>
          </p>
          <p className="kk-note" style={{ margin: "6px 0 0" }}>
            Please email from a contact you can verify, and include your
            registered phone number so we can match your account.
          </p>
        </div>

        <h2>What can be deleted</h2>
        <ul>
          <li>Your phone number and registered account profile</li>
          <li>Saved location, service category and provider details</li>
          <li>Past task / job history linked to your account</li>
        </ul>

        <h2>What may be retained temporarily</h2>
        <p>
          Some legal, security and fraud-prevention logs (for example OTP
          delivery records, abuse reports, or transaction logs required by law)
          may be retained for a limited period before being purged. This is
          only kept as long as necessary to meet legal and security
          obligations.
        </p>

        <h2>Steps to request deletion</h2>
        <ol>
          <li>
            Email <strong>kaunkarega.in@gmail.com</strong> from the contact
            linked to your account.
          </li>
          <li>
            In the email, mention your <strong>registered phone number</strong>
            {" "}and clearly state that this is a <strong>deletion request</strong>.
          </li>
          <li>
            Our team will verify the request and process the deletion. You will
            receive a confirmation email once it&apos;s done.
          </li>
        </ol>

        <h2>Need help?</h2>
        <p>
          If you have any questions about your data, write to us at{" "}
          <a href="mailto:kaunkarega.in@gmail.com">kaunkarega.in@gmail.com</a>{" "}
          and we&apos;ll get back to you.
        </p>
      </article>
    </main>
  );
}

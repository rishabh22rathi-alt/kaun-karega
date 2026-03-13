// components/OtpRequestForm.jsx
import { useEffect, useState } from "react";

// Assuming this component receives onClose and onSuccess from its parent (the modal)
export default function OtpRequestForm({ onClose, onSuccess }) {
    // Phase 1: OTP Send State
    const [phoneNumber, setPhoneNumber] = useState("");
    const [sendOtpStatus, setSendOtpStatus] = useState("");
    const [sendOtpLoading, setSendOtpLoading] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const RESEND_TIMEOUT_SECONDS = 120;
    const [resendTimer, setResendTimer] = useState(0);
    
    // Phase 2: OTP Verify State
    const [otpInput, setOtpInput] = useState(""); // <--- NEW: State for OTP Input
    const [isOtpSent, setIsOtpSent] = useState(false); // <--- NEW: State to switch views
    const [verifyOtpLoading, setVerifyOtpLoading] = useState(false);
    const [verifyOtpStatus, setVerifyOtpStatus] = useState("");
    const [error, setError] = useState("");
    const [toastMessage, setToastMessage] = useState("");

    const showToast = (message) => {
        setToastMessage(message);
        setTimeout(() => setToastMessage(""), 3000);
    };

    useEffect(() => {
        if (resendTimer <= 0) return;
        const timer = setTimeout(() => setResendTimer((prev) => Math.max(prev - 1, 0)), 1000);
        return () => clearTimeout(timer);
    }, [resendTimer]);

    const handleSendOtp = async (e) => {
        e.preventDefault();
        setSendOtpStatus("");
        setSendOtpLoading(true);
        setIsLoading(true);
        setError("");

        try {
            const res = await fetch("/api/send-otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    // IMPORTANT: We hardcoded '91' in the backend. 
                    // Ensure the phoneNumber state here includes the country code 
                    // if your backend requires it, or handle it in the backend.
                    toPhoneNumber: phoneNumber, 
                    otpCode: "789012",
                    buttonUrl: "http://localhost:3000/login",
                }),
            });

            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error(text || "Non-JSON response from server");
            }

            if (!res.ok) {
                throw new Error(data.error || data.details || "Failed to send OTP");
            }

            setSendOtpStatus("OTP sent successfully! Please check your WhatsApp.");
            setIsOtpSent(true); // <--- Move to the verification view!
            setResendTimer(RESEND_TIMEOUT_SECONDS);

        } catch (err) {
            const message = err instanceof Error ? err.message : "Error sending OTP";
            setSendOtpStatus(message);
            if (message.includes("Unable to find phone column")) {
                showToast(message);
            }
        } finally {
            setSendOtpLoading(false);
            setIsLoading(false);
        }
    };

    const handleEditPhone = () => {
        setIsOtpSent(false);
        setOtpInput("");
        setVerifyOtpStatus("");
        setError("");
    };

    // --- NEW: Function to handle OTP Verification ---
    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        setVerifyOtpStatus("");
        setVerifyOtpLoading(true);
        setIsLoading(true);
        setError("");

        // Simple client-side validation for the 4-digit code
        if (otpInput.length !== 4) {
            setVerifyOtpStatus("Please enter the 4-digit code.");
            setVerifyOtpLoading(false);
            return;
        }

        try {
            const res = await fetch("/api/verify-otp", { // <--- Calls our new API route
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phone: phoneNumber,
                    otp: otpInput,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                const message = data.error || "Invalid OTP. Please try again.";
                if (message.toLowerCase().includes("already verified")) {
                    setVerifyOtpStatus("Phone number already verified.");
                    if (onClose) onClose();
                    if (onSuccess) onSuccess();
                    return;
                }
                if (res.status === 401) {
                    setError(message);
                }
                // Verification failed (e.g., status 401 for Invalid OTP)
                throw new Error(message);
            }

            // SUCCESS!
            setVerifyOtpStatus("Verification Successful!");
            
            // 1. Close the modal
            if (onClose) onClose(); 
            // 2. Notify the parent page to show the "Request Submitted" message
            if (onSuccess) onSuccess(); 

        } catch (err) {
            const message = err instanceof Error ? err.message : "Error verifying OTP";
            setVerifyOtpStatus(message);
            if (message.includes("Unable to find phone column")) {
                showToast(message);
            }
        } finally {
            setVerifyOtpLoading(false);
            setIsLoading(false);
        }
    };
    // -------------------------------------------------

    const styles = {
        form: {
            width: "100%",
            maxWidth: 420,
            margin: "0 auto",
            minHeight: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: "0.85rem",
            fontFamily: '"Manrope", "Segoe UI", sans-serif',
            lineHeight: 1.6,
        },
        textBlock: {
            maxWidth: 380,
        },
        header: {
            margin: 0,
            fontSize: "1.25rem",
            fontWeight: 700,
            color: "#111827",
        },
        subheader: {
            margin: "0.35rem 0 0",
            fontSize: "0.95rem",
            color: "#6B7280",
        },
        divider: {
            width: "100%",
            maxWidth: 320,
            border: 0,
            borderTop: "1px solid #E5E7EB",
            margin: "0.35rem 0 0.15rem",
        },
        privacy: {
            width: "100%",
            maxWidth: 320,
            marginTop: "0.25rem",
            fontSize: "0.82rem",
            color: "#6B7280",
            background: "#F9FAFB",
            borderRadius: 10,
            padding: "0.6rem 0.75rem",
        },
        fieldGroup: {
            width: "100%",
            maxWidth: 320,
        },
        label: {
            display: "block",
            marginBottom: 4,
            fontWeight: 600,
            color: "#111827",
        },
        input: {
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid #D1D5DB",
            textAlign: "center",
        },
        button: {
            width: "100%",
            padding: "10px",
            marginTop: "1rem",
        },
        secondaryButton: {
            width: "100%",
            padding: "10px",
            marginTop: "0.75rem",
        },
    };

    return (
        <form onSubmit={isOtpSent ? handleVerifyOtp : handleSendOtp} 
              style={styles.form}>
            {toastMessage && (
                <div style={{ marginBottom: "0.5rem", color: "#B45309" }}>
                    {toastMessage}
                </div>
            )}

            <div style={styles.textBlock}>
                <h2 style={styles.header}>Please verify your number to continue</h2>
                <p style={styles.subheader}>Connecting you with the best local providers.</p>
            </div>

            <hr style={styles.divider} />

            {/* --- Phone Number Input --- */}
            <div style={styles.fieldGroup}>
                <label htmlFor="phone" style={styles.label}>
                    Phone Number
                </label>
                <input
                    id="phone"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="Enter phone with country code (e.g., 91...)"
                    style={styles.input}
                    required
                />
                {!isOtpSent && (
                    <button 
                        type="submit" 
                        disabled={sendOtpLoading || isLoading} 
                        style={styles.button}
                    >
                        {sendOtpLoading ? "Sending..." : "Send OTP"}
                    </button>
                )}
                {isOtpSent && (
                    <button
                        type="button"
                        onClick={handleEditPhone}
                        style={styles.secondaryButton}
                    >
                        Change Number
                    </button>
                )}
            </div>
            
            {/* --- PHASE 2: OTP Input (Visible after Send OTP is successful) --- */}
            {isOtpSent && (
                <>
                    <div style={styles.fieldGroup}>
                        <label htmlFor="otp" style={styles.label}>
                            Enter OTP
                        </label>
                        <input
                            id="otp"
                            type="text"
                            inputMode="numeric"
                            maxLength="4"
                            value={otpInput}
                            onChange={(e) => setOtpInput(e.target.value.replace(/[^0-9]/g, ''))}
                            placeholder="e.g., 7890"
                            style={styles.input}
                            required
                        />
                    </div>
                    {error && (
                        <div style={{ color: "red", marginBottom: "0.5rem" }}>
                            {error}
                        </div>
                    )}
                    <button 
                        type="submit" 
                        disabled={verifyOtpLoading || isLoading} 
                        style={styles.button}
                    >
                        {verifyOtpLoading ? "Verifying..." : "Verify OTP"}
                    </button>
                    <button
                        type="button"
                        onClick={handleSendOtp}
                        disabled={resendTimer > 0 || sendOtpLoading || isLoading}
                        style={styles.secondaryButton}
                    >
                        {resendTimer > 0 ? `Resend OTP in ${resendTimer} seconds` : "Send OTP Again"}
                    </button>
                </>
            )}

            {/* --- Status Messages --- */}
            {(sendOtpStatus || verifyOtpStatus) && (
                <div style={{ marginTop: "0.75rem", fontSize: "0.9rem", color: isOtpSent ? 'green' : 'red' }}>
                    {isOtpSent ? verifyOtpStatus : sendOtpStatus}
                </div>
            )}

            <div style={styles.privacy}>
                Private &amp; Secure. Your number is never shared. Negotiate via a secure WhatsApp chat.
            </div>
        </form>
    );
}

// 1. Configuration Type Definition
interface WhatsAppConfig {
  whatsappToken: string;
  whatsappPhoneId: string;
}

/**
 * Ensures required WhatsApp configuration variables are present.
 * NOTE: Replace process.env access with your actual environment variable loading method
 * (e.g., config file, Secrets Manager, etc.).
 *
 * @returns The configuration object.
 * @throws Error if configuration variables are missing.
 */
function ensureWhatsAppConfig(): WhatsAppConfig {
  // --- Replace these lines with how you securely load your tokens/IDs ---
  const whatsappToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const whatsappPhoneId = process.env.WHATSAPP_PHONE_ID;
  // ---------------------------------------------------------------------

  if (!whatsappToken) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is not configured.");
  }
  if (!whatsappPhoneId) {
    throw new Error("WHATSAPP_PHONE_ID is not configured.");
  }

  return { whatsappToken, whatsappPhoneId };
}

/**
 * Sends an OTP message via a WhatsApp template.
 *
 * @param phone The recipient's phone number (must include country code, e.g., "919876543210").
 * @param otp The one-time password (e.g., "123456").
 * @returns A Promise that resolves when the message is successfully queued or rejects on failure.
 * @throws Error on API call failure or misconfiguration.
 */
export async function sendOtpMessage(phone: string, otp: string): Promise<void> {
  // 1. Configuration Check
  let config: WhatsAppConfig;

  try {
    config = ensureWhatsAppConfig();


  } catch (error) {
    console.error("Configuration Error:", error);
    // Re-throw if configuration is missing, as the API call cannot proceed.
    throw error;
  }
  
  const { whatsappToken, whatsappPhoneId } = config;

  // The dynamic URL parameter for the button variable ({{1}} in the URL suffix).
  // **CAUTION**: If your template button is static, REMOVE the entire 'button' component from the payload.
  const dynamicUrlParameter = "login"; // or requestId or token

  // 2. WhatsApp API Endpoint
  // Using v19.0 as of now, update to the latest version if needed.
  const apiEndpoint = `https://graph.facebook.com/v19.0/${whatsappPhoneId}/messages`;

  // 3. Request Payload
  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: "kk_login_code", // Ensure this matches your approved template name exactly
      language: { code: "en_US" },
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: otp, // Variable for the body (e.g., {{1}} in the message body)
            },
          ],
        },
       /* {
          type: "button",
          sub_type: "URL",
          index: 0, 
          parameters: [
            {
              type: "text",
              text: dynamicUrlParameter, // Variable for the button's dynamic URL part
            },
          ],
        },*/
      ],
    },
  };

  // 4. Fetch Call and Error Handling
  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${whatsappToken}`, 
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // API call failed (4xx or 5xx status)
      const errorData = await response.json().catch(() => ({})); // Handle case where response is not JSON
      
      const errorMessage = errorData.error 
        ? errorData.error.message 
        : `Unknown API error. Status: ${response.status}`;

      console.error('WhatsApp API Error:', { status: response.status, details: errorData });
      
      throw new Error(`Failed to send OTP message. ${errorMessage}`);
    }

    // Success response
    const successData = await response.json();
    console.log(`OTP sent successfully to ${phone}. ID: ${successData.messages[0].id}`);
    
  } catch (error) {
    // Network errors or errors re-thrown from configuration/API check
    console.error('sendOtpMessage execution failed:', error);
    throw error;
  }
}

// --- Example Usage (Optional: uncomment to test) ---
/*
async function main() {
    try {
        // **IMPORTANT**: Replace with a real number and OTP for testing
        const recipientPhone = "12345678900"; 
        const testOtp = "998877"; 

        console.log(`Attempting to send OTP ${testOtp} to ${recipientPhone}...`);
        
        await sendOtpMessage(recipientPhone, testOtp);

        console.log("Message sending attempt complete.");

    } catch (error) {
        console.error("Main execution failed:", error);
    }
}
// main();
*/

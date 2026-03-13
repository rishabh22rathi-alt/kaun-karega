// components/lib/utils/whatsapp-sender.ts

/**
 * Interface to define the required WhatsApp configuration variables.
 */
interface IWhatsAppConfig {
    WHATSAPP_ACCESS_TOKEN: string;
    WHATSAPP_PHONE_ID: string;
}

/**
 * Ensures that the required environment variables (META_WA_TOKEN and META_WA_PHONE_ID)
 * are set and returns the configuration.
 * Throws an error if any essential variable is missing.
 *
 * @returns {IWhatsAppConfig} The validated configuration object.
 */
function getWhatsAppConfig(): IWhatsAppConfig {
    const WHATSAPP_ACCESS_TOKEN = process.env.META_WA_TOKEN;
    const WHATSAPP_PHONE_ID = process.env.META_WA_PHONE_ID;

    if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_ID) {
        throw new Error(
            'META_WA_TOKEN or META_WA_PHONE_ID is not configured. ' +
            'Please set these environment variables in your .env.local file.'
        );
    }

    return {
        WHATSAPP_ACCESS_TOKEN: WHATSAPP_ACCESS_TOKEN,
        WHATSAPP_PHONE_ID: WHATSAPP_PHONE_ID,
    };
}

/**
 * Sends a One-Time Password (OTP) via the WhatsApp Cloud API using a template.
 * This function is now configured to match the official Meta structure for sending 
 * an Authentication Template message, where the OTP code is sent in both the body 
 * and the button component to fulfill the template's placeholders.
 *
 * @param {string} toPhoneNumber - The recipient's phone number (E.164 format, e.g., '919876543210').
 * @param {string} otpCode - The 6-digit OTP code to send.
 * @param {string} buttonUrl - NOTE: This parameter is ignored, as URLs are not supported for this template type.
 * @returns {Promise<any>} The JSON response from the WhatsApp API.
 */
export async function sendOtpMessage(
    toPhoneNumber: string,
    otpCode: string,
    buttonUrl: string
): Promise<any> {
    try {
        const config = getWhatsAppConfig();

        const API_ENDPOINT = `https://graph.facebook.com/v19.0/${config.WHATSAPP_PHONE_ID}/messages`;

        // Payload structured exactly as shown in Meta's "Sending authentication templates" example.
        const payload = {
            messaging_product: 'whatsapp',
            to: toPhoneNumber,
            type: 'template',
            template: {
                name: 'kk_login_code',
                language: {
                    code: 'en_US',
                },
                components: [
                    {
                        // Component 1: Body (sends OTP code to body placeholder)
                        type: 'body',
                        parameters: [
                            {
                                type: 'text',
                                text: otpCode, 
                            },
                        ],
                    },
                    {
                        // Component 2: Button (sends OTP code to the button placeholder as required by Meta's structure)
                        type: 'button',
                        sub_type: 'url',
                        index: 0,
                        parameters: [
                            {
                                type: 'text',
                                text: otpCode, // Send OTP code again as the button parameter
                            },
                        ],
                    },
                    // NOTE: If your template has code expiration (e.g., "in 5 minutes"), it is defined 
                    // at the time of template creation (code_expiration_minutes) and not sent here.
                ],
            },
        };

        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('[WHATSAPP API ERROR] Status:', response.status);
            console.error('[WHATSAPP API ERROR] Details:', data);
            throw new Error(`WhatsApp API error: ${data.error?.message || 'Unknown error'}`);
        }

        console.log('[WHATSAPP SUCCESS] Message Sent:', data);
        return data;

    } catch (error) {
        console.error('[SEND OTP ERROR] Error:', error instanceof Error ? error.message : 'An unknown error occurred');
        throw error;
    }
}
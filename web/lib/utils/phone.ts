export function normalizePhone(phone: string) {
  phone = phone.replace(/\D/g, ""); // remove non-digit characters

  if (phone.length === 10) {
    return `+91${phone}`; // assume India if 10 digits
  }

  if (phone.startsWith("91") && phone.length === 12) {
    return `+${phone}`;
  }

  if (phone.startsWith("+") && phone.length > 10) {
    return phone;
  }

  return null; // invalid phone
}

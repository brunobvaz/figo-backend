export const normalizeEmail = (value) => value.trim().toLowerCase();
export const normalizePhone = (value) => {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('00351')) return `+${digits.slice(2)}`;
  if (digits.startsWith('351')) return `+${digits}`;
  return `+351${digits}`;
};

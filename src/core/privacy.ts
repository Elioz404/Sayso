// Masks buyers' personal details in text shown to people who aren't the shop's owner (the shared public
// demo session): emails keep their first letter and domain, so the story still reads.

const EMAIL = /([A-Za-z0-9])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function maskPersonalData(text: string): string {
  return text.replace(EMAIL, (_all, first: string, domain: string) => `${first}***@${domain}`);
}

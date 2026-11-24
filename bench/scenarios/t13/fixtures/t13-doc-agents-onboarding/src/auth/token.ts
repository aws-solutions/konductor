export function signSubject(subject: string, signingKey: string): string {
  return `${subject}.${signingKey.length}`;
}

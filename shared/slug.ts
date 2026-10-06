/** "Igiene orale" → "igiene-orale": id leggibile da un nome (senza accenti né simboli). */
export function slugify(s: string, fallback: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || fallback
  )
}

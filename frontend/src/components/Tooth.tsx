export function Tooth({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.5 3C5 3 3.5 5 3.5 7.5c0 3 1.5 4.5 2 7.5.4 2.8 1.2 6 2.8 6 1.4 0 1.5-2.6 2.2-4.6.3-.9.8-1.4 1.5-1.4s1.2.5 1.5 1.4c.7 2 .8 4.6 2.2 4.6 1.6 0 2.4-3.2 2.8-6 .5-3 2-4.5 2-7.5C20.5 5 19 3 16.5 3 14.5 3 13.6 4.2 12 4.2S9.5 3 7.5 3z" />
    </svg>
  )
}

/**
 * West Client logosu ("Batı" pusulası). İğne kuzeyi değil batıyı gösterir;
 * halka batı noktasında açılır ve amber uç oradan dışarı taşar. Batıyı gösteren
 * uç kullanıcının vurgu rengini, karşı uç nötr tonu alır.
 */
export function Logo({ size = 18, mono = false }: { size?: number; mono?: boolean }) {
  const tip = mono ? "currentColor" : "rgb(var(--accent))";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g opacity="0.55">
        <path d="M5.2 6.4A9.25 9.25 0 1 1 5.2 17.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <g fill="currentColor">
          <circle cx="12" cy="3.9" r="0.9" />
          <circle cx="12" cy="20.1" r="0.9" />
          <circle cx="20.1" cy="12" r="0.9" />
        </g>
      </g>
      <path d="M1.6 12 12.4 8.7 11 12 12.4 15.3Z" fill={tip} />
      <path d="M12.4 8.7 17.6 12 12.4 15.3 13.8 12Z" fill="currentColor" fillOpacity="0.45" />
    </svg>
  );
}

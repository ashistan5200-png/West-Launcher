/**
 * West Client pusula logosu. Düz vektör: dış halka, ana yön çentikleri ve
 * iki renkli iğne. Kuzey ucu vurgu rengini, güney ucu nötr tonu kullanır;
 * böylece logo kullanıcının seçtiği temaya uyar.
 */
export function Logo({ size = 18, mono = false }: { size?: number; mono?: boolean }) {
  const north = mono ? "currentColor" : "rgb(var(--accent))";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {/* Opaklık grup düzeyinde: halka ve çentik kesişimleri çift boyanmaz */}
      <g opacity="0.55" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="12" cy="12" r="10.25" />
        <path d="M12 1.75v2.1M12 20.15v2.1M1.75 12h2.1M20.15 12h2.1" />
      </g>
      {/* İğne: kuzey-güney ekseni hafifçe batıya (West) eğik */}
      <g transform="rotate(-35 12 12)">
        <path d="M12 4.6 14.6 12H9.4L12 4.6Z" fill={north} />
        <path d="M12 19.4 9.4 12h5.2L12 19.4Z" fill="currentColor" fillOpacity="0.38" />
      </g>
      <circle cx="12" cy="12" r="1.35" fill="rgb(var(--bg))" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1" />
    </svg>
  );
}

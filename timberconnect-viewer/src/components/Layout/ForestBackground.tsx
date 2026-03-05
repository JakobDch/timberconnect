export function ForestBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-50 via-gray-50 to-forest-50/30" />

      {/* Forest silhouette at the bottom */}
      <svg
        className="absolute bottom-0 left-0 right-0 w-full h-64 opacity-[0.04]"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        fill="#2d9660"
      >
        {/* Tree group 1 */}
        <path d="M0,320 L0,280 Q30,240 60,280 L60,320 Z" />
        <path d="M50,320 L50,250 Q90,180 130,250 L130,320 Z" />
        <path d="M120,320 L120,260 Q160,200 200,260 L200,320 Z" />

        {/* Tree group 2 */}
        <path d="M180,320 L180,240 Q230,150 280,240 L280,320 Z" />
        <path d="M260,320 L260,270 Q300,220 340,270 L340,320 Z" />
        <path d="M320,320 L320,230 Q380,140 440,230 L440,320 Z" />

        {/* Tree group 3 */}
        <path d="M420,320 L420,260 Q470,190 520,260 L520,320 Z" />
        <path d="M500,320 L500,250 Q550,170 600,250 L600,320 Z" />
        <path d="M580,320 L580,280 Q620,230 660,280 L660,320 Z" />

        {/* Tree group 4 */}
        <path d="M640,320 L640,220 Q700,120 760,220 L760,320 Z" />
        <path d="M740,320 L740,260 Q790,190 840,260 L840,320 Z" />
        <path d="M820,320 L820,240 Q870,160 920,240 L920,320 Z" />

        {/* Tree group 5 */}
        <path d="M900,320 L900,270 Q940,210 980,270 L980,320 Z" />
        <path d="M960,320 L960,230 Q1020,140 1080,230 L1080,320 Z" />
        <path d="M1060,320 L1060,260 Q1100,200 1140,260 L1140,320 Z" />

        {/* Tree group 6 */}
        <path d="M1120,320 L1120,250 Q1170,170 1220,250 L1220,320 Z" />
        <path d="M1200,320 L1200,280 Q1240,230 1280,280 L1280,320 Z" />
        <path d="M1260,320 L1260,240 Q1320,150 1380,240 L1380,320 Z" />
        <path d="M1360,320 L1360,270 Q1400,220 1440,270 L1440,320 Z" />
      </svg>
    </div>
  );
}

export const Chevron = ({ dir = "down", size = 14 }: { dir?: "down" | "up" | "left" | "right"; size?: number }) => {
  const rot = { down: 0, left: 90, up: 180, right: -90 }[dir];
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${rot}deg)`, transition: "transform 150ms" }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
};

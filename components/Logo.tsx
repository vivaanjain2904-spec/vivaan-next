type LogoSize = "sm" | "lg";

type Props = {
  size?: LogoSize;
  showTagline?: boolean;
  className?: string;
};

const SIZES = {
  sm: { box: 30, v: 14, word: "text-[17px]", wordTrack: "tracking-[0.26em]", sub: "text-[7.5px]", subTrack: "tracking-[0.35em]", gap: "gap-3" },
  lg: { box: 62, v: 30, word: "text-[30px]", wordTrack: "tracking-[0.26em]", sub: "text-[9px]",   subTrack: "tracking-[0.55em]", gap: "gap-7" },
} as const;

export default function Logo({ size = "sm", showTagline = true, className = "" }: Props) {
  const s = SIZES[size];
  const stacked = size === "lg";

  const diamond = (
    <div
      className="relative shrink-0"
      style={{ width: s.box, height: s.box, transform: "rotate(45deg)" }}
    >
      <div className="absolute inset-0 border border-vaelor" />
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ transform: "rotate(-45deg)" }}
      >
        <span
          className="font-vaelor-mark text-vaelor leading-none"
          style={{ fontSize: s.v, paddingBottom: 1 }}
        >
          V
        </span>
      </div>
    </div>
  );

  const text = (
    <div className={stacked ? "flex flex-col items-center gap-3" : "flex flex-col gap-0.5"}>
      <span
        className={`font-vaelor-mark text-vaelor uppercase leading-none ${s.word} ${s.wordTrack}`}
        style={{ textIndent: "0.26em" }}
      >
        Vaelor
      </span>
      {showTagline && (
        <span
          className={`font-sans uppercase text-white/55 ${s.sub} ${s.subTrack} hidden sm:inline`}
          style={{ textIndent: stacked ? "0.55em" : "0.35em", whiteSpace: "nowrap" }}
        >
          AI Trading &amp; Investment
        </span>
      )}
    </div>
  );

  return (
    <div className={`flex items-center ${stacked ? "flex-col" : ""} ${s.gap} ${className}`}>
      {diamond}
      {text}
    </div>
  );
}

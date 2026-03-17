export default function StuLogo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Rounded square container */}
      <rect width="32" height="32" rx="8" fill="#111827" />
      {/* Abstract "S" path that doubles as a neural/intelligence motif */}
      <path
        d="M10 12.5C10 10.567 11.567 9 13.5 9H16C18.761 9 21 11.239 21 14C21 15.657 20.157 17.107 18.87 17.937L13.13 21.063C11.843 21.893 11 23.343 11 25V25"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* Dot accents representing intelligence/data points */}
      <circle cx="22" cy="22" r="2" fill="#3B82F6" />
      <circle cx="10" cy="25" r="1.5" fill="#3B82F6" opacity="0.6" />
    </svg>
  );
}

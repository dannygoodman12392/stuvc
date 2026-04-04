export default function StuLogo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background */}
      <rect width="400" height="400" rx="88" fill="#0D0D10" />
      {/* Candidate dots (founders in the field) */}
      <circle cx="142" cy="148" r="9" fill="#FFFFFF" opacity="0.40" />
      <circle cx="200" cy="136" r="9" fill="#FFFFFF" opacity="0.65" />
      <circle cx="258" cy="148" r="9" fill="#FFFFFF" opacity="0.40" />
      <circle cx="162" cy="192" r="9" fill="#FFFFFF" opacity="0.55" />
      <circle cx="238" cy="192" r="9" fill="#FFFFFF" opacity="0.55" />
      {/* Convergence lines */}
      <line x1="142" y1="148" x2="200" y2="264" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.22" />
      <line x1="200" y1="136" x2="200" y2="264" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.32" />
      <line x1="258" y1="148" x2="200" y2="264" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.22" />
      <line x1="162" y1="192" x2="200" y2="264" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.28" />
      <line x1="238" y1="192" x2="200" y2="264" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.28" />
      {/* The chosen one */}
      <circle cx="200" cy="272" r="18" fill="#FFFFFF" />
    </svg>
  );
}

import { Link } from 'react-router-dom';
import StuLogo from '../components/StuLogo';

const features = [
  {
    title: 'Source',
    description:
      'Automated founder discovery from configurable signals. AI-scored, geography-weighted, enriched profiles delivered to your pipeline daily.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="14" cy="14" r="9" stroke="#3B82F6" strokeWidth="2" />
        <line x1="20.5" y1="20.5" x2="27" y2="27" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" />
        <circle cx="14" cy="14" r="3" fill="#3B82F6" opacity="0.3" />
      </svg>
    ),
  },
  {
    title: 'Triage',
    description:
      'Customizable pipeline stages with kanban and list views. Dual-track support for parallel workflows. Move fast on the founders that matter.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="4" width="7" height="24" rx="2" stroke="#3B82F6" strokeWidth="2" />
        <rect x="12.5" y="8" width="7" height="20" rx="2" stroke="#3B82F6" strokeWidth="2" />
        <rect x="22" y="12" width="7" height="16" rx="2" stroke="#3B82F6" strokeWidth="2" />
      </svg>
    ),
  },
  {
    title: 'Assess',
    description:
      'Multi-agent AI evaluation. Upload decks, transcripts, notes. Get structured signal on team, market, and economics in minutes.',
    icon: (
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M6 16L13 23L26 9" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="16" r="13" stroke="#3B82F6" strokeWidth="2" opacity="0.3" />
      </svg>
    ),
  },
];

export default function Landing() {
  return (
    <div className="landing-page">
      <style>{`
        .landing-page {
          --bg: #0D0D10;
          --surface: #16161C;
          --border: #23232D;
          --text-primary: #F0F0F3;
          --text-secondary: #8A8A9B;
          --accent: #3B82F6;
          background: var(--bg);
          color: var(--text-primary);
          min-height: 100vh;
          font-family: 'DM Sans', system-ui, sans-serif;
          overflow-x: hidden;
        }

        .landing-page *::selection {
          background: rgba(59, 130, 246, 0.25);
        }

        /* Fade-in on scroll */
        .landing-fade {
          opacity: 0;
          transform: translateY(24px);
          animation: landingReveal 0.7s ease forwards;
        }
        .landing-fade-d1 { animation-delay: 0.1s; }
        .landing-fade-d2 { animation-delay: 0.22s; }
        .landing-fade-d3 { animation-delay: 0.34s; }
        .landing-fade-d4 { animation-delay: 0.46s; }
        .landing-fade-d5 { animation-delay: 0.58s; }

        @keyframes landingReveal {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Glow behind logo */
        .logo-glow {
          position: relative;
        }
        .logo-glow::after {
          content: '';
          position: absolute;
          inset: -32px;
          background: radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%);
          border-radius: 50%;
          pointer-events: none;
        }

        /* Feature card */
        .feature-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 32px;
          transition: border-color 0.25s ease, transform 0.25s ease;
        }
        .feature-card:hover {
          border-color: rgba(59,130,246,0.3);
          transform: translateY(-2px);
        }

        /* CTA button */
        .landing-cta {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: var(--accent);
          color: #fff;
          font-weight: 600;
          font-size: 15px;
          padding: 12px 28px;
          border-radius: 10px;
          text-decoration: none;
          transition: background 0.2s ease, transform 0.15s ease;
        }
        .landing-cta:hover {
          background: #2563EB;
          transform: translateY(-1px);
        }

        /* Divider line */
        .landing-divider {
          width: 48px;
          height: 1px;
          background: var(--border);
          margin: 0 auto;
        }

        /* Grid line decoration */
        .grid-line {
          position: absolute;
          background: linear-gradient(to bottom, transparent, var(--border), transparent);
          width: 1px;
          height: 100%;
          top: 0;
          opacity: 0.4;
        }
      `}</style>

      {/* --- NAV --- */}
      <nav
        className="landing-fade"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          maxWidth: 1120,
          margin: '0 auto',
          padding: '24px 24px 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StuLogo size={28} />
          <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.01em' }}>Stu</span>
        </div>
        <Link
          to="/login"
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            fontWeight: 500,
            textDecoration: 'none',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={e => (e.target.style.color = 'var(--text-primary)')}
          onMouseLeave={e => (e.target.style.color = 'var(--text-secondary)')}
        >
          Sign in
        </Link>
      </nav>

      {/* --- HERO --- */}
      <section
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '120px 24px 100px',
          textAlign: 'center',
          position: 'relative',
        }}
      >
        <div className="landing-fade landing-fade-d1 logo-glow" style={{ display: 'inline-block', marginBottom: 32 }}>
          <StuLogo size={64} />
        </div>

        <h1
          className="landing-fade landing-fade-d2"
          style={{
            fontSize: 'clamp(40px, 6vw, 64px)',
            fontWeight: 700,
            letterSpacing: '-0.035em',
            lineHeight: 1.05,
            margin: '0 0 20px',
          }}
        >
          Your ground game,
          <br />
          <span style={{ color: 'var(--accent)' }}>systematized.</span>
        </h1>

        <p
          className="landing-fade landing-fade-d3"
          style={{
            fontSize: 'clamp(16px, 2.2vw, 19px)',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            maxWidth: 520,
            margin: '0 auto 40px',
          }}
        >
          Identify top-of-funnel founders before anyone else. Triage them through customizable pipelines. Make decisions faster with structured, AI-driven signal.
        </p>

        <div className="landing-fade landing-fade-d4" style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/signup" className="landing-cta">
            Get started
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10m0 0L9 4m4 4L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <Link
            to="/login"
            className="landing-cta"
            style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.target.style.borderColor = 'rgba(59,130,246,0.3)'; e.target.style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.color = 'var(--text-secondary)'; }}
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* --- FEATURES --- */}
      <section
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: '0 24px 120px',
        }}
      >
        <div className="landing-divider landing-fade landing-fade-d4" style={{ marginBottom: 80 }} />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 24,
          }}
        >
          {features.map((f, i) => (
            <div
              key={f.title}
              className={`feature-card landing-fade landing-fade-d${i + 3}`}
            >
              <div style={{ marginBottom: 20 }}>{f.icon}</div>
              <h3
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                  marginBottom: 10,
                }}
              >
                {f.title}
              </h3>
              <p
                style={{
                  fontSize: 15,
                  lineHeight: 1.65,
                  color: 'var(--text-secondary)',
                  margin: 0,
                }}
              >
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* --- FOR FOUNDERS: Stu Talent --- */}
      <section
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: '0 24px 120px',
        }}
      >
        <div
          className="landing-fade landing-fade-d3"
          style={{
            border: '1px solid var(--border)',
            borderRadius: 20,
            padding: '56px 48px',
            background: 'linear-gradient(180deg, rgba(245, 158, 11, 0.05) 0%, rgba(245, 158, 11, 0.00) 100%)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 8, height: 8, borderRadius: 8, background: '#F59E0B' }} />
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#F59E0B' }}>
              For portfolio founders
            </span>
          </div>
          <h2
            style={{
              fontSize: 40,
              fontWeight: 600,
              letterSpacing: '-0.035em',
              lineHeight: 1.05,
              marginBottom: 16,
              maxWidth: 720,
            }}
          >
            Stu Talent — find your cofounder and first engineers.
          </h2>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.6,
              color: 'var(--text-secondary)',
              maxWidth: 680,
              marginBottom: 28,
            }}
          >
            Daily-sourced technical talent matched to the roles you post. AI-scored on build caliber, leap-readiness, domain fit, and geography — so you spend time talking to the candidates who can actually move the needle, not filtering through noise.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 20,
              marginBottom: 32,
            }}
          >
            {[
              { band: 'Band A', label: 'Cofounders & founding engineers', detail: 'Staff-level ICs from FAANG / elite startups, OSS maintainers, ex-founders. Ready to leap.' },
              { band: 'Band B', label: 'First-5 hires', detail: 'Senior engineers with 4–8 years at strong shops, stack-aligned, ready for earlier stage.' },
              { band: 'Band C', label: 'Domain experts', detail: 'Vertical specialists — ML research, healthtech, fintech — tuned to your problem area.' },
            ].map(b => (
              <div key={b.band}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#F59E0B', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                  {b.band}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{b.label}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{b.detail}</div>
              </div>
            ))}
          </div>
          <Link
            to="/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: '#F59E0B',
              color: '#111',
              fontSize: 14,
              fontWeight: 600,
              padding: '10px 20px',
              borderRadius: 10,
              textDecoration: 'none',
            }}
          >
            Access Stu Talent →
          </Link>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 12 }}>
            Currently invite-only for Superior Studios portfolio companies.
          </div>
        </div>
      </section>

      {/* --- PRICING — hidden until Stripe is configured --- */}

      {/* --- FOOTER --- */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '32px 24px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginBottom: 8,
          }}
        >
          <StuLogo size={18} />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Stu</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>
          {new Date().getFullYear()} Stu. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

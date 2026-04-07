import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import StuLogo from '../components/StuLogo';

export default function PaymentSuccess() {
  const { refreshUser, user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('confirming'); // confirming | confirmed | timeout
  const pollRef = useRef(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    // If already paid (fast webhook), go straight to confirmed
    if (user?.has_paid) {
      setStatus('confirmed');
      return;
    }

    // Poll for payment confirmation (webhook may take a few seconds)
    pollRef.current = setInterval(async () => {
      attemptRef.current++;
      try {
        const u = await refreshUser();
        if (u?.has_paid) {
          setStatus('confirmed');
          clearInterval(pollRef.current);
        }
      } catch {}

      // Timeout after 30 seconds (15 attempts)
      if (attemptRef.current >= 15) {
        setStatus('timeout');
        clearInterval(pollRef.current);
      }
    }, 2000);

    return () => clearInterval(pollRef.current);
  }, []);

  function handleContinue() {
    navigate(user?.onboarding_complete ? '/' : '/onboarding');
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center mb-4">
          <StuLogo size={48} />
        </div>

        {status === 'confirming' && (
          <>
            <div className="flex justify-center mb-4">
              <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Confirming payment...</h1>
            <p className="text-sm text-gray-500">This usually takes just a few seconds.</p>
          </>
        )}

        {status === 'confirmed' && (
          <>
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">You're in.</h1>
            <p className="text-sm text-gray-500 mb-6">Payment confirmed. Lifetime access activated.</p>
            <button onClick={handleContinue} className="btn-primary w-full justify-center">
              {user?.onboarding_complete ? 'Go to dashboard' : 'Set up your sourcing criteria'}
            </button>
          </>
        )}

        {status === 'timeout' && (
          <>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Payment processing</h1>
            <p className="text-sm text-gray-500 mb-6">
              Your payment is being processed. This can take up to a minute.
              Refresh this page or log back in shortly.
            </p>
            <button onClick={() => window.location.reload()} className="btn-primary w-full justify-center">
              Refresh
            </button>
          </>
        )}
      </div>
    </div>
  );
}

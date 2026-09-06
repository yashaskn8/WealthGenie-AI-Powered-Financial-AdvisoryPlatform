import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import './App.css';
import RecommendationDashboard from './RecommendationDashboard';
import Sidebar from './components/Sidebar';
import GenieChat from './components/GenieChat';
import ErrorBoundary from './components/ErrorBoundary';
import * as api from './services/api';
import { useAuth } from './context/AuthContext';
import { assertKnownBackendInstrumentTypes, backendToLocalInstrument } from './utils/instrumentTypeMap';
import { investmentDatabase } from './investmentDatabase';
import { financialProfileKey } from './utils/financialProfile';

// ── Lazy-loaded page components (code-split for faster initial load) ──
const GoalTracker = lazy(() => import('./components/GoalTracker'));
const StepUpPlanner = lazy(() => import('./components/StepUpPlanner'));
const TaxScreen = lazy(() => import('./components/TaxScreen'));
const RebalancerScreen = lazy(() => import('./components/RebalancerScreen'));
const DeepDiveModal = lazy(() => import('./components/DeepDiveModal'));
const ComparisonTableModal = lazy(() => import('./ComparisonTableModal'));
const PostTaxAnalysis = lazy(() => import('./PostTaxAnalysis'));
const HealthScoreScreen = lazy(() => import('./HealthScoreScreen'));
const InsightsScreen = lazy(() => import('./InsightsScreen'));
const HelpTourScreen = lazy(() => import('./HelpTourScreen'));
const AllocationPlanner = lazy(() => import('./components/AllocationPlanner'));
const GoalPlanner = lazy(() => import('./components/GoalPlanner'));
const ProfileEditor = lazy(() => import('./ProfileEditor'));
const ProfilePage = lazy(() => import('./components/ProfilePage'));
const AuthPage = lazy(() => import('./components/AuthPage'));
const LandingPage = lazy(() => import('./LandingPage'));

/* ===== DASHBOARD SHELL - Sidebar + Pages + Chatbot ===== */
const DashboardShell = ({ userProfile, onProfileUpdate }) => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  const [deepDiveInvestment, setDeepDiveInvestment] = useState(null);
  const [showComparisonTable, setShowComparisonTable] = useState(false);
  const [backendRecs, setBackendRecs] = useState(null);
  const [backendFallback, setBackendFallback] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Stable serialized key - changes ONLY when profile data changes, not on every render
  const profileKey = useMemo(() => financialProfileKey(userProfile), [userProfile]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const fetchBackendData = async () => {
      try {
        setIsLoading(true);
        setBackendRecs(null); // Clear stale data immediately
        setBackendFallback(null);
        const activeProfileId = userProfile.profileId;
        if (!activeProfileId) {
          throw new Error('Backend profile creation did not return a profileId.');
        }
        const recResponse = await api.getRecommendations(activeProfileId, { signal: controller.signal });
        if (cancelled) return;
        setBackendRecs({
          ...recResponse,
          profileId: activeProfileId
        });
        setBackendFallback(null);
      } catch (err) {
        if (err?.code === 'REQUEST_ABORTED' || cancelled) return;
        console.error("Failed to fetch backend recommendations:", err);
        setBackendRecs(null);
        setBackendFallback({
          message: 'Authoritative recommendations are temporarily unavailable',
          detail: err?.message || null,
        });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchBackendData();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [profileKey, userProfile, onProfileUpdate]);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      // The local session is cleared by api.logout even when the server is offline.
      navigate('/login', { replace: true });
    }
  };

  // Backend response is the only source of personalized recommendation truth.
  const recommendations = useMemo(() => {
    if (!backendRecs) return [];

    assertKnownBackendInstrumentTypes(backendRecs.instruments?.map(bi => bi.type), 'recommendation merge');

    const totalSavings = Number(userProfile.monthly_savings);

    // Treat backend response as the single source of truth for order, ranking, and allocations.
    // Map over backend instruments directly to preserve their exact order and allocations.
    let merged = (backendRecs.instruments || []).map((bi) => {
      const localId = backendToLocalInstrument(bi.type);
      
      // Look up full display attributes from the investment database catalog
      const dbMatch = investmentDatabase.find(inv => 
        inv.id === (bi.id || localId)
      );

      const backendWeight = Number(bi.allocationWeight);
      if (!Number.isFinite(backendWeight)) throw new Error(`Backend omitted allocation weight for ${bi.id || bi.type}`);

      const allocation = Math.round((backendWeight * totalSavings) / 100) * 100;

      return {
        ...dbMatch,
        // Enriched presentation metadata from the catalog
        id: bi.id || dbMatch?.id || localId,
        name: bi.name || dbMatch?.name || bi.type,
        abbr: dbMatch?.abbr || bi.type,
        color: dbMatch?.color || '#38bdf8',
        desc: dbMatch?.desc || '',
        category: dbMatch?.category || dbMatch?.cat || 'Other',
        cat: dbMatch?.cat || dbMatch?.category || 'Other',
        assetClass: dbMatch?.assetClass || 'Other',
        riskLabel: bi.riskLevel || dbMatch?.riskLabel,
        risk: bi.riskScore ?? dbMatch?.risk,
        lockIn: bi.lockIn ?? dbMatch?.lockIn,
        lock_in_years: bi.lockIn ?? dbMatch?.lockIn,
        goalTags: dbMatch?.goalTags || [],
        
        // Dynamic values from backend response
        monthly_allocation: allocation,
        postTaxReturn: null,
        effectiveYield: bi.effectiveYield,
        returnBasis: bi.returnBasis,
        nominalReturn: bi.nominalReturn,
        rate: bi.nominalReturn,
        expectedReturn: bi.nominalReturn,
        ml_confidence: backendRecs?.confidence_scores?.[bi.type] ?? 0,
        advisory_text: backendRecs.advisory_text,
        _source: 'backend',
      };
    });

    const activeMerged = merged.filter(r => r.monthly_allocation > 0);
    if (activeMerged.length > 0) {
      const allocatedSum = merged.reduce((s, r) => s + r.monthly_allocation, 0);
      const residual = totalSavings - allocatedSum;
      if (residual !== 0) {
        const maxItem = activeMerged.reduce((max, r) => r.monthly_allocation > max.monthly_allocation ? r : max, activeMerged[0]);
        maxItem.monthly_allocation += residual;
      }
    }
    return merged;
  }, [backendRecs, userProfile]);
  const handleLearnMore = (investment) => {
    const normalized = {
      ...investment,
      expected_return_min: investment.expected_return_min ?? investment.returnRange?.min ?? null,
      expected_return_max: investment.expected_return_max ?? investment.returnRange?.max ?? investment.nominalReturn ?? null,
      category: investment.category || investment.cat || 'Unclassified',
      risk_level: investment.risk_level || investment.riskLabel || 'Unknown',
      lock_in_years: investment.lock_in_years ?? investment.lockIn ?? null,
      tax_benefit: investment.tax_benefit ?? (investment.taxType === 'eee' || investment.taxType === 'elss' || investment.taxType === 'nps'),
      tax_section: investment.tax_section || (investment.taxType === 'eee' ? '80C' : investment.taxType === 'elss' ? '80C' : investment.taxType === 'nps' ? '80CCD(1B)' : null),
      tax_free_interest: investment.tax_free_interest ?? (investment.taxType === 'eee'),
      liquidity: investment.liquidity || null,
      description: investment.description || investment.desc || '',
    };
    setDeepDiveInvestment(normalized);
  };

  const handleRebalanceSave = async (updated) => {
    try {
      const profileId = backendRecs?.profileId || userProfile.profileId;

      if (!profileId) {
        throw new Error("Could not build user profile for database update.");
      }

      const weights = {};
      updated.forEach(item => {
        weights[item.id] = Number(item.allocationWeight);
      });

      const response = await api.updateRecommendationWeights(profileId, weights);
      
      setBackendRecs(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          instruments: response.instruments,
        };
      });

      alert('Rebalanced portfolio saved! Projections and dashboard updated in real-time.');
    } catch (err) {
      alert('Failed to save rebalanced portfolio: ' + err.message);
    }
  };

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':
        return (
          <ErrorBoundary>
          <RecommendationDashboard
            userProfile={userProfile}
            recommendations={recommendations}
            isLoading={isLoading}
            explanation={backendRecs?.explanation || null}
            fallbackNotice={backendFallback}
            onDismissFallbackNotice={() => setBackendFallback(null)}
            onRecalculate={() => setActivePage('profile')}
            onLearnMore={handleLearnMore}
            onExploreAll={() => setShowComparisonTable(true)}
            onRebalance={() => setActivePage('rebalancer')}
            onNavigate={setActivePage}
          />
          </ErrorBoundary>
        );
      case 'post-tax':
        return <ErrorBoundary><PostTaxAnalysis profile={userProfile} recommendations={recommendations} /></ErrorBoundary>;
      case 'health':
        return <ErrorBoundary><HealthScoreScreen profile={userProfile} recommendations={recommendations} onNavigate={setActivePage} /></ErrorBoundary>;
      case 'goals':
        return <ErrorBoundary><GoalTracker profile={userProfile} recommendations={recommendations} /></ErrorBoundary>;
      case 'goal-planner':
        return <ErrorBoundary><GoalPlanner profile={userProfile} /></ErrorBoundary>;
      case 'rebalancer':
        return (
          <ErrorBoundary>
          <RebalancerScreen
            key={recommendations.map(item => `${item.id}:${item.allocationWeight}`).join('|')}
            profile={userProfile}
            recommendations={recommendations}
            onSave={handleRebalanceSave}
          />
          </ErrorBoundary>
        );
      case 'sip-planner':
        return <ErrorBoundary><StepUpPlanner key={`${userProfile.profileId}:${userProfile.version}`} profile={userProfile} /></ErrorBoundary>;
      case 'tax-optimizer':
        return <ErrorBoundary><TaxScreen profile={userProfile} onLearnMore={handleLearnMore} /></ErrorBoundary>;
      case 'compare':
        return (
          <ErrorBoundary>
          <div style={{ padding: '40px 28px', maxWidth: 1200, margin: '0 auto', position: 'relative' }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: '#38bdf8', marginBottom: 8, opacity: 0.9 }}>
                INVESTMENT EXPLORER
              </div>
              <h1 className="page-title" style={{ fontSize: '2.2rem', marginBottom: 6 }}>
                Compare <span style={{
                  background: 'linear-gradient(135deg, #38bdf8, #a78bfa)',
                  WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent'
                }}>Investments</span>
              </h1>
              <p className="page-subtitle" style={{ marginBottom: 0, fontSize: '0.95rem' }}>
                Compare {investmentDatabase.length} available investments side by side
              </p>
            </div>
            <ComparisonTableModal
              isOpen={true}
              onClose={() => setActivePage('dashboard')}
              allInvestments={investmentDatabase}
              embedded={true}
              profile={userProfile}
            />
          </div>
          </ErrorBoundary>
        );
      case 'allocation':
        return <ErrorBoundary><AllocationPlanner profile={userProfile} recommendations={recommendations} /></ErrorBoundary>;
      case 'profile':
        return (
          <ErrorBoundary>
            <ProfileEditor
              userProfile={userProfile}
              onProfileUpdate={onProfileUpdate}
            />
          </ErrorBoundary>
        );
      case 'insights':
        return <ErrorBoundary><InsightsScreen profile={userProfile} recommendations={recommendations} /></ErrorBoundary>;
      case 'help':
        return <ErrorBoundary><HelpTourScreen /></ErrorBoundary>;
      default:
        return (
          <div style={{ padding: '80px 20px', maxWidth: 600, margin: '0 auto', color: '#fff', textAlign: 'center' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '3px', textTransform: 'uppercase', color: '#8b5cf6', marginBottom: 16, opacity: 0.8 }}>
              IN DEVELOPMENT
            </div>
            <h1 className="page-title" style={{ fontSize: '2.4rem', marginBottom: 12 }}>
              Coming <span style={{
                background: 'linear-gradient(135deg, #8b5cf6, #38bdf8)',
                WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent'
              }}>Soon</span>
            </h1>
            <p className="page-subtitle" style={{ fontSize: '1rem' }}>This feature is currently under development and will be available shortly.</p>
          </div>
        );
    }
  };

  const lazyFallback = (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      color: 'var(--text-muted)',
      gap: 16
    }}>
      <div style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        border: '3px solid rgba(56, 189, 248, 0.1)',
        borderTopColor: '#38bdf8',
        animation: 'spin 1s linear infinite'
      }} />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.05em' }}>Loading Intelligence...</div>
    </div>
  );

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={setActivePage} onLogout={handleLogout} />
      <main className="app-main">
        <Suspense fallback={lazyFallback}>
          {renderPage()}
        </Suspense>
      </main>

      {/* Deep Dive Modal */}
      <Suspense fallback={null}>
        <DeepDiveModal
          isOpen={!!deepDiveInvestment}
          onClose={() => setDeepDiveInvestment(null)}
          investment={deepDiveInvestment}
          onSelectInvestment={setDeepDiveInvestment}
          allRecommendations={recommendations}
          horizon={userProfile.investment_horizon_years}
          userProfile={userProfile}
        />
      </Suspense>

      {/* Comparison Table Modal */}
      {showComparisonTable && activePage !== 'compare' && (
        <Suspense fallback={null}>
          <ComparisonTableModal
            isOpen={true}
            onClose={() => setShowComparisonTable(false)}
            allInvestments={investmentDatabase}
            profile={userProfile}
          />
        </Suspense>
      )}

      {/* Genie Chatbot FAB */}
      <GenieChat profile={userProfile} recommendations={recommendations} onNavigate={setActivePage} />
    </div>
  );
};

function AuthGuard({ children }) {
  const { isAuthenticated, isInitializing } = useAuth();
  if (isInitializing) {
    return <div role="status" aria-live="polite" className="route-loading">Restoring secure session...</div>;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<AuthPage />} />
        <Route 
          path="/profile" 
          element={
            <AuthGuard>
              <ProfilePage>
                <DashboardShell />
              </ProfilePage>
            </AuthGuard>
          } 
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}


export default App;

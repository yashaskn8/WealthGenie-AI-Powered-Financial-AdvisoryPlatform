import { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import './App.css';
import RecommendationDashboard from './RecommendationDashboard';
import Sidebar from './components/Sidebar';
import GenieChat from './components/GenieChat';
import ErrorBoundary from './components/ErrorBoundary';
import * as api from './services/api';
import { useAuth } from './context/AuthContext';
import { assertKnownBackendInstrumentTypes } from './utils/instrumentTypeMap';
import { investmentDatabase } from './investmentDatabase';
import { financialProfileKey } from './utils/financialProfile';
import { assertBackendRecommendationInstrument } from './utils/recommendationPresentation';
import { fromSearchParams, toSearchParams, resolveNavigation, NAV_PAGES } from './utils/navigationMap';

// ── Lazy-loaded page components (code-split for faster initial load) ──
const WhereToInvestScreen = lazy(() => import('./components/WhereToInvestScreen'));
const TaxesHub = lazy(() => import('./components/TaxesHub'));
const ProgressHub = lazy(() => import('./components/ProgressHub'));
const AdvancedHub = lazy(() => import('./components/AdvancedHub'));
const AllocationPlanner = lazy(() => import('./components/AllocationPlanner'));
const ProfileEditor = lazy(() => import('./ProfileEditor'));
const HelpTourScreen = lazy(() => import('./HelpTourScreen'));
const DeepDiveModal = lazy(() => import('./components/DeepDiveModal'));
const ComparisonTableModal = lazy(() => import('./ComparisonTableModal'));
const ProfilePage = lazy(() => import('./components/ProfilePage'));
const AuthPage = lazy(() => import('./components/AuthPage'));
const LandingPage = lazy(() => import('./LandingPage'));

// ── Bounded retry helper for deferred advisory generation ──
// eslint-disable-next-line react-refresh/only-export-components
export const ADVISORY_RETRY_DELAYS_MS = [1000, 1500];

// eslint-disable-next-line react-refresh/only-export-components
export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Request cancelled.');
      err.code = 'REQUEST_ABORTED';
      return reject(err);
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Request cancelled.');
      err.code = 'REQUEST_ABORTED';
      reject(err);
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

// eslint-disable-next-line react-refresh/only-export-components
export async function fetchDeferredAdvisoryWithBoundedRetry(
  fetchFn,
  recommendationId,
  { signal, retryDelays = ADVISORY_RETRY_DELAYS_MS, onConflict } = {}
) {
  let attempt = 0;
  while (true) {
    try {
      return await fetchFn(recommendationId, { signal });
    } catch (err) {
      if (err?.code === 'REQUEST_ABORTED' || err?.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      if (err?.status === 409) {
        if (typeof onConflict === 'function') {
          onConflict();
        }
        if (attempt < retryDelays.length) {
          const delayMs = retryDelays[attempt];
          attempt += 1;
          await wait(delayMs, signal);
          continue;
        }
        // Exceeded bounded retries while status is still GENERATING.
        // Return synthetic response with GENERATING status so UI does NOT mark FAILED.
        return {
          advisory_text: null,
          advisory_explanation: { status: 'GENERATING' },
        };
      }
      // Genuine terminal error
      throw err;
    }
  }
}

/* ===== DASHBOARD SHELL - Sidebar + Pages + Chatbot ===== */
const DashboardShell = ({ userProfile, onProfileUpdate }) => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // URL search params are the SINGLE source of truth for navigation
  const { page: activePage, tab: activeTab, needsReplace } = useMemo(
    () => fromSearchParams(searchParams),
    [searchParams]
  );

  // Normalize initial or malformed URLs with replace: true to prevent history pollution
  useEffect(() => {
    if (needsReplace) {
      setSearchParams(toSearchParams({ page: activePage, tab: activeTab }), { replace: true });
    }
  }, [needsReplace, activePage, activeTab, setSearchParams]);

  const navigateTo = (target, options = { replace: false }) => {
    const resolved = resolveNavigation(target);
    setSearchParams(toSearchParams(resolved), options);
  };

  const [deepDiveInvestment, setDeepDiveInvestment] = useState(null);
  const [deepDiveInitialTab, setDeepDiveInitialTab] = useState('Overview');
  const [showComparisonTable, setShowComparisonTable] = useState(false);
  const [backendRecs, setBackendRecs] = useState(null);
  const [backendFallback, setBackendFallback] = useState(null);
  const [isRecommendationLoading, setIsRecommendationLoading] = useState(true);
  const [isAdvisoryLoading, setIsAdvisoryLoading] = useState(false);

  // Stable serialized key - changes ONLY when profile data changes, not on every render
  const profileKey = useMemo(() => financialProfileKey(userProfile), [userProfile]);
  const profileId = userProfile.profileId;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const fetchBackendData = async () => {
      try {
        setIsRecommendationLoading(true);
        setIsAdvisoryLoading(false);
        setBackendRecs(null); // Clear stale data immediately
        setBackendFallback(null);
        const activeProfileId = profileId;
        if (!activeProfileId) {
          throw new Error('Backend profile creation did not return a profileId.');
        }
        const recResponse = await api.getRecommendations(activeProfileId, { signal: controller.signal });
        if (cancelled) return;
        setBackendRecs({
          ...recResponse,
          profileId: activeProfileId,
        });
        setBackendFallback(null);
        setIsRecommendationLoading(false);

        // Two-phase fetch: deferred advisory generation
        if (recResponse?.recommendationId && (recResponse.advisory_explanation?.status === 'PENDING' || !recResponse.advisory_text)) {
          setIsAdvisoryLoading(true);
          try {
            const advResponse = await fetchDeferredAdvisoryWithBoundedRetry(
              api.fetchAdvisory,
              recResponse.recommendationId,
              {
                signal: controller.signal,
                onConflict: () => {
                  if (!cancelled) {
                    setBackendRecs(prev => {
                      if (!prev || prev.recommendationId !== recResponse.recommendationId) return prev;
                      return {
                        ...prev,
                        advisory_explanation: {
                          ...(prev.advisory_explanation || {}),
                          status: 'GENERATING',
                        },
                      };
                    });
                  }
                },
              }
            );
            if (!cancelled && advResponse) {
              setBackendRecs(prev => {
                if (!prev || prev.recommendationId !== recResponse.recommendationId) return prev;
                return {
                  ...prev,
                  advisory_text: advResponse.advisory_text ?? prev.advisory_text ?? null,
                  advisory_explanation: advResponse.advisory_explanation || { status: 'GENERATING' },
                };
              });
            }
          } catch (advErr) {
            if (!cancelled && advErr?.code !== 'REQUEST_ABORTED' && advErr?.name !== 'AbortError') {
              if (advErr?.status === 409) {
                // 409 Conflict: Another request is generating the advisory.
                // Keep advisory state as GENERATING, never mark FAILED on 409.
                setBackendRecs(prev => {
                  if (!prev || prev.recommendationId !== recResponse.recommendationId) return prev;
                  return {
                    ...prev,
                    advisory_explanation: {
                      ...(prev.advisory_explanation || {}),
                      status: 'GENERATING',
                    },
                  };
                });
              } else {
                console.warn('Deferred advisory generation failed:', advErr);
                setBackendRecs(prev => {
                  if (!prev || prev.recommendationId !== recResponse.recommendationId) return prev;
                  return {
                    ...prev,
                    advisory_explanation: {
                      ...(prev.advisory_explanation || {}),
                      status: 'FAILED',
                      error: advErr.message,
                    },
                  };
                });
              }
            }
          } finally {
            if (!cancelled) setIsAdvisoryLoading(false);
          }
        }
      } catch (err) {
        if (err?.code === 'REQUEST_ABORTED' || cancelled) return;
        console.error("Failed to fetch backend recommendations:", err);
        setBackendRecs(null);
        setBackendFallback({
          message: 'Authoritative recommendations are temporarily unavailable',
          detail: err?.message || null,
        });
        setIsRecommendationLoading(false);
      }
    };
    fetchBackendData();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [profileId, profileKey]);

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

    // Treat backend response as the single source of truth for order, ranking, and allocations.
    // Map over backend instruments directly to preserve their exact order and allocations.
    const merged = (backendRecs.instruments || []).map((bi) => {
      assertBackendRecommendationInstrument(bi);

      // Look up full display attributes from the investment database catalog
      const dbMatch = investmentDatabase.find(inv => 
        inv.id === bi.id
      );
      if (!dbMatch) throw new TypeError(`Frontend catalog is missing authoritative instrument ${bi.id}`);

      const backendWeight = Number(bi.allocationWeight);
      if (!Number.isFinite(backendWeight) || backendWeight < 0 || backendWeight > 1) {
        throw new Error(`Backend returned an invalid allocation weight for ${bi.id || bi.type}`);
      }

      const allocation = Number(backendRecs.dashboard_projection?.instrument_monthly_allocations?.[bi.id]);
      if (!Number.isFinite(allocation) || allocation <= 0) {
        throw new Error(`Backend did not return a valid monthly allocation for ${bi.id || bi.type}`);
      }

      return {
        ...dbMatch,
        // Enriched presentation metadata from the catalog
        id: bi.id,
        name: bi.name,
        type: bi.type,
        abbr: dbMatch?.abbr || bi.type,
        color: dbMatch?.color || '#38bdf8',
        desc: dbMatch?.desc || '',
        category: dbMatch?.category || dbMatch?.cat || 'Other',
        cat: dbMatch?.cat || dbMatch?.category || 'Other',
        assetClass: dbMatch?.assetClass || 'Other',
        riskLabel: bi.riskLevel,
        risk: bi.riskScore,
        lockIn: bi.lockIn,
        lock_in_years: bi.lockIn,
        goalTags: [...bi.tags],
        
        // Dynamic values from backend response
        monthly_allocation: allocation,
        postTaxReturn: null,
        effectiveYield: bi.effectiveYield,
        returnBasis: bi.returnBasis,
        nominalReturn: bi.nominalReturn,
        rate: bi.nominalReturn,
        expectedReturn: bi.nominalReturn,
        allocationWeight: backendWeight,
        allocation_pct: Number(bi.allocation_pct),
        score: Number(bi.score),
        scoreFactors: { ...bi.scoreFactors },
        ml_confidence: backendRecs.confidence_scores?.[bi.type] ?? null,
        advisory_text: backendRecs.advisory_text,
        _source: 'backend',
      };
    });

    const weightTotal = merged.reduce((sum, item) => sum + item.allocationWeight, 0);
    if (merged.length > 0 && Math.abs(weightTotal - 1) > 0.001) {
      throw new Error(`Backend allocation weights must total 1; received ${weightTotal}`);
    }
    return merged;
  }, [backendRecs]);
  const handleLearnMore = (investment, initialTab = 'Overview') => {
    setDeepDiveInitialTab(initialTab || 'Overview');
    setDeepDiveInvestment(investment);
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
          portfolio_return_assumption: response.portfolio_return_assumption,
          return_data_class: response.return_data_class,
          return_assumption_version: response.return_assumption_version,
          return_assumption_source: response.return_assumption_source,
          observed_market_fact: response.observed_market_fact,
          provider_forecast: response.provider_forecast,
          asset_class_allocation: response.asset_class_allocation,
          dashboard_projection: response.dashboard_projection,
        };
      });

      alert('Rebalanced portfolio saved! Projections and dashboard updated in real-time.');
    } catch (err) {
      alert('Failed to save rebalanced portfolio: ' + err.message);
    }
  };

  const renderPage = () => {
    switch (activePage) {
      case NAV_PAGES.HOME:
        return (
          <ErrorBoundary>
            <RecommendationDashboard
              userProfile={userProfile}
              recommendations={recommendations}
              recommendationMeta={backendRecs}
              isLoading={isRecommendationLoading}
              isAdvisoryLoading={isAdvisoryLoading}
              explanation={backendRecs?.explanation || null}
              fallbackNotice={backendFallback}
              onDismissFallbackNotice={() => setBackendFallback(null)}
              onRecalculate={() => navigateTo(NAV_PAGES.ACCOUNT)}
              onLearnMore={handleLearnMore}
              onExploreAll={() => setShowComparisonTable(true)}
              onRebalance={() => navigateTo('rebalancer')}
              onNavigate={navigateTo}
            />
          </ErrorBoundary>
        );
      case NAV_PAGES.PLAN:
        return (
          <ErrorBoundary>
            <AllocationPlanner
              profile={userProfile}
              recommendations={recommendations}
              recommendationMeta={backendRecs}
            />
          </ErrorBoundary>
        );
      case NAV_PAGES.INVESTMENTS:
        return (
          <ErrorBoundary>
            <WhereToInvestScreen
              recommendations={recommendations}
              userProfile={userProfile}
              onLearnMore={handleLearnMore}
              onSelectInvestment={setDeepDiveInvestment}
            />
          </ErrorBoundary>
        );
      case NAV_PAGES.TAXES:
        return (
          <ErrorBoundary>
            <TaxesHub
              activeTab={activeTab}
              onTabChange={(newTab) => navigateTo({ page: NAV_PAGES.TAXES, tab: newTab })}
              profile={userProfile}
              recommendations={recommendations}
              onLearnMore={handleLearnMore}
            />
          </ErrorBoundary>
        );
      case NAV_PAGES.PROGRESS:
        return (
          <ErrorBoundary>
            <ProgressHub
              activeTab={activeTab}
              onTabChange={(newTab) => navigateTo({ page: NAV_PAGES.PROGRESS, tab: newTab })}
              profile={userProfile}
              recommendations={recommendations}
              onNavigate={navigateTo}
              onSaveRebalance={handleRebalanceSave}
            />
          </ErrorBoundary>
        );
      case NAV_PAGES.ADVANCED:
        return (
          <ErrorBoundary>
            <AdvancedHub
              activeTab={activeTab}
              onTabChange={(newTab) => navigateTo({ page: NAV_PAGES.ADVANCED, tab: newTab })}
              profile={userProfile}
              recommendations={recommendations}
              recommendationMeta={backendRecs}
              onNavigateHome={() => navigateTo(NAV_PAGES.HOME)}
            />
          </ErrorBoundary>
        );
      case NAV_PAGES.ACCOUNT:
        return (
          <ErrorBoundary>
            <ProfileEditor
              userProfile={userProfile}
              onProfileUpdate={onProfileUpdate}
            />
          </ErrorBoundary>
        );
      case NAV_PAGES.HELP:
        return (
          <ErrorBoundary>
            <HelpTourScreen />
          </ErrorBoundary>
        );
      default:
        return null;
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
      <Sidebar activePage={activePage} onNavigate={navigateTo} onLogout={handleLogout} />
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
          userProfile={userProfile}
          allRecommendations={recommendations}
          horizon={userProfile.investment_horizon_years}
          initialTab={deepDiveInitialTab}
        />
      </Suspense>

      {/* Comparison Table Modal */}
      {showComparisonTable && activePage !== NAV_PAGES.ADVANCED && (
        <Suspense fallback={null}>
          <ComparisonTableModal
            isOpen={true}
            onClose={() => setShowComparisonTable(false)}
            allInvestments={investmentDatabase}
            profile={userProfile}
            recommendations={recommendations}
          />
        </Suspense>
      )}

      {/* Genie Chatbot FAB */}
      <GenieChat profile={userProfile} recommendations={recommendations} onNavigate={navigateTo} />
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

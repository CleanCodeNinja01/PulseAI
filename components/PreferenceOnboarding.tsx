"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AI_CATEGORIES,
  CADENCE_OPTIONS,
  DEFAULT_PREFERENCES,
  DeliveryCadence,
  UserPreferences,
} from "@/lib/preferences";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const STORAGE_KEY = "pulseai.preferences.v1";
const THEME_STORAGE_KEY = "pulseai.theme.v1";
const PRESET_DELIVERY_TIMES = ["08:00", "12:00", "18:00"];
const CUSTOM_DELIVERY_TIMES = Array.from(
  { length: 24 },
  (_, hour) => `${hour.toString().padStart(2, "0")}:00`,
);

type Theme = "light" | "dark";
type AuthMode = "signup" | "signin";
type RouteStep = "auth" | "interests" | "schedule" | "complete" | "dashboard";
type SignupAvailability = {
  email_exists: boolean;
  full_name_exists: boolean;
};
type UserPreferenceRow = {
  categories: string[] | null;
  cadence: DeliveryCadence | null;
  delivery_time: string | null;
  timezone: string | null;
};

function getStoredPreferences(): UserPreferences {
  const storedPreferences = window.localStorage.getItem(STORAGE_KEY);

  if (!storedPreferences) {
    return {
      ...DEFAULT_PREFERENCES,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    };
  }

  try {
    return {
      ...DEFAULT_PREFERENCES,
      ...JSON.parse(storedPreferences),
    };
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return DEFAULT_PREFERENCES;
  }
}

function saveStoredPreferences(preferences: UserPreferences) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function getStoredTheme(): Theme {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getInitials(fullName: string, email: string) {
  const source = fullName.trim() || email.trim();

  if (!source) {
    return "AI";
  }

  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getDeliveryTime(value: string | null) {
  return value ? value.slice(0, 5) : DEFAULT_PREFERENCES.deliveryTime;
}

function getAuthRedirectPath() {
  if (typeof window === "undefined") {
    return "/onboarding/interests";
  }

  const redirectPath = new URLSearchParams(window.location.search).get("redirect");

  return redirectPath?.startsWith("/") ? redirectPath : "/onboarding/interests";
}

function useStoredPreferenceState() {
  const [preferences, setPreferences] =
    useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setPreferences(getStoredPreferences());
      setIsReady(true);
    });
  }, []);

  const updatePreference = useCallback(function updatePreference<
    Key extends keyof UserPreferences,
  >(key: Key, value: UserPreferences[Key]) {
    setPreferences((current) => {
      const nextPreferences = {
        ...current,
        [key]: value,
      };

      saveStoredPreferences(nextPreferences);
      return nextPreferences;
    });
  }, []);

  const mergePreferences = useCallback(function mergePreferences(
    nextPreferences: Partial<UserPreferences>,
  ) {
    setPreferences((current) => {
      const mergedPreferences = {
        ...current,
        ...nextPreferences,
      };

      saveStoredPreferences(mergedPreferences);
      return mergedPreferences;
    });
  }, []);

  return {
    isReady,
    mergePreferences,
    preferences,
    setPreferences,
    updatePreference,
  };
}

function useSelectedPreferenceLabels(preferences: UserPreferences) {
  const selectedCategoryLabels = useMemo(
    () =>
      AI_CATEGORIES.filter((category) =>
        preferences.categories.includes(category.id),
      ).map((category) => category.label),
    [preferences.categories],
  );
  const selectedCadence = CADENCE_OPTIONS.find(
    (option) => option.id === preferences.cadence,
  );

  return {
    selectedCadence,
    selectedCategoryLabels,
  };
}

function LoadingCard({ label = "Loading PulseAI..." }: { label?: string }) {
  return (
    <section className="pulseai-page">
      <div className="onboarding-card onboarding-card-loading">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" role="img">
            <path d="M4 17h5l3-8 5 16 4-10h7" />
          </svg>
        </div>
        <span className="loading-copy">{label}</span>
      </div>
    </section>
  );
}

function Progress({ step }: { step: RouteStep }) {
  const currentStep =
    step === "auth" ? 0 : step === "interests" ? 1 : step === "schedule" ? 2 : 3;

  return (
    <div className="progress" aria-label="Onboarding progress">
      {[0, 1, 2].map((stepIndex) => (
        <span
          className={`step-dot ${
            stepIndex < currentStep
              ? "done"
              : stepIndex === currentStep
                ? "active"
                : ""
          }`}
          key={stepIndex}
        />
      ))}
      <span className="step-label">
        {currentStep <= 2 ? `Step ${currentStep + 1} of 3` : "Complete"}
      </span>
    </div>
  );
}

function OnboardingShell({
  children,
  step,
}: {
  children: ReactNode;
  step: RouteStep;
}) {
  const [theme, setTheme] = useState<Theme>("light");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setTheme(getStoredTheme());
      setIsMounted(true);
    });
  }, []);

  function toggleTheme() {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === "light" ? "dark" : "light";

      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      return nextTheme;
    });
  }

  if (!isMounted) {
    return <LoadingCard />;
  }

  return (
    <section className="pulseai-page" data-theme={theme}>
      <h1 className="sr-only">
        PulseAI onboarding - route-based sign-up flow with email, category
        selection, and schedule picker
      </h1>

      <div className="onboarding-card">
        <header className="onboarding-header">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" role="img">
              <path d="M4 17h5l3-8 5 16 4-10h7" />
            </svg>
          </div>
          <span className="brand-name">PulseAI</span>

          <button
            aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            className="theme-toggle"
            onClick={toggleTheme}
            type="button"
          >
            {theme === "light" ? "Dark" : "Light"}
          </button>

          <Progress step={step} />
        </header>

        {children}
      </div>
    </section>
  );
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      if (!isSupabaseConfigured || !supabase) {
        router.replace("/auth");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace(`/auth?redirect=${encodeURIComponent(pathname)}`);
        return;
      }

      setIsCheckingAuth(false);
    }

    void checkAuth();
  }, [pathname, router]);

  if (isCheckingAuth) {
    return <LoadingCard label="Checking your session..." />;
  }

  return children;
}

export function AuthPage() {
  const router = useRouter();
  const { mergePreferences, preferences, updatePreference } =
    useStoredPreferenceState();
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [password, setPassword] = useState("");
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const canContinueAccount =
    preferences.fullName.trim().length > 0 &&
    preferences.email.trim().length > 0 &&
    password.length >= 8;

  async function createAccount() {
    if (!canContinueAccount || isCreatingAccount) {
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setAuthError(
        "Supabase is not configured in this browser bundle. Check .env.local for the project URL and public key, then stop and restart npm run dev.",
      );
      return;
    }

    setIsCreatingAccount(true);
    setAuthError(null);

    const email = preferences.email.trim();
    const fullName = preferences.fullName.trim();

    const { data: availability, error: availabilityError } = await supabase
      .rpc("check_signup_availability", {
        candidate_email: email,
        candidate_full_name: fullName,
      })
      .single();

    if (availabilityError) {
      setIsCreatingAccount(false);
      setAuthError(`Could not check account availability: ${availabilityError.message}`);
      return;
    }

    const signupAvailability = availability as SignupAvailability;

    if (signupAvailability.email_exists) {
      setIsCreatingAccount(false);
      setAuthError("An account already exists for this email address.");
      return;
    }

    if (signupAvailability.full_name_exists) {
      setIsCreatingAccount(false);
      setAuthError("This full name is already taken.");
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    setIsCreatingAccount(false);

    if (error) {
      setAuthError(error.message);
      return;
    }

    if (!data.session) {
      setAuthError(
        "Account created. Confirm your email, then sign in to continue setup.",
      );
      setAuthMode("signin");
      return;
    }

    saveStoredPreferences(preferences);
    router.push("/onboarding/interests");
  }

  async function signIn() {
    if (isSigningIn) {
      return;
    }

    const email = preferences.email.trim();

    if (!email || !password) {
      setAuthError("Enter your email and password to sign in.");
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setAuthError(
        "Supabase is not configured in this browser bundle. Check .env.local for the project URL and public key, then stop and restart npm run dev.",
      );
      return;
    }

    setIsSigningIn(true);
    setAuthError(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setIsSigningIn(false);
      setAuthError(error.message);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("id,email,full_name")
      .eq("id", data.user.id)
      .maybeSingle();

    setIsSigningIn(false);

    if (profileError) {
      setAuthError(`Signed in, but user lookup failed: ${profileError.message}`);
      return;
    }

    if (!profile) {
      setAuthError(
        "Signed in, but no users table row was found. Run supabase/schema.sql, then try again.",
      );
      return;
    }

    mergePreferences({
      email: profile.email ?? email,
      fullName: profile.full_name ?? preferences.fullName,
    });
    router.push(getAuthRedirectPath());
  }

  function switchAuthMode(nextMode: AuthMode) {
    setAuthMode(nextMode);
    setAuthError(null);
  }

  function submitAccountForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (authMode === "signup") {
      void createAccount();
      return;
    }

    void signIn();
  }

  return (
    <OnboardingShell step="auth">
      <form className="screen active" onSubmit={submitAccountForm}>
        <div>
          <h2>{authMode === "signup" ? "Create your account" : "Sign in"}</h2>
          <p className="sub">
            {authMode === "signup"
              ? "Get personalized AI advancements delivered to your inbox."
              : "Enter your email and password to continue setup."}
          </p>
        </div>

        <div className="field-stack">
          {authMode === "signup" ? (
            <div className="field">
              <label htmlFor="fullName">Full name</label>
              <input
                id="fullName"
                onChange={(event) =>
                  updatePreference("fullName", event.target.value)
                }
                placeholder="Ada Lovelace"
                type="text"
                value={preferences.fullName}
              />
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              onChange={(event) => updatePreference("email", event.target.value)}
              placeholder="ada@example.com"
              type="email"
              value={preferences.email}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Min. 8 characters"
              type="password"
              value={password}
            />
          </div>
        </div>

        {authError ? <p className="auth-message error">{authError}</p> : null}

        <div className="actions">
          <span className="signin-note">
            {authMode === "signup"
              ? "Already have an account?"
              : "Need an account?"}{" "}
            <button
              onClick={() =>
                switchAuthMode(authMode === "signup" ? "signin" : "signup")
              }
              type="button"
            >
              {authMode === "signup" ? "Sign in" : "Create one"}
            </button>
          </span>
          <button
            className="btn-primary"
            disabled={
              authMode === "signup"
                ? !canContinueAccount || isCreatingAccount || isSigningIn
                : isCreatingAccount || isSigningIn
            }
            type="submit"
          >
            {authMode === "signup"
              ? isCreatingAccount
                ? "Creating..."
                : "Continue"
              : isSigningIn
                ? "Signing in..."
                : "Sign in"}{" "}
            <span aria-hidden="true">-&gt;</span>
          </button>
        </div>
      </form>
    </OnboardingShell>
  );
}

export function InterestsPage() {
  const router = useRouter();
  const { isReady, preferences, setPreferences } = useStoredPreferenceState();
  const [authError, setAuthError] = useState<string | null>(null);
  const canContinueCategories = preferences.categories.length > 0;

  function toggleCategory(categoryId: string) {
    setPreferences((current) => {
      const isSelected = current.categories.includes(categoryId);
      const categories = isSelected
        ? current.categories.filter((id) => id !== categoryId)
        : [...current.categories, categoryId];
      const nextPreferences = {
        ...current,
        categories,
      };

      saveStoredPreferences(nextPreferences);
      return nextPreferences;
    });
  }

  if (!isReady) {
    return <LoadingCard />;
  }

  return (
    <ProtectedRoute>
      <OnboardingShell step="interests">
        <div className="screen active">
          <div>
            <h2>Choose your interests</h2>
            <p className="sub">
              Select the AI topics you want to follow. You can change these
              anytime.
            </p>
          </div>

          <div className="cat-grid">
            {AI_CATEGORIES.map((category) => {
              const isSelected = preferences.categories.includes(category.id);

              return (
                <button
                  aria-pressed={isSelected}
                  className={`cat-card ${isSelected ? "selected" : ""}`}
                  key={category.id}
                  onClick={() => toggleCategory(category.id)}
                  type="button"
                >
                  <span className="cat-icon" aria-hidden="true">
                    {category.icon}
                  </span>
                  <span>
                    <span className="cat-name">
                      {category.label}
                      {category.isHot ? <span className="badge">Hot</span> : null}
                    </span>
                    <span className="cat-count">{category.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <button
            className="btn-ghost dashboard-shortcut"
            onClick={() => router.push("/dashboard")}
            type="button"
          >
            View dashboard
          </button>

          {authError ? <p className="auth-message error">{authError}</p> : null}

          <div className="actions">
            <span className="sel-count">
              <span>{preferences.categories.length}</span> selected
            </span>
            <div className="button-pair">
              <Link className="btn-ghost" href="/auth">
                Back
              </Link>
              <button
                className="btn-primary"
                disabled={!canContinueCategories}
                onClick={() => {
                  if (!canContinueCategories) {
                    setAuthError("Choose at least one topic to continue.");
                    return;
                  }

                  saveStoredPreferences(preferences);
                  router.push("/onboarding/schedule");
                }}
                type="button"
              >
                Continue <span aria-hidden="true">-&gt;</span>
              </button>
            </div>
          </div>
        </div>
      </OnboardingShell>
    </ProtectedRoute>
  );
}

export function SchedulePage() {
  const router = useRouter();
  const { isReady, preferences, updatePreference } = useStoredPreferenceState();
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const isCustomDeliveryTime = !PRESET_DELIVERY_TIMES.includes(
    preferences.deliveryTime,
  );

  async function finishSetup() {
    if (preferences.categories.length === 0) {
      router.push("/onboarding/interests");
      return;
    }

    if (!isSupabaseConfigured || !supabase) {
      setAuthError(
        "Supabase is not configured in this browser bundle. Check .env.local for the project URL and public key, then stop and restart npm run dev.",
      );
      return;
    }

    setIsSavingPreferences(true);
    setAuthError(null);
    saveStoredPreferences(preferences);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setIsSavingPreferences(false);
      router.push("/auth?redirect=/onboarding/schedule");
      return;
    }

    const { error } = await supabase.from("user_preferences").upsert({
      user_id: user.id,
      categories: preferences.categories,
      cadence: preferences.cadence,
      delivery_time: preferences.deliveryTime,
      timezone: preferences.timezone,
    });

    setIsSavingPreferences(false);

    if (error) {
      setAuthError(`Preference sync failed: ${error.message}`);
      return;
    }

    router.push("/onboarding/complete");
  }

  if (!isReady) {
    return <LoadingCard />;
  }

  return (
    <ProtectedRoute>
      <OnboardingShell step="schedule">
        <div className="screen active">
          <div>
            <h2>When should we send it?</h2>
            <p className="sub">
              Pick your digest cadence. You can change or pause anytime.
            </p>
          </div>

          <div className="sched-grid">
            {CADENCE_OPTIONS.map((option) => {
              const isSelected = preferences.cadence === option.id;

              return (
                <button
                  aria-pressed={isSelected}
                  className={`sched-card ${isSelected ? "selected" : ""}`}
                  key={option.id}
                  onClick={() => updatePreference("cadence", option.id)}
                  type="button"
                >
                  <span className="sched-title">{option.label}</span>
                  <span className="sched-desc">{option.description}</span>
                </button>
              );
            })}
          </div>

          <div className="delivery-time-grid">
            <div className="field">
              <label htmlFor="deliveryTime">Preferred delivery time</label>
              <select
                id="deliveryTime"
                onChange={(event) => {
                  const nextTime = event.target.value;

                  updatePreference(
                    "deliveryTime",
                    nextTime === "custom" ? "09:00" : nextTime,
                  );
                }}
                value={isCustomDeliveryTime ? "custom" : preferences.deliveryTime}
              >
                <option value="08:00">8:00 AM - morning briefing</option>
                <option value="12:00">12:00 PM - lunch digest</option>
                <option value="18:00">6:00 PM - evening wrap-up</option>
                <option value="custom">Custom time</option>
              </select>
            </div>

            {isCustomDeliveryTime ? (
              <div className="field">
                <label htmlFor="customDeliveryTime">Custom time</label>
                <select
                  id="customDeliveryTime"
                  onChange={(event) =>
                    updatePreference("deliveryTime", event.target.value)
                  }
                  value={preferences.deliveryTime}
                >
                  {CUSTOM_DELIVERY_TIMES.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          {authError ? <p className="auth-message error">{authError}</p> : null}

          <div className="actions">
            <Link className="btn-ghost" href="/onboarding/interests">
              Back
            </Link>
            <button
              className="btn-primary"
              disabled={isSavingPreferences}
              onClick={finishSetup}
              type="button"
            >
              {isSavingPreferences ? "Saving..." : "Finish setup"}{" "}
              <span aria-hidden="true">OK</span>
            </button>
          </div>
        </div>
      </OnboardingShell>
    </ProtectedRoute>
  );
}

export function CompletePage() {
  const { isReady, preferences } = useStoredPreferenceState();
  const { selectedCadence, selectedCategoryLabels } =
    useSelectedPreferenceLabels(preferences);

  if (!isReady) {
    return <LoadingCard />;
  }

  return (
    <ProtectedRoute>
      <OnboardingShell step="complete">
        <div className="screen active success-screen">
          <div className="success-icon" aria-hidden="true">
            {getInitials(preferences.fullName, preferences.email)}
          </div>
          <div>
            <h2>You&apos;re all set!</h2>
            <p className="sub">
              Your first PulseAI digest is on its way. Here&apos;s what
              we&apos;ve set up.
            </p>
          </div>

          <div className="confirm-list">
            <div className="confirm-row">
              <span className="ck">Delivery</span>
              <span className="cv">
                {selectedCadence?.label ?? "Daily"} digest at{" "}
                {preferences.deliveryTime}
              </span>
            </div>
            <div className="confirm-row">
              <span className="ck">Topics</span>
              <span className="cv pills">
                {selectedCategoryLabels.map((category) => (
                  <span className="pill" key={category}>
                    {category}
                  </span>
                ))}
              </span>
            </div>
          </div>

          <Link className="btn-primary dashboard-button" href="/dashboard">
            Go to dashboard -&gt;
          </Link>
        </div>
      </OnboardingShell>
    </ProtectedRoute>
  );
}

export function DashboardPage() {
  const { isReady, mergePreferences, preferences } = useStoredPreferenceState();
  const { selectedCadence, selectedCategoryLabels } =
    useSelectedPreferenceLabels(preferences);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDashboard() {
      if (!isSupabaseConfigured || !supabase) {
        setAuthError(
          "Supabase is not configured in this browser bundle. Check .env.local for the project URL and public key, then stop and restart npm run dev.",
        );
        setIsLoadingDashboard(false);
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setAuthError("Sign in before opening your dashboard.");
        setIsLoadingDashboard(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("users")
        .select("email,full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        setAuthError(`User lookup failed: ${profileError.message}`);
        setIsLoadingDashboard(false);
        return;
      }

      const { data: storedPreferences, error: preferencesError } = await supabase
        .from("user_preferences")
        .select("categories,cadence,delivery_time,timezone")
        .eq("user_id", user.id)
        .maybeSingle();

      if (preferencesError) {
        setAuthError(`Preference lookup failed: ${preferencesError.message}`);
        setIsLoadingDashboard(false);
        return;
      }

      const savedPreferences = storedPreferences as UserPreferenceRow | null;

      const nextPreferences: Partial<UserPreferences> = {};

      if (profile?.email || user.email) {
        nextPreferences.email = profile?.email ?? user.email ?? "";
      }

      if (profile?.full_name) {
        nextPreferences.fullName = profile.full_name;
      }

      if (savedPreferences?.categories) {
        nextPreferences.categories = savedPreferences.categories;
      }

      if (savedPreferences?.cadence) {
        nextPreferences.cadence = savedPreferences.cadence;
      }

      if (savedPreferences?.delivery_time) {
        nextPreferences.deliveryTime = getDeliveryTime(
          savedPreferences.delivery_time,
        );
      }

      if (savedPreferences?.timezone) {
        nextPreferences.timezone = savedPreferences.timezone;
      }

      mergePreferences(nextPreferences);
      setIsLoadingDashboard(false);
    }

    if (isReady) {
      void loadDashboard();
    }
  }, [isReady, mergePreferences]);

  if (!isReady || isLoadingDashboard) {
    return <LoadingCard label="Loading dashboard..." />;
  }

  return (
    <ProtectedRoute>
      <OnboardingShell step="dashboard">
        <div className="screen active dashboard-screen">
          <div>
            <h2>Dashboard</h2>
            <p className="sub">
              Your PulseAI account and digest preferences are ready.
            </p>
          </div>

          {authError ? <p className="auth-message error">{authError}</p> : null}

          <div className="dashboard-section">
            <h3>Account</h3>
            <div className="confirm-list">
              <div className="confirm-row">
                <span className="ck">Name</span>
                <span className="cv">{preferences.fullName || "Not provided"}</span>
              </div>
              <div className="confirm-row">
                <span className="ck">Email</span>
                <span className="cv">{preferences.email || "Not provided"}</span>
              </div>
            </div>
          </div>

          <div className="dashboard-section">
            <h3>Preferences</h3>
            <div className="confirm-list">
              <div className="confirm-row">
                <span className="ck">Topics</span>
                <span className="cv pills">
                  {selectedCategoryLabels.map((category) => (
                    <span className="pill" key={category}>
                      {category}
                    </span>
                  ))}
                </span>
              </div>
              <div className="confirm-row">
                <span className="ck">Cadence</span>
                <span className="cv">{selectedCadence?.label ?? "Daily"}</span>
              </div>
              <div className="confirm-row">
                <span className="ck">Delivery time</span>
                <span className="cv">{preferences.deliveryTime}</span>
              </div>
              <div className="confirm-row">
                <span className="ck">Timezone</span>
                <span className="cv">{preferences.timezone}</span>
              </div>
            </div>
          </div>

          <Link className="btn-ghost dashboard-back-button" href="/onboarding/complete">
            Back
          </Link>
        </div>
      </OnboardingShell>
    </ProtectedRoute>
  );
}

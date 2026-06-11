"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AI_CATEGORIES,
  CADENCE_OPTIONS,
  DEFAULT_PREFERENCES,
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
type SignupAvailability = {
  email_exists: boolean;
  full_name_exists: boolean;
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

export function PreferenceOnboarding() {
  const [preferences, setPreferences] =
    useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [currentStep, setCurrentStep] = useState(0);
  const [authMode, setAuthMode] = useState<AuthMode>("signup");
  const [password, setPassword] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [isMounted, setIsMounted] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setPreferences(getStoredPreferences());
      setTheme(getStoredTheme());
      setIsMounted(true);
    });
  }, []);

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
  const canContinueAccount =
    preferences.fullName.trim().length > 0 &&
    preferences.email.trim().length > 0 &&
    password.length >= 8;
  const canContinueCategories = preferences.categories.length > 0;
  const isCustomDeliveryTime = !PRESET_DELIVERY_TIMES.includes(
    preferences.deliveryTime,
  );

  function toggleCategory(categoryId: string) {
    setPreferences((current) => {
      const isSelected = current.categories.includes(categoryId);
      const categories = isSelected
        ? current.categories.filter((id) => id !== categoryId)
        : [...current.categories, categoryId];

      return {
        ...current,
        categories,
      };
    });
  }

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

    if (error) {
      setIsCreatingAccount(false);
      setAuthError(error.message);
      return;
    }

    if (data.user) {
      setUserId(data.user.id);
    }

    setIsCreatingAccount(false);
    setCurrentStep(1);
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

    setUserId(profile.id);
    setPreferences((current) => ({
      ...current,
      email: profile.email ?? email,
      fullName: profile.full_name ?? current.fullName,
    }));
    setCurrentStep(1);
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

  function updatePreference<Key extends keyof UserPreferences>(
    key: Key,
    value: UserPreferences[Key],
  ) {
    setPreferences((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function finishSetup() {
    if (preferences.categories.length === 0) {
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const activeUserId = user?.id ?? userId;

    if (!activeUserId) {
      setIsSavingPreferences(false);
      setAuthError(
        "Account created, but preferences need an authenticated session. Confirm your email, then sign in before finishing setup.",
      );
      return;
    }

    const { error } = await supabase.from("user_preferences").upsert({
      user_id: activeUserId,
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

    setCurrentStep(3);
  }

  function toggleTheme() {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === "light" ? "dark" : "light";

      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      return nextTheme;
    });
  }

  return (
    <section className="pulseai-page" data-theme={theme}>
      <h1 className="sr-only">
        PulseAI onboarding - three-step sign-up flow with email, category
        selection, and schedule picker
      </h1>

      {!isMounted ? (
        <div className="onboarding-card onboarding-card-loading">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" role="img">
              <path d="M4 17h5l3-8 5 16 4-10h7" />
            </svg>
          </div>
          <span className="loading-copy">Loading PulseAI...</span>
        </div>
      ) : null}

      {isMounted ? (
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

          <div className="progress" aria-label="Onboarding progress">
            {[0, 1, 2].map((step) => (
              <span
                className={`step-dot ${
                  step < currentStep ? "done" : step === currentStep ? "active" : ""
                }`}
                key={step}
              />
            ))}
            <span className="step-label">
              {currentStep <= 2 ? `Step ${currentStep + 1} of 3` : "Complete"}
            </span>
          </div>
        </header>

        <form
          className={`screen ${currentStep === 0 ? "active" : ""}`}
          onSubmit={submitAccountForm}
        >
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
              onClick={authMode === "signup" ? createAccount : signIn}
              type="button"
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

        <div className={`screen ${currentStep === 1 ? "active" : ""}`}>
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

          <div className="actions">
            <span className="sel-count">
              <span>{preferences.categories.length}</span> selected
            </span>
            <div className="button-pair">
              <button
                className="btn-ghost"
                onClick={() => setCurrentStep(0)}
                type="button"
              >
                Back
              </button>
              <button
                className="btn-primary"
                disabled={!canContinueCategories}
                onClick={() => setCurrentStep(2)}
                type="button"
              >
                Continue <span aria-hidden="true">-&gt;</span>
              </button>
            </div>
          </div>
        </div>

        <div className={`screen ${currentStep === 2 ? "active" : ""}`}>
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
            <button
              className="btn-ghost"
              onClick={() => setCurrentStep(1)}
              type="button"
            >
              Back
            </button>
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

        <div
          className={`screen success-screen ${currentStep === 3 ? "active" : ""}`}
        >
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

          <button
            className="btn-primary dashboard-button"
            onClick={() => setCurrentStep(4)}
            type="button"
          >
            Go to dashboard -&gt;
          </button>
        </div>

        <div
          className={`screen dashboard-screen ${currentStep === 4 ? "active" : ""}`}
        >
          <div>
            <h2>Dashboard</h2>
            <p className="sub">
              Your PulseAI account and digest preferences are ready.
            </p>
          </div>

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

          <button
            className="btn-ghost dashboard-back-button"
            onClick={() => setCurrentStep(3)}
            type="button"
          >
            Back
          </button>
        </div>
      </div>
      ) : null}
    </section>
  );
}

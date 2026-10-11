import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import {
  Eye,
  EyeOff,
  MessageSquare,
  Sparkles,
  Code2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getErrorMessage } from "../../utils/data";
import btn from "../../styles/buttons.module.css";
import styles from "./Auth.module.css";

import ui from "../../styles/pageStates.module.css";
import avatar1 from "../../assets/avatar1.png";
import avatar2 from "../../assets/avatar2.png";
import avatar3 from "../../assets/avatar3.png";


const REGISTER_SUCCESS_DELAY_MS = 1500;

export default function Auth() {
  const {
    isAuthenticated,
    isCheckingSession,
    sessionExpired,
    login,
    register,
  } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();


  const redirectTo = location.state?.from?.pathname || "/dashboard";

  const [mode, setMode] = useState("login");
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });

  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);


  const switchTimer = useRef(null);

  useEffect(() => () => clearTimeout(switchTimer.current), []);


  if (isCheckingSession) {
    return null;
  }

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  function update(e) {
    const { name, value } = e.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));


    setErrors((current) => ({
      ...current,
      [name]: "",
    }));

    setError("");
  }

  function validateRegister() {
    const newErrors = {};

    if (!form.firstName.trim()) {
      newErrors.firstName = "First name is required.";
    } else if (form.firstName.trim().length < 3) {
      newErrors.firstName = "First name must be at least 3 characters.";
    }

    if (!form.lastName.trim()) {
      newErrors.lastName = "Last name is required.";
    } else if (form.lastName.trim().length < 3) {
      newErrors.lastName = "Last name must be at least 3 characters.";
    }

    if (!form.email.trim()) {
      newErrors.email = "Email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      newErrors.email = "Enter a valid email address.";
    }

    if (!form.password) {
      newErrors.password = "Password is required.";
    } else if (form.password.length < 6) {
      newErrors.password = "Password must be at least 6 characters.";
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  }

  function validateLogin() {
    const newErrors = {};

    if (!form.email.trim()) {
      newErrors.email = "Email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      newErrors.email = "Enter a valid email address.";
    }

    if (!form.password) {
      newErrors.password = "Password is required.";
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  }

  function getFirstValidationError() {
    const order =
      mode === "register"
        ? ["firstName", "lastName", "email", "password"]
        : ["email", "password"];

    for (const field of order) {
      if (errors[field]) {
        return errors[field];
      }
    }

    return "";
  }

  async function submit(e) {
    e.preventDefault();

    setError("");

    const isValid = mode === "register" ? validateRegister() : validateLogin();

    if (!isValid) {
      return;
    }

    setSubmitting(true);

    try {
      if (mode === "register") {
        await register({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          password: form.password,
        });


        setSuccess("Registration successful! Please log in.");

        setForm({
          firstName: "",
          lastName: "",
          email: form.email.trim(),
          password: "",
        });

        setErrors({});

        switchTimer.current = setTimeout(() => {
          setMode("login");
          setSuccess("");
        }, REGISTER_SUCCESS_DELAY_MS);
      } else {
        await login({
          email: form.email.trim(),
          password: form.password,
        });

        navigate(redirectTo, { replace: true });
      }
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          mode === "login" ? "Login failed." : "Registration failed.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode() {
    clearTimeout(switchTimer.current);

    setMode((currentMode) => (currentMode === "login" ? "register" : "login"));

    setError("");
    setSuccess("");
    setErrors({});
    setShowPassword(false);

    setForm({
      firstName: "",
      lastName: "",
      email: form.email,
      password: "",
    });
  }

  const validationMessage = getFirstValidationError();

  return (
    <div className={styles.authPage}>
      {/* LEFT SIDE */}
      <section className={styles.authBrandPanel}>
        <div className={styles.authBrandInner}>
          <div className={styles.authBrand}>
            <span className={`${ui.brandMark} ${ui.inverse}`}>
              <MessageSquare size={23} />
            </span>

            <div>
              <h2>Evangadi Forum</h2>
              <p>Learn together. Ask with context.</p>
            </div>
          </div>

          <p className={styles.authIntro}>
            Sign in to post technical questions, follow threads, and search the
            forum with both keyword and AI similarity modes, built for Evangadi
            coursework and peer review.
          </p>

          <div className={styles.authBenefit}>
            <span>
              <Sparkles size={20} />
            </span>

            <div>
              <strong>Visible reasoning</strong>

              <p>
                Threads stay readable: markdown, code blocks, and replies build
                a mini knowledge base your cohort can revisit before exams.
              </p>
            </div>
          </div>

          <div className={styles.authBenefit}>
            <span>
              <Code2 size={20} />
            </span>

            <div>
              <strong>Low-friction workflow</strong>

              <p>
                One layout for asking, answering, and scanning search results,
                so you spend energy on the problem, not on hunting controls.
              </p>
            </div>
          </div>

          <div className={styles.authCohortRow}>
            <div className={styles.authAvatars}>
              <img src={avatar1} alt="" />
              <img src={avatar2} alt="" />
              <img src={avatar3} alt="" />
            </div>

            <div className={styles.authCohort}>
              Evangadi cohorts · weekly stand-ups · office-hour style help
            </div>
          </div>
        </div>
      </section>

      {/* RIGHT SIDE */}
      <section className={styles.authFormPanel}>
        {/* Keyed on `mode`, so switching between sign-in and register crossfades
            the card instead of swapping the fields in place. */}
        <AnimatePresence mode="wait" initial={false}>
          <Motion.div
            key={mode}
            className={styles.authCard}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <form onSubmit={submit} noValidate>
              <h1>
                {mode === "login"
                  ? "Sign in to your account"
                  : "Create an account"}
              </h1>

              <p>
                {mode === "login"
                  ? "Enter your email address and password to continue."
                  : "Create your learner account to join the forum."}
              </p>

              {/* REGISTER NAME FIELDS */}
              {mode === "register" && (
                <div className={styles.formRow}>
                  <div className={ui.formField}>
                    <label htmlFor="firstName">First Name</label>

                    <div
                      className={`${styles.authInputWrap} ${
                        errors.firstName ? `${styles.hasError}` : ""
                      }`}
                    >
                      <input
                        id="firstName"
                        name="firstName"
                        autoComplete="given-name"
                        value={form.firstName}
                        onChange={update}
                        placeholder="Enter your first name"
                      />

                      {errors.firstName && (
                        <span className={styles.authErrorIcon}>
                          <AlertCircle size={17} />
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={ui.formField}>
                    <label htmlFor="lastName">Last Name</label>

                    <div
                      className={`${styles.authInputWrap} ${
                        errors.lastName ? `${styles.hasError}` : ""
                      }`}
                    >
                      <input
                        id="lastName"
                        name="lastName"
                        autoComplete="family-name"
                        value={form.lastName}
                        onChange={update}
                        placeholder="Enter your last name"
                      />

                      {errors.lastName && (
                        <span className={styles.authErrorIcon}>
                          <AlertCircle size={17} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* EMAIL */}
              <div className={ui.formField}>
                <label htmlFor="email">Email Address</label>

                <div
                  className={`${styles.authInputWrap} ${errors.email ? `${styles.hasError}` : ""}`}
                >
                  <input
                    id="email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={update}
                    placeholder="Enter your email address"
                  />

                  {errors.email && (
                    <span className={styles.authErrorIcon}>
                      <AlertCircle size={17} />
                    </span>
                  )}
                </div>
              </div>

              {/* PASSWORD */}
              <div className={ui.formField}>
                <label htmlFor="password">Password</label>

                <div
                  className={`${styles.passwordWrap} ${errors.password ? `${styles.hasError}` : ""}`}
                >
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    value={form.password}
                    onChange={update}
                    placeholder="••••••••"
                  />

                  {errors.password && (
                    <span className={styles.passwordErrorIcon}>
                      <AlertCircle size={17} />
                    </span>
                  )}

                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* SESSION ENDED WHILE THEY WERE USING THE APP */}
              {sessionExpired && mode === "login" && !error && (
                <div className={styles.authSessionNotice}>
                  <AlertCircle size={18} />
                  <span>
                    Your session ended. Sign in again to pick up where you left
                    off.
                  </span>
                </div>
              )}

              {/* VALIDATION ERROR */}
              {validationMessage && (
                <div className={styles.authValidationAlert} role="alert">
                  <AlertCircle size={18} />
                  <span>{validationMessage}</span>
                </div>
              )}

              {/* BACKEND ERROR */}
              {error && (
                <div className={styles.authValidationAlert} role="alert">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}

              {/* REGISTRATION CONFIRMED — shown until the form flips to sign-in */}
              <AnimatePresence>
                {success && (
                  <Motion.div
                    className={styles.authSuccessAlert}
                    role="status"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <CheckCircle2 size={18} />
                    <span>{success}</span>
                  </Motion.div>
                )}
              </AnimatePresence>

              <button
                className={`${btn.primaryButton} ${styles.authSubmit}`}
                disabled={submitting || Boolean(success)}
              >
                {submitting
                  ? "Please wait..."
                  : mode === "login"
                    ? "Sign In  →"
                    : "Create Account  →"}
              </button>

              <div className={styles.authDivider}>
                <span>Additional options</span>
              </div>

              <p className={styles.authSwitch}>
                {mode === "login"
                  ? "Don't have an account? "
                  : "Already have an account? "}

                <button type="button" onClick={switchMode}>
                  {mode === "login" ? "Create an account" : "Sign in"}
                </button>
              </p>
            </form>
          </Motion.div>
        </AnimatePresence>
      </section>
    </div>
  );
}

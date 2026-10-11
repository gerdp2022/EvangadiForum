import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Plus, Rows3, Search, X } from "lucide-react";
import { Link } from "react-router-dom";

import { getAllQuestions, semanticSearch } from "../../api/question.api";

import QuestionCard from "../../components/QuestionCard/QuestionCard";
import LoadingSpinner from "../../components/LoadingSpinner/LoadingSpinner";
import ErrorMessage from "../../components/ErrorMessage/ErrorMessage";
import EmptyState from "../../components/EmptyState/EmptyState";

import { getErrorMessage } from "../../utils/data";
import { useAuth } from "../../context/AuthContext";

import btn from "../../styles/buttons.module.css";
import styles from "./Dashboard.module.css";
import ui from "../../styles/pageStates.module.css";

const SEMANTIC_MIN_LENGTH = 5;
const SEARCH_DEBOUNCE_MS = 400;

export default function Dashboard() {
  const { user } = useAuth();

  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState("keyword");
  const [activeSearch, setActiveSearch] = useState(null);
  const [note, setNote] = useState("");


  const requestIdRef = useRef(0);

  const lastSearchKeyRef = useRef("");

  const loadAllQuestions = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    lastSearchKeyRef.current = "";

    setLoading(true);
    setError("");

    try {
      const response = await getAllQuestions();

      if (requestId !== requestIdRef.current) return;

      setQuestions(response.data);
      setActiveSearch(null);
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(getErrorMessage(err, "Could not load questions."));
      }
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadQuestions() {
      const requestId = ++requestIdRef.current;
      // A live search may start before the initial feed arrives.
      const isStale = () => cancelled || requestId !== requestIdRef.current;

      try {
        const response = await getAllQuestions();

        if (!isStale()) {
          setQuestions(response.data);
        }
      } catch (err) {
        if (!isStale()) {
          setError(getErrorMessage(err, "Could not load questions."));
        }
      } finally {
        if (!isStale()) {
          setLoading(false);
        }
      }
    }

    loadQuestions();

    return () => {
      cancelled = true;
    };
  }, []);

  async function executeSearch(rawValue, searchMode) {
    const value = rawValue.trim();

    setNote("");

    if (!value) {
      await loadAllQuestions();
      return;
    }

    if (searchMode === "semantic" && value.length < SEMANTIC_MIN_LENGTH) {
      // Drop any in-flight search so it cannot land under this note.
      requestIdRef.current += 1;
      lastSearchKeyRef.current = `${searchMode}:${value}`;
      setLoading(false);
      setNote(
        `Semantic search needs at least ${SEMANTIC_MIN_LENGTH} characters.`,
      );

      return;
    }

    const requestId = ++requestIdRef.current;
    lastSearchKeyRef.current = `${searchMode}:${value}`;

    setLoading(true);
    setError("");

    try {
      let response;

      if (searchMode === "semantic") {
        response = await semanticSearch({
          query: value,
          k: 10,
        });
      } else {
        response = await getAllQuestions({
          search: value,
        });
      }

      if (requestId !== requestIdRef.current) return;

      setQuestions(response.data);

      setActiveSearch({
        term: value,
        mode: searchMode,
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;

      setError(
        getErrorMessage(
          err,
          searchMode === "semantic"
            ? "Semantic search failed."
            : "Could not search questions.",
        ),
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  // Live search: run once the user pauses typing (or switches mode).
  useEffect(() => {
    const timer = setTimeout(() => {
      const value = searchQuery.trim();
      const key = value ? `${searchMode}:${value}` : "";

      if (key === lastSearchKeyRef.current) return;

      executeSearch(searchQuery, searchMode);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // executeSearch only reads refs, state setters and loadAllQuestions
    // (stable), so re-running on its identity would only reset the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchMode]);

  // Enter / the Search button still run immediately.
  async function runSearch(event) {
    event.preventDefault();

    await executeSearch(searchQuery, searchMode);
  }

  function clearSearch() {
    setSearchQuery("");
    setNote("");
    loadAllQuestions();
  }

  function switchMode(mode) {
    setSearchMode(mode);
    setNote("");
  }

  const stats = useMemo(() => {
    const totalReplies = questions.reduce(
      (total, question) => total + Number(question.answerCount),
      0,
    );

    const unanswered = questions.filter(
      (question) => Number(question.answerCount) === 0,
    ).length;

    const yours = questions.filter(
      (question) => String(question.author.id) === String(user.id),
    ).length;

    return {
      questions: questions.length,
      replies: totalReplies,
      unanswered,
      yours,
    };
  }, [questions, user.id]);

  return (
    <div className={styles.dashboardPage}>
      <section className={styles.welcomeCard}>
        <span className={ui.eyebrow}>Forum home</span>

        <h1>Good to see you, {user.firstName}</h1>

        <p>
          Start a topic, revisit your own threads, or skim the live feed. Search
          the feed below by keyword or by meaning.
        </p>

        <div className={styles.quickGrid}>
          <Link to="/questions/ask">
            <Plus />

            <div>
              <strong>New question</strong>

              <small>Share context, errors, and what you already tried</small>
            </div>
          </Link>

          <Link to="/my-questions">
            <Rows3 />

            <div>
              <strong>Your topics</strong>

              <small>Filtered list of threads you authored</small>
            </div>
          </Link>

          <Link to="/rag-documents">
            <BookOpen />

            <div>
              <strong>Knowledge base</strong>

              <small>
                Course library, uploads, and retrieval-backed context
              </small>
            </div>
          </Link>
        </div>

        <div className={styles.welcomeDivider} />

        <p className={styles.tinyNote}>
          Figures below describe the newest threads in this feed (up to 100 from
          the API).
        </p>

        <div className={`${styles.statsGrid} ${styles.compact}`}>
          <div>
            <small>Questions</small>
            <strong>{stats.questions}</strong>
          </div>

          <div>
            <small>Replies</small>
            <strong>{stats.replies}</strong>
          </div>

          <div>
            <small>Unanswered</small>
            <strong>{stats.unanswered}</strong>
          </div>

          <div>
            <small>Yours</small>
            <strong>{stats.yours}</strong>
          </div>
        </div>
      </section>

      <section className={styles.feedCard}>
        <div className={styles.feedHead}>
          <div>
            <h2>Discussion feed</h2>

            <p>Your threads use a slim left accent in this list.</p>
          </div>

          <span className={styles.orangePill}>
            {activeSearch
              ? `${
                  activeSearch.mode === "semantic" ? "Semantic" : "Keyword"
                } results`
              : "Newest threads"}
          </span>
        </div>

        <form className={styles.feedSearch} onSubmit={runSearch}>
          <div className={styles.feedSearchInput}>
            <Search size={18} />

            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={
                searchMode === "semantic"
                  ? "Describe the problem, e.g. why does my express middleware not run?"
                  : "Search titles and content by keyword"
              }
              aria-label="Search questions"
            />
          </div>

          <div
            className={styles.feedModeToggle}
            role="group"
            aria-label="Search mode"
          >
            <button
              type="button"
              className={searchMode === "keyword" ? styles.active : ""}
              onClick={() => switchMode("keyword")}
              aria-pressed={searchMode === "keyword"}
            >
              Keyword
            </button>

            <button
              type="button"
              className={searchMode === "semantic" ? styles.active : ""}
              onClick={() => switchMode("semantic")}
              aria-pressed={searchMode === "semantic"}
            >
              Semantic
            </button>
          </div>

          <button className={btn.primaryButton} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>

          {activeSearch && (
            <button
              type="button"
              className={btn.textButton}
              onClick={clearSearch}
            >
              <X size={15} />
              Clear
            </button>
          )}

          {note && <p className={styles.feedSearchNote}>{note}</p>}

          {activeSearch && !note && (
            <p className={styles.feedSearchNote}>
              Showing {activeSearch.mode} matches for “{activeSearch.term}”.
            </p>
          )}
        </form>

        {loading && <LoadingSpinner />}

        {error && <ErrorMessage message={error} />}

        {!loading && !error && questions.length === 0 && (
          <EmptyState
            title={activeSearch ? "No matches found" : "No questions yet"}
            message={
              activeSearch
                ? "Try different wording, or switch between keyword and semantic search."
                : "Be the first person to ask a question."
            }
          />
        )}

        <div className={ui.threadList}>
          {questions.map((question) => (
            <QuestionCard
              key={question.questionHash}
              question={question}
              yours={String(question.author.id) === String(user.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

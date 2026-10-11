import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PlusCircle } from "lucide-react";
import { getAllQuestions } from "../../api/question.api";
import QuestionCard from "../../components/QuestionCard/QuestionCard";
import LoadingSpinner from "../../components/LoadingSpinner/LoadingSpinner";
import ErrorMessage from "../../components/ErrorMessage/ErrorMessage";
import EmptyState from "../../components/EmptyState/EmptyState";
import { getErrorMessage } from "../../utils/data";
import btn from "../../styles/buttons.module.css";
import ui from "../../styles/pageStates.module.css";

export default function Questions() {

  const [searchParams] = useSearchParams();
 
  const search = searchParams.get("search") || "";

  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");

      try {
        const data = await getAllQuestions(search ? { search } : {});
        setQuestions(data.data);
      } catch (err) {
        setError(getErrorMessage(err, "Could not load questions."));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [search]);

  return (
    <div className={ui.pageStack}>
      <section className={ui.pageHeading}>
        <div>
          <span className={ui.eyebrow}>Community</span>
          <h1>{search ? `Search: ${search}` : "All Questions"}</h1>
          <p>Browse questions posted by forum members.</p>
        </div>

        <Link to="/questions/ask" className={btn.primaryButton}>
          <PlusCircle size={18} />
          Ask Question
        </Link>
      </section>

      {loading && <LoadingSpinner />}
      {error && <ErrorMessage message={error} />}

      {!loading && !error && questions.length === 0 && (
        <EmptyState
          title="No questions found"
          message={
            search
              ? "Try a different keyword or use semantic search."
              : "No questions have been posted yet."
          }
        />
      )}

      <div className={ui.questionList}>
        {questions.map((question) => (
          <QuestionCard key={question.questionHash} question={question} />
        ))}
      </div>
    </div>
  );
}

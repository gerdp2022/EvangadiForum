import {
  ArrowRight,
  Database,
  FileText,
  Layers,
  Library,
  MessageSquare,
  PenSquare,
  Search,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import btn from "../../styles/buttons.module.css";
import styles from "./Landing.module.css";
import ui from "../../styles/pageStates.module.css";


const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.3 },
  transition: { duration: 0.4, ease: "easeOut" },
};

export default function Landing() {
  const { isAuthenticated } = useAuth();
  return (
    <div className={styles.landingPage}>
      <header className={styles.landingNav}>
        <Link to="/" className={styles.landingBrand}>
          <span className={ui.brandMark}>
            <MessageSquare size={19} />
          </span>
          <span>
            <strong>Evangadi Forum</strong>
            <small>Learn together. Ask with context.</small>
          </span>
        </Link>
        <nav>
          <a href="#overview">Overview</a>
          <a href="#rag">Course RAG</a>
          <a href="#how">How it works</a>
        </nav>
        <div className={btn.landingActions}>
          {isAuthenticated ? (
            <Link to="/dashboard" className={btn.primaryButton}>
              Open forum <ArrowRight size={17} />
            </Link>
          ) : (
            <>
              <Link to="/auth">Sign in</Link>
              <Link to="/auth" className={btn.primaryButton}>
                Create account
              </Link>
            </>
          )}
        </div>
      </header>
      <main>
        {/* HERO */}
        <section className={styles.landingHero} id="overview">
          <div>
            {/* the sparkle icon in this chip is drawn by the CSS */}
            <span className={styles.heroChip}>
              Keyword search + embedding similarity
            </span>
            <h1>
              A calm place for <em>technical Q&amp;A</em>
            </h1>
            <p>
              Post with enough context for peers to help in one pass. Search the
              archive by phrase or by meaning, keep your threads in one place,
              and ground questions in <strong>course documents</strong> with
              retrieval-augmented generation (RAG) so answers cite the right
              syllabus, readings, and handouts.
            </p>
            <div className={styles.heroActions}>
              <Link
                to={isAuthenticated ? "/dashboard" : "/auth"}
                className={btn.primaryButton}
              >
                {isAuthenticated ? "Open forum" : "Get started"}{" "}
                <ArrowRight size={17} />
              </Link>
              <a href="#how" className={btn.secondaryButton}>
                See how it works
              </a>
            </div>
          </div>
          <aside className={styles.glanceCard}>
            <span>At a glance</span>
            {/* the check-circle bullets are drawn by the CSS */}
            <ul>
              <li>Markdown threads and replies</li>
              <li>Semantic search on question embeddings</li>
              <li>Optional AI draft tips when you ask or answer</li>
              <li>
                <strong>Course RAG:</strong> upload or sync course materials,
                retrieve the best chunks for each question, and answer with
                citations, not generic web text.
              </li>
            </ul>
          </aside>
        </section>

        {/* COURSE RAG */}
        <section className={styles.landingSoftSection} id="rag">
          <div className={styles.landingSectionCopy}>
            <span className={ui.eyebrow}>Retrieval-augmented generation</span>
            <h2>How course RAG works with the forum</h2>
            <p>
              Forum search already helps you find{" "}
              <strong>similar questions</strong> from peers. RAG goes further:
              it finds <strong>evidence inside your own documents</strong>{" "}
              (readings, rubrics, lab specs) and surfaces those snippets when
              you write or review an answer. That keeps AI assistance on-policy
              for Evangadi-style courses and reduces &ldquo;confident but
              wrong&rdquo; generic answers.
            </p>
          </div>
          <div className={`${styles.landingCardGrid} ${styles.three}`}>
            <Motion.article {...reveal}>
              <FileText />
              <h3>Ingest &amp; chunk</h3>
              <p>
                Upload or connect course files; split them into overlapping
                chunks and store embeddings the same way we already embed
                questions, so retrieval stays fast and auditable.
              </p>
            </Motion.article>
            <Motion.article {...reveal}>
              <Database />
              <h3>Retrieve at question time</h3>
              <p>
                When you open Ask or run a search, the app pulls the
                top-matching chunks from the cohort corpus (with scores), not
                just other threads. That is ideal for &ldquo;what does the
                syllabus say about&hellip;&rdquo; style questions.
              </p>
            </Motion.article>
            <Motion.article {...reveal}>
              <Sparkles />
              <h3>Grounded responses</h3>
              <p>
                Downstream prompts quote or summarize only from retrieved spans,
                with room for instructors to review sources. The UI makes it
                obvious when an answer drew on RAG versus peer replies alone.
              </p>
            </Motion.article>
          </div>
          <p className={styles.ragNote}>
            Live forum threads, semantic question search, draft/fit AI helpers,
            and this RAG pipeline work together: uploads and access control live
            in the Knowledge base per cohort, and RAG-backed context shows up in
            the same thread view you already use.
          </p>
        </section>

        {/* BUILT FOR COHORT COURSEWORK */}
        <section className={styles.landingSection}>
          <h2>Built for cohort coursework</h2>
          <p className={styles.sectionLead}>
            Same patterns you use after sign-in, without a separate
            &ldquo;marketing product.&rdquo;
          </p>
          <div className={`${styles.landingCardGrid} ${styles.four}`}>
            <Motion.article {...reveal}>
              <Search />
              <h3>Find related work</h3>
              <p>
                Keyword filters for exact matches, plus similarity search when
                you are still shaping the right vocabulary.
              </p>
            </Motion.article>
            <Motion.article {...reveal}>
              <MessageSquare />
              <h3>Readable threads</h3>
              <p>
                Questions and answers stay structured so the group can reuse
                explanations before exams and interviews.
              </p>
            </Motion.article>
            <Motion.article {...reveal}>
              <Sparkles />
              <h3>Lightweight AI help</h3>
              <p>
                Suggestions on your question draft and a quick relevance check
                on answer drafts. Always your choice to apply or post.
              </p>
            </Motion.article>
            <Motion.article {...reveal}>
              <Layers />
              <h3>RAG over your course library</h3>
              <p>
                Instructors and cohorts add PDFs, syllabi, and notes into a
                controlled corpus. When you ask, the system retrieves the most
                relevant passages and attaches them to the prompt, so
                explanations stay tied to your class materials, not the open
                web.
              </p>
            </Motion.article>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className={styles.landingSection} id="how">
          <h2>How it works</h2>
          <p className={styles.sectionLead}>
            Four steps from question to searchable knowledge for the next
            person.
          </p>
          <div className={styles.howGrid}>
            <Motion.article {...reveal}>
              <span className={styles.howIcon}>
                <PenSquare size={18} />
              </span>
              <strong>Ask with context</strong>
              <p>
                Title, environment, errors, and what you tried, so peers
                reproduce before they teach.
              </p>
            </Motion.article>
            <Motion.article {...reveal}>
              <span className={styles.howIcon}>
                <MessageSquare size={18} />
              </span>
              <strong>Get answers</strong>
              <p>
                Replies live in one thread with markdown and code blocks,
                visible to everyone in the cohort.
              </p>
            </Motion.article>
            <Motion.article {...reveal}>
              <span className={styles.howIcon}>
                <Search size={18} />
              </span>
              <strong>Search two ways</strong>
              <p>
                Classic text search on the feed, or semantic search when you
                want &ldquo;questions like this one.&rdquo;
              </p>
            </Motion.article>
            <Motion.article {...reveal}>
              <span className={styles.howIcon}>
                <Library size={18} />
              </span>
              <strong>Own your trail</strong>
              <p>
                Your topics list keeps authorship clear. The Knowledge base
                hosts uploads and RAG retrieval so answers can cite your
                materials. See <strong>Course RAG</strong> above for the full
                pipeline.
              </p>
            </Motion.article>
          </div>
        </section>

        {/* CTA: signed-in visitors get a way back, not a sign-up pitch */}
        {isAuthenticated ? (
          <section className={`${styles.landingCta} ${styles.signedIn}`}>
            <span className={styles.ctaPill}>Signed in</span>
            <h2>Back to your workspace</h2>
            <p>
              Home has the live feed, shortcuts, and search. Your topics lists
              only threads you started. Course-document RAG (ingest, retrieve,
              cite) ties the Knowledge base to threads. Scroll to{" "}
              <strong>Course RAG</strong> on this page for the full picture.
            </p>
            <Link to="/dashboard" className={btn.primaryButton}>
              Open forum home <ArrowRight size={17} />
            </Link>
          </section>
        ) : (
          <section className={styles.landingCta}>
            <h2>Ready when you are</h2>
            <p>
              Create a free learner account to post, reply, and search the forum
              index.
            </p>
            <Link to="/auth" className={btn.primaryButton}>
              Create free account <ArrowRight size={17} />
            </Link>
          </section>
        )}
      </main>
      <footer className={styles.landingFooter}>
        <strong>Evangadi Forum</strong>
        <span>© 2026 · Learner-led Q&amp;A</span>
        <div>
          {!isAuthenticated && <Link to="/auth">Sign in</Link>}
          <a>Privacy</a>
          <a>Terms</a>
        </div>
      </footer>
    </div>
  );
}
